import json
import logging
import re

from openai import OpenAI
from sqlalchemy.orm import Session

from .config import settings
from . import models
from .entities import ENTITY_MODELS, ENTITY_LABELS_TR
from .mentions import detect_and_save_mentions
from .sections import (
    SECTIONS_BY_ENTITY_TYPE, ai_visible_sections, describe_sections_for_tool,
    relevant_sections_for_instruction, _tr_lower,
)
from .novel_context import get_universe_id_for_novel
from .style_scan import build_style_warning_layer

logger = logging.getLogger("roman_api.qwen")

_client = None


def get_client() -> OpenAI:
    """DashScope OpenAI-uyumlu client. API anahtarı sadece burada, sunucu
    tarafında kullanılır - tarayıcıya hiçbir zaman gönderilmez."""
    global _client
    if _client is None:
        _client = OpenAI(api_key=settings.dashscope_api_key, base_url=settings.dashscope_base_url)
    return _client


# ---------------------------------------------------------------------------
# SABİT KATMAN: Roman kuralları. Her istekte tam ve değişmeden dahil edilir.
# ---------------------------------------------------------------------------

def build_fixed_layer(db: Session, universe_id: int, instruction_text: str = "") -> str:
    """Devasa dünyalarda (bkz. proje sohbet geçmişi - 12.000 sayfalık seri
    senaryosu) kural sayısı arttıkça hepsini her seferinde göndermek token
    israfı olur. Eşik altında (KUCUK_DUNYA_ESIGI) davranış AYNI kalır -
    hepsi gönderilir, hiçbir şey değişmez. Eşik üstünde: etiketsiz
    (evrensel) kurallar HER ZAMAN gider, etiketli kurallar SADECE o etiket
    talimat metninde geçiyorsa gider - basit ama etkili bir alt küme."""
    rules = db.query(models.Rule).filter(models.Rule.universe_id == universe_id).all()
    # Kayda özel kurallar (entity_id dolu) SABİT katmana girmez - sadece o
    # kayıt seçiliyken dinamik katmanla gider (bkz. build_dynamic_layer).
    rules = [r for r in rules if not r.entity_id]
    if not rules:
        return ""

    KUCUK_DUNYA_ESIGI = 40
    if len(rules) > KUCUK_DUNYA_ESIGI and instruction_text:
        instruction_lower = instruction_text.lower()
        selected = [
            r for r in rules
            if not r.tags or any(tag.lower() in instruction_lower for tag in r.tags)
        ]
        # Filtreleme hiçbir şey seçmediyse (ör. instruction_text boşsa ya da
        # hiçbir etiket eşleşmediyse) sessizce hepsini göndermeye geri dön -
        # "kural kayboldu" hissi vermemek, sessiz veri kaybından her zaman iyidir.
        if selected:
            rules = selected

    lines = ["ROMAN KURALLARI (bunlar asla ihlal edilemez, her bölümde geçerlidir):"]
    for r in rules:
        lines.append(f"- {r.title}: {r.description}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# FİHRİST KATMANI: yazılmış tüm bölümlerin özetleri. Roman kuralları gibi bu
# katman da SABİT sayılır ve her AI isteğine otomatik dahil edilir - amaç
# Qwen'in sadece o an seçilen karakter/olay detayını değil, romanın baştan
# sona genel akışını da görmesi. Sistemin geri kalanı (dynamic layer,
# full_scan, fihrist uç noktası) hep bu katmana bağlı çalışır: özeti olmayan
# bölümler burada görünmez, bu da "önce özet yaz" akışını doğal olarak
# teşvik eder.
# ---------------------------------------------------------------------------

def build_index_layer(db: Session, universe_id: int, current_novel_id: int, exclude_chapter_number: int | None = None) -> str:
    """Devasa bir SERİ için fihrist artık tek kitapla sınırlı değil - aynı
    evrendeki TÜM kitapların özetleri (kronolojik book_number sırasıyla)
    dahil edilir, çünkü 3. kitabı yazarken 1-2. kitaplarda ne olduğunu
    bilmek gerekir. Tek kitaplık projelerde (universe'te tek novel varsa)
    davranış eskisiyle birebir aynıdır - sadece 'Kitap X' etiketi
    eklenmez, gereksiz gürültü olmasın diye."""
    novels_in_universe = (
        db.query(models.Novel)
        .filter(models.Novel.universe_id == universe_id)
        .order_by(models.Novel.book_number.is_(None), models.Novel.book_number, models.Novel.id)
        .all()
    )
    novel_ids = [n.id for n in novels_in_universe]
    multi_book = len(novel_ids) > 1

    chapters = (
        db.query(models.Chapter)
        # Tür filtresi YOK: özeti olan her girdi fihriste girer. Kullanıcı
        # metni Kısım/Alt Başlık girdilerinde tutabiliyor; tür filtresi
        # bunları AI'dan gizliyordu.
        .filter(models.Chapter.novel_id.in_(novel_ids), models.Chapter.summary != "")
        .all()
    )
    if current_novel_id is not None:
        chapters = [c for c in chapters if not (c.novel_id == current_novel_id and c.number == exclude_chapter_number)]
    if not chapters:
        return ""

    novel_order = {n.id: i for i, n in enumerate(novels_in_universe)}
    novel_names = {n.id: n.name for n in novels_in_universe}
    chapters.sort(key=lambda c: (novel_order.get(c.novel_id, 0), c.number))

    lines = ["ROMAN FİHRİSTİ (yazılmış bölümlerin özetleri, sırayla):"]
    last_novel_id = None
    for c in chapters:
        if multi_book and c.novel_id != last_novel_id:
            lines.append(f"\n-- {novel_names.get(c.novel_id, '?')} --")
            last_novel_id = c.novel_id
        title_part = f" - {c.title}" if c.title else ""
        lines.append(f"Bölüm {c.number}{title_part}: {c.summary}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# DİNAMİK KATMAN: Seçilen karakter/mekan/olay/nesne/ipucu kayıtları
# + bu varlıkların geçtiği en alakalı geçmiş paragraflar.
# ---------------------------------------------------------------------------

def build_dynamic_layer(db: Session, universe_id: int, selected_entities: list, max_paragraphs_per_entity: int = 3, instruction_text: str = "", include_hidden: bool = False) -> str:
    if not selected_entities:
        return ""

    blocks = ["İLGİLİ GEÇMİŞ BİLGİLER:"]
    for ref in selected_entities:
        model = ENTITY_MODELS.get(ref.entity_type)
        if model is None:
            continue
        record = db.query(model).filter(model.id == ref.entity_id, model.universe_id == universe_id).first()
        if record is None:
            continue

        label = ENTITY_LABELS_TR.get(ref.entity_type, ref.entity_type.upper())
        blocks.append(f"\n[{label}] {record.name} (id: {record.id}, tip: {ref.entity_type})")
        if record.description:
            blocks.append(f"Özet: {record.description}")
        if getattr(record, "notes", ""):
            blocks.append(f"Notlar: {record.notes}")

        # MEKAN HİYERARŞİSİ: bir mekan başka bir mekanın içindeyse (bkz.
        # Place.parent_place_id), bu zinciri otomatik ekliyoruz - ör.
        # "Kraliyet Sarayı, Buz Şehri içinde, Kuzey Krallığı içinde".
        # Yazarın bunu her mekan için elle Bağlantılar'a yazmasına gerek
        # kalmaz, ve tutarlılık garanti edilir (veri TEK bir yerde -
        # parent_place_id - tutuluyor, metne kopyalanmıyor). max 20
        # seviye sınırı sadece bir güvenlik ağı - hatalı/döngüsel veri
        # (ör. A'nın üstü B, B'nin üstü A) sonsuz döngüye girmesin diye.
        if ref.entity_type == "place" and getattr(record, "parent_place_id", None):
            chain = []
            current_id = record.parent_place_id
            depth = 0
            while current_id and depth < 20:
                parent = db.query(models.Place).filter(models.Place.id == current_id, models.Place.universe_id == universe_id).first()
                if not parent:
                    break
                chain.append(parent.name)
                current_id = parent.parent_place_id
                depth += 1
            if chain:
                blocks.append(f"Nerede: {', '.join(chain)} içinde")

        # FAKSİYON ÜYELİĞİ: bir karakter bir ya da daha fazla faksiyona
        # (Hane/Lonca/Ordu/Tarikat) üyeyse, bunu da mekan zinciri gibi
        # otomatik ekliyoruz - "Ahmet, Kuzey Hanedanı üyesi (Muhafız)" gibi.
        # Aynı mantık: veri TEK bir yerde (FactionMembership) tutuluyor,
        # yazarın her karakter için elle yazmasına gerek kalmıyor.
        if ref.entity_type == "character":
            memberships = (
                db.query(models.FactionMembership)
                .filter(models.FactionMembership.character_id == record.id, models.FactionMembership.universe_id == universe_id)
                .all()
            )
            if memberships:
                lines = []
                for m in memberships:
                    faction = db.query(models.Faction).filter(models.Faction.id == m.faction_id, models.Faction.universe_id == universe_id).first()
                    if not faction:
                        continue
                    role_part = f" ({m.role})" if m.role else ""
                    lines.append(f"{faction.name}{role_part}")
                if lines:
                    blocks.append(f"Faksiyon üyeliği: {', '.join(lines)}")

        # 'sections' (bkz. app/sections.py) İÇERİĞİNİN TAMAMINI buraya
        # basmıyoruz - bilerek. Amaç tam olarak bunu önlemek: karakterin TÜM
        # derin profilini (görünüş, geçmiş, ilişkiler...) her istekte
        # context'e basıp token israf etmek. Bunun yerine:
        #   1. Talimat metninde ilgili anahtar kelimeler geçiyorsa (ör.
        #      "görünüşünü betimle" -> fiziksel_yapi) SADECE O bölümün
        #      içeriği enjekte edilir - tek seferlik assist modunda aracı
        #      olmayan AI'nın ihtiyacı olan bilgiye erişmesinin TEK yolu bu.
        #   2. Geri kalan dolu bölümlerin sadece İSMİ listelenir - sohbet
        #      modundaki AI gerekirse get_entity_section aracıyla çeker.
        # 'meta' hiçbir koşulda gitmez (ai_visible_sections dışlar,
        # relevant_sections_for_instruction haritasında hiç yok).
        entity_sections = getattr(record, "sections", None) or {}
        visible = ai_visible_sections(entity_sections)
        relevant_keys = relevant_sections_for_instruction(instruction_text, ref.entity_type)
        injected = []
        for key in relevant_keys:
            content = (visible.get(key) or "").strip()
            if content:
                section_label = SECTIONS_BY_ENTITY_TYPE.get(ref.entity_type, {}).get(key, key).split(":", 1)[0]
                blocks.append(f"{section_label} ({key}): {content}")
                injected.append(key)
        remaining = [k for k, v in visible.items() if v and k not in injected]
        if remaining:
            blocks.append(f"Ek detay bölümleri mevcut (gerekirse get_entity_section ile çek): {', '.join(remaining)}")

        # GİZLİ KATMAN: sadece include_hidden (alt-metin modu) açıkken ve
        # SADECE sert bir sızdırmama direktifiyle girer. Amaç dramatik
        # ironi: "baş tabip Lümen'in suçlarını biliyor ama susuyor" bilgisini
        # AI bilirse diyalogları fark ettirmeden kaçamaklaşır - ama metne
        # asla açıkça yazmaz. Varsayılanda (include_hidden=False) bu blok
        # hiç oluşmaz; anahtar kelime eşleşmesi de gizli'yi asla seçemez
        # (SECTION_KEYWORDS'te yok, ai_visible_sections dışlıyor).
        if include_hidden:
            hidden_val = (entity_sections.get("gizli") or "").strip()
            if hidden_val:
                blocks.append(
                    "🔒 GİZLİ KATMAN (SIR - romanda ASLA açıkça yazma, ima ötesine geçme; "
                    "sadece davranış tutarlılığı ve alt-metin için bil): " + hidden_val
                )

        # GRUP/KURUM ÜYELİKLERİ: karakterin hangi yapıya, hangi ROLLE bağlı
        # olduğu. Bu bilgi karakterlerin 'iliskiler' kutusuna dağıldığında
        # ters sorgulanamıyor ("LÜMEN'e kimler bağlı?") ve grubun kendi
        # profili (kuralları, geçmişi) hiçbir yerde bütün durmuyordu.
        if ref.entity_type == "character":
            memberships = (
                db.query(models.FactionMembership)
                .filter(
                    models.FactionMembership.universe_id == universe_id,
                    models.FactionMembership.character_id == ref.entity_id,
                )
                .all()
            )
            for mem in memberships:
                faction = db.query(models.Faction).filter(models.Faction.id == mem.faction_id).first()
                if not faction:
                    continue
                satir = f"Bağlı olduğu grup: {faction.name}"
                if mem.role:
                    satir += f" (rolü: {mem.role})"
                if (faction.description or "").strip():
                    satir += f" - {faction.description.strip()}"
                # Grubun DİĞER üyeleri de kısa listelenir: sahnede kimin
                # kimden yana olduğu belli olsun.
                digerleri = (
                    db.query(models.FactionMembership)
                    .filter(
                        models.FactionMembership.faction_id == faction.id,
                        models.FactionMembership.character_id != ref.entity_id,
                    )
                    .all()
                )
                if digerleri:
                    isimler = []
                    for d in digerleri[:12]:
                        ch = db.query(models.Character).filter(models.Character.id == d.character_id).first()
                        if ch:
                            isimler.append(f"{ch.name}{f' ({d.role})' if d.role else ''}")
                    if isimler:
                        satir += f". Diğer üyeler: {', '.join(isimler)}"
                blocks.append(satir)

        # Bu kayda ÖZEL kurallar: sabit katmandan bilerek dışlandılar -
        # sadece kayıt sahnedeyken (seçili varlıklardayken) buradan girerler.
        scoped_rules = (
            db.query(models.Rule)
            .filter(models.Rule.entity_type == ref.entity_type, models.Rule.entity_id == ref.entity_id)
            .all()
        )
        if scoped_rules:
            rule_lines = "\n".join(
                f"- {r.title}" + (f": {r.description}" if r.description else "") for r in scoped_rules
            )
            blocks.append(f"Bu kayda ÖZEL kurallar (İHLAL ETME):\n{rule_lines}")

        progressions = (
            db.query(models.Progression)
            .filter(
                models.Progression.entity_type == ref.entity_type,
                models.Progression.entity_id == ref.entity_id,
                models.Progression.universe_id == universe_id,
            )
            .all()
        )
        if progressions:
            progressions.sort(key=lambda p: (p.chapter_number is None, p.chapter_number or 0, p.id))
            blocks.append("Zaman içindeki gelişimi (kronolojik sırayla, EN GÜNCEL EN ALTTA):")
            # Devasa bir seride (yüzlerce bölüm) bir karakterin gelişim
            # notu listesi tek başına sınırsız büyüyebilir - bu yüzden
            # SADECE son PROGRESSION_VERBATIM_LIMIT not tam metniyle
            # gösterilir, daha eskisi tek satırlık bir özet-listesine
            # sıkıştırılır (gerçek bir AI özeti değil, basit bir kısaltma -
            # tam ayrıntı her zaman Gelişim Çizelgesi menüsünde duruyor).
            PROGRESSION_VERBATIM_LIMIT = 10
            if len(progressions) > PROGRESSION_VERBATIM_LIMIT:
                older = progressions[:-PROGRESSION_VERBATIM_LIMIT]
                recent = progressions[-PROGRESSION_VERBATIM_LIMIT:]
                older_preview = "; ".join(
                    (p.note[:40] + "…" if len(p.note) > 40 else p.note) for p in older[:5]
                )
                remaining = len(older) - 5
                extra = f" (+{remaining} eski not daha, ayrıntı için Gelişim Çizelgesi'ne bak)" if remaining > 0 else ""
                blocks.append(f"  - [ESKİ NOTLARIN ÖZETİ] {older_preview}{extra}")
                progressions = recent
            for prog in progressions:
                chapter_part = f"Bölüm {prog.chapter_number}" if prog.chapter_number else "bölüm belirtilmemiş"
                blocks.append(f"  - ({chapter_part}) {prog.note}")

        mentions = (
            db.query(models.Mention)
            .filter(models.Mention.entity_type == ref.entity_type, models.Mention.entity_id == ref.entity_id)
            .order_by(models.Mention.id.desc())
            .limit(max_paragraphs_per_entity)
            .all()
        )
        for m in mentions:
            para = m.paragraph
            chapter_no = para.chapter.number if para.chapter else "?"
            blocks.append(f"(Bölüm {chapter_no}, Paragraf {para.number}): {para.text}")

    return "\n".join(blocks)


# ---------------------------------------------------------------------------
# STİL KATMANI: Yazarın "böyle yaz" diye işaretlediği örnek paragraflar.
# Sabit katman gibi her istekte otomatik dahil edilir - üslup her yerde
# tutarlı olmalı, bölüme özel değil.
# ---------------------------------------------------------------------------

def build_style_layer(db: Session, universe_id: int, max_samples: int = 5) -> str:
    """Üslup tutarlılığı da tek kitapla sınırlı değil - bir serinin tüm
    kitaplarında AYNI ses korunmalı, o yüzden stil örnekleri (is_style_sample)
    evrendeki TÜM kitaplardan toplanır, sadece aktif kitaptan değil."""
    novel_ids = [n.id for n in db.query(models.Novel.id).filter(models.Novel.universe_id == universe_id).all()]
    if not novel_ids:
        return ""
    samples = (
        db.query(models.Paragraph)
        .join(models.Chapter, models.Paragraph.chapter_id == models.Chapter.id)
        .filter(models.Paragraph.is_style_sample == True, models.Chapter.novel_id.in_(novel_ids))  # noqa: E712
        .order_by(models.Paragraph.id.desc())
        .limit(max_samples)
        .all()
    )
    if not samples:
        return ""
    lines = ["YAZARIN KENDİ ÜSLUP ÖRNEKLERİ (yeni metni bu ton ve tarzda yaz, bunları kopyalama):"]
    for s in samples:
        lines.append(f"- {s.text}")
    return "\n".join(lines)


def build_plan_layer(db: Session, novel_id: int, chapter_number: int | None, instruction_text: str = "") -> str:
    """BÖLÜM PLANI katmanı: üzerinde çalışılan bölüme bağlı Plan Matrisi
    hücresi varsa (bkz. models.MatrixCell.chapter_id), hücrenin içeriği +
    kolon/satır etiketi context'e girer. Yani "Tur 3 × Aşama 5'te şu 7 soru
    sorulacak" bilgisi artık dosyada değil, tam o bölüm yazılırken AI'nın
    önünde. Bölüm numarası yoksa ya da bağlı hücre yoksa boş döner -
    plansız bölümler hiçbir ek maliyet ödemez.

    summary ile fark: summary "ne OLDU"nun kaydı (yazıldıktan sonra) ve o
    bölümde çalışılırken bilerek dışlanır; plan "ne OLACAK"ın kaydı ve tam
    tersine, sadece o bölümde çalışılırken dahil edilir."""
    def _cell_block(cell: "models.MatrixCell") -> str | None:
        content = (cell.content or "").strip()
        if not content:
            return None
        col = db.query(models.MatrixColumn).filter(models.MatrixColumn.id == cell.column_id).first()
        row = db.query(models.MatrixRow).filter(models.MatrixRow.id == cell.row_id).first()
        header = " × ".join(x.label for x in (col, row) if x)
        code_part = f"{cell.code}: " if cell.code else ""
        block = f"[{code_part}{header}]\n{content}" if header or code_part else content
        # TALİMAT KASASI: satıra (aşamaya) kayıtlı kalıcı yazım kısıtları
        # planın hemen ardından gider - "iyi talimat"ı her seferinde
        # yeniden yazmak gerekmesin diye.
        row_rules = (getattr(row, "instructions", "") or "").strip() if row else ""
        if row_rules:
            block += f"\nBU AŞAMANIN YAZIM KISITLARI (uy):\n{row_rules}"
        return block

    parts = []
    own_cell_ids = set()

    # 1) Üzerinde çalışılan bölüme BAĞLI hücre(ler): plana sadık kal.
    if chapter_number is not None:
        chapter = (
            db.query(models.Chapter)
            .filter(models.Chapter.novel_id == novel_id, models.Chapter.number == chapter_number)
            .first()
        )
        if chapter:
            cells = db.query(models.MatrixCell).filter(models.MatrixCell.chapter_id == chapter.id).all()
            own_cell_ids = {c.id for c in cells}
            blocks = [b for b in (_cell_block(c) for c in cells) if b]
            if blocks:
                parts.append(
                    "=== BÖLÜM PLANI (bu bölümde OLACAKLAR - plana sadık kal) ===\n"
                    + "\n\n".join(blocks)
                )

    # 2) Talimatta GEÇEN referans kodları (MP13 gibi): kıyas için çekilir.
    #    "MP5'teki sorgu ritmiyle kıyasla" dendiğinde, o hücrenin planı da
    #    context'e girer - AI turlar arası paraleli görebilsin diye. Sadece
    #    talimatta AÇIKÇA anılan kodlar gider (56 hücrenin tamamı asla).
    if instruction_text:
        codes = set(re.findall(r"\bMP\d+\b", instruction_text, flags=re.IGNORECASE))
        if codes:
            codes_norm = {c.upper() for c in codes}
            ref_cells = (
                db.query(models.MatrixCell)
                .join(models.PlanMatrix, models.MatrixCell.matrix_id == models.PlanMatrix.id)
                .filter(
                    models.PlanMatrix.novel_id == novel_id,
                    models.MatrixCell.code.in_(codes_norm),
                    models.MatrixCell.id.notin_(own_cell_ids) if own_cell_ids else True,  # noqa: E712
                )
                .all()
            )
            blocks = [b for b in (_cell_block(c) for c in ref_cells) if b]
            if blocks:
                parts.append(
                    "=== REFERANS PLANLAR (talimatta anılan kodlar - KIYAS için, bu bölümde yazılacak içerik DEĞİL) ===\n"
                    + "\n\n".join(blocks)
                )

    return "\n\n".join(parts)


def build_context(
    db: Session, novel_id: int, universe_id: int, selected_entities: list,
    chapter_number: int | None = None, instruction_text: str = "",
    include_hidden: bool = False, include_chapter_text: bool = False,
    text_scope: str = "chapter",
) -> str:
    """chapter_number verilirse (o an üzerinde çalışılan bölüm), fihrist
    katmanında o bölüm dışlanır - bir bölümün kendi özetini kendi context'i
    olarak görmesi anlamsız, gerçek metin zaten mevcut_text/dynamic layer'da.

    novel_id: hangi KİTAP üzerinde çalışılıyor (fihristte 'şu an
    yazdığın bölüm hariç' filtresi ve full_scan için).
    universe_id: karakterler/mekanlar/kurallar/stil örnekleri gibi
    PAYLAŞILAN verinin hangi evrenden çekileceği - bu artık seride tüm
    kitapları kapsıyor."""
    fixed = build_fixed_layer(db, universe_id, instruction_text=instruction_text)
    index = build_index_layer(db, universe_id, novel_id, exclude_chapter_number=chapter_number)
    # Fihrist HARİTASI: kullanıcının gördüğü numaralar ("Kısım 1.1") -
    # atıfları çözebilmek için. Özetlerden bağımsız, ucuz bir liste.
    outline = build_outline_layer(db, universe_id, novel_id)
    # Matris haritası: bölüm ↔ kolon×satır eşleşmesi (etiketler + bölüm no,
    # hücre içerikleri DEĞİL - ucuz kalsın)
    matrix_map = build_matrix_map_layer(db, novel_id)
    # Kısayol kodlarıyla ("1BLM", "1-2KSM") anılan girdilerin İÇERİĞİ
    referenced = build_referenced_entries_layer(db, universe_id, novel_id, instruction_text)
    # Sohbet modunda çalışılan bölümün METNİ de gider (include_chapter_text);
    # talimat modunda metin zaten existing_text ile gidiyor, tekrarlamayalım.
    # Kapsam: "none" (metin gitmesin - kısa sorular, ucuz),
    # "chapter" (varsayılan: açık bölümün metni),
    # "novel" (tüm kitap - tutarlılık soruları, pahalı).
    if not include_chapter_text or text_scope == "none":
        chapter_text = ""
    elif text_scope == "novel":
        chapter_text = build_whole_novel_layer(db, novel_id)
    else:
        chapter_text = build_current_chapter_layer(db, novel_id, chapter_number)
    style = build_style_layer(db, universe_id)
    # Üslup uyarıları: son üslup taramasının ÖNBELLEĞİNDEN, sadece eşiği
    # aşan yazım tiklerini "bundan kaçın" olarak ekler. build_style_layer
    # ("böyle yaz" örnekleri) ile ters yönlü, kasıtlı olarak ayrı iki
    # katman - bkz. style_scan.build_style_warning_layer.
    style_warnings = build_style_warning_layer(db, universe_id)
    plan = build_plan_layer(db, novel_id, chapter_number, instruction_text=instruction_text)
    dynamic = build_dynamic_layer(db, universe_id, selected_entities, instruction_text=instruction_text, include_hidden=include_hidden)
    return "\n\n".join(part for part in [fixed, index, outline, matrix_map, referenced, style, style_warnings, plan, chapter_text, dynamic] if part)


# ---------------------------------------------------------------------------
# BÖLÜM ÖZETİ ÜRETİMİ: fihrist katmanının veri kaynağı. Üretilen özet burada
# kaydedilmez, sadece taslak olarak döner - kaydetme kararı kullanıcıya ait
# (bkz. routers/chapters.py generate-summary + mevcut PUT /chapters/{id}).
# ---------------------------------------------------------------------------

# Özet artık SADECE olay değil, bölümün DUYGUSU ve tonu da taşır. Sebep:
# bu özet, sonraki bölümler yazılırken fihrist katmanıyla AI'ya gidiyor -
# "ne oldu" bilgisi tek başına yetmiyor, "hangi duyguyla bitti / sahnenin
# rengi neydi" bilinmezse sonraki bölüm yanlış tonda başlıyor. Bir bölüm
# gerilimle bitip diğeri neşeyle açılmasın diye ton bilgisi şart.
# Özet artık YAPILANDIRILMIŞ ve DEVAMLILIK bilinçli. Sebepler:
#  - Serbest paragraf özet, atmosfer/mekan/duygu gibi bilgileri rastgele
#    atlıyordu; sabit başlıklar modeli bu soruları TEK TEK cevaplamaya
#    zorluyor (atlanan alan gözle görülür oluyor).
#  - Önceki bölümün özeti prompt'a veriliyor: "bu bölüm ne devraldı, neyi
#    değiştirdi" sorusu ancak öncesi bilinirse cevaplanabilir. Zincir
#    böylece kopmuyor - fihrist katmanı sonraki bölümlere hem olayı hem
#    duygusal devri taşıyor.
CHAPTER_SUMMARY_SYSTEM_PROMPT = """Sen bir roman editörüsün. Sana bir bölümün
tüm paragrafları ve (varsa) BİR ÖNCEKİ bölümün özeti verilecek. Bu bölüm için
aşağıdaki başlıkları TEK TEK, kısa ve bilgi dolu şekilde doldur. Her başlık
tek satır olsun, başlık adlarını AYNEN koru:

ZAMAN: Sahnenin başladığı AN. Takvim tarihi ve saat kaçta başladığını yaz
  (ör. "28 Haziran 2030, 21:05"). Metinde açık tarih/saat yoksa göreli
  zamanı yaz ("önceki bölümden hemen sonra", "ertesi sabah"); hiçbir zaman
  bilgisi yoksa "belirtilmemiş" yaz. Bu satır Zaman Çizelgesi'ni besler,
  ASLA atlanmaz.
  DİKKAT - şunları ZAMAN satırına KARIŞTIRMA:
  * SÜRE ("10 dakika", "5 dk", "20 dakikalık sorgu") bir an değil, uzunluktur;
    varsa ayrı yaz: "Süre: 10 dk".
  * GERİ DÖNÜŞ / anımsanan geçmiş tarihler (hologram kayıtları, yıllar önceki
    olaylar) sahnenin zamanı DEĞİLDİR; varsa ayrı yaz: "Geri dönüş: 2023 yangını".
  Yani bu satır en fazla üç parçadan oluşur: sahnenin anı, süresi, geri dönüşler.
OLAY: Kim, ne yaptı, ne oldu? Bölüm sonunda durum ne? (isimler açık, 1-3 cümle)
MEKAN: Sahne nerede geçiyor? Mekanın bölümdeki işlevi/değişimi ne?
ATMOSFER: Duyusal ve fiziksel hava - ışık, ses, koku, sıcaklık, kalabalık/boşluk;
  sahnenin dokusu nasıl?
DUYGU: Kilit karakterlerin duygusal durumu ve aralarındaki gerilim. Okurda
  bırakması amaçlanan his ne?
DEVAMLILIK: Önceki bölümden neyi devraldı, neyi değiştirdi? Açık kalan
  soru/tehdit/vaat ne? (önceki bölüm verilmediyse "Açılış bölümü" yaz)
KAPANIŞ TONU: Bölüm hangi duyguyla ve hangi eşikte kapanıyor? Sonraki bölüm
  bunu nasıl devralmalı?

Kurallar: metinde OLMAYAN olay ya da duygu UYDURMA - sadece yazılanlardan
çıkar; bir başlığın karşılığı metinde yoksa "belirtilmemiş" yaz. Süslü edebi
dil kullanma, bilgi ver. Yanıtını SADECE bu düz metin başlıklarla ver;
markdown, tırnak, madde işareti ekleme."""


# ---------------------------------------------------------------------------
# AI İLE PARAGRAF BÖLME: elinde net paragraf ayraçları (boş satır) olmayan,
# tek blok hâlinde yapıştırılmış bir metni mantıklı paragraflara böler.
# KRİTİK KURAL: tek kelime bile DEĞİŞTİRİLMEZ - sadece nereye paragraf
# arası konacağına karar verir. Bu yüzden içe aktarma (import) sırasında
# blank-line ayracı bulamayan uzun bölümlerde ve "büyük metin yapıştır"
# özelliğinde kullanılır.
# ---------------------------------------------------------------------------

PARAGRAPH_SPLIT_SYSTEM_PROMPT = """Sen bir roman editörü asistanısın. Sana
paragraf araları net olmayan (tek blok hâlinde) bir metin verilecek.
Görevin bu metni mantıklı paragraflara bölmek - diyalog değişimi, sahne/
zaman geçişi, yeni bir düşünce/eylem başlangıcı gibi doğal noktalarda böl.

MUTLAK KURAL: Metnin TEK BİR KELİMESİNİ, noktalama işaretini bile
DEĞİŞTİRME, EKLEME ya da ÇIKARMA - sadece paragraflara böl. Tüm
paragrafları sırayla birleştirdiğimde orijinal metinle (sadece paragraf
aralarındaki boşluklar hariç) BİREBİR aynı olmalı. Yorum, başlık, özet
EKLEME.

Yanıtını SADECE aşağıdaki JSON formatında ver:
{"paragraphs": ["ilk paragraf metni", "ikinci paragraf metni", "..."]}"""


def split_paragraphs_with_ai(raw_text: str) -> list[str]:
    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[
            {"role": "system", "content": PARAGRAPH_SPLIT_SYSTEM_PROMPT},
            {"role": "user", "content": raw_text},
        ],
    )
    raw = response.choices[0].message.content
    cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        # Qwen JSON dışına çıktıysa, en azından tek paragraf olarak dön -
        # kullanıcı hiç kayıp yaşamasın, elle bölmeyi kendisi yapabilir.
        return [raw_text.strip()] if raw_text.strip() else []

    paragraphs = [p.strip() for p in data.get("paragraphs", []) if isinstance(p, str) and p.strip()]
    return paragraphs or ([raw_text.strip()] if raw_text.strip() else [])


def summarize_chapter(db: Session, chapter: "models.Chapter") -> str:
    text = "\n".join(f"[Paragraf {p.number}] {p.text}" for p in chapter.paragraphs)
    title_part = f" - {chapter.title}" if chapter.title else ""

    # DEVAMLILIK için bir önceki (özeti olan) bölümü bul - Kısım/Alt Başlık
    # girdileri atlanır, sadece gerçek bölümler zincire girer.
    previous = (
        db.query(models.Chapter)
        .filter(
            models.Chapter.novel_id == chapter.novel_id,
            models.Chapter.number < chapter.number,
        )
        .order_by(models.Chapter.number.desc())
        .all()
    )
    prev_block = ""
    for prev in previous:
        if (prev.summary or "").strip():
            prev_title = f" - {prev.title}" if prev.title else ""
            prev_block = (
                f"ÖNCEKİ BÖLÜMÜN ÖZETİ (Bölüm {prev.number}{prev_title}):\n"
                f"{prev.summary.strip()}\n\n"
            )
            break

    user_message = f"{prev_block}ÖZETLENECEK BÖLÜM {chapter.number}{title_part}:\n{text}"

    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[
            {"role": "system", "content": CHAPTER_SUMMARY_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
    )
    return response.choices[0].message.content.strip()


# ---------------------------------------------------------------------------
# YENİ VARLIK ÖNERİSİ (bölüm bazlı): hazır yazılmış/içe aktarılmış bir
# bölümü tarayıp henüz menülerde kayıtlı OLMAYAN karakter/mekan/olay/nesne/
# ipucu/terim adaylarını önerir. /ai/assist'teki new_entity_suggestions ile
# AYNI schema'yı (AiSuggestion) kullanır, böylece aynı onay akışından
# (/ai/approve-suggestions) geçer - hiçbir şey burada doğrudan kaydedilmez.
# ---------------------------------------------------------------------------

ENTITY_EXTRACTION_SYSTEM_PROMPT = """Sen bir roman editörü asistanısın. Sana
bir bölümün tüm paragrafları ve romanda ZATEN KAYITLI olan karakter/mekan/
olay/nesne/ipucu/terim isimlerinin listesi verilecek. Görevin, bu bölümde
geçen ama henüz kayıtlı listede OLMAYAN, roman için önemli görünen yeni
varlık adaylarını bulmak.

ÖNEMLİ - KARAKTERLER/MEKANLAR HER ZAMAN ÖZEL İSİMLE GEÇMEZ: Bir karakter
"yaşlı teknisyen", "tavernacı", "kırmızı paltolu kadın" gibi sadece ROLÜ ya
da TASVİRİ üzerinden tanıtılmış olabilir - henüz özel bir adı olmasa bile,
konuşan, bir eylem yapan ya da ayrıntılı tasvir edilen HERKES bir karakter
adayıdır. Aynı şekilde bir mekan "eski değirmen", "limandaki han" gibi özel
adı olmadan da geçebilir - bu da bir mekan adayıdır. Böyle durumlarda name
alanına o tasvirin kendisini yaz (ör. "Yaşlı Teknisyen", "Eski Değirmen") -
"henüz özel ismi yok" diye ATLAMA.

Kurallar:
- Zaten kayıtlı listede olan bir isim (ya da AÇIKÇA aynı kişiyi/yeri işaret
  eden bir tasvir) TEKRAR ÖNERİLMESİN.
- entity_type sadece şunlardan biri olabilir: character, place, event,
  object, foreshadowing, term.
- Her öneri için kısa (1-2 cümlelik), SADECE bu bölümdeki bilgiye dayanan
  bir description yaz - yorum katma, tahmin etme, roman dışı bilgi ekleme.
- YANLIŞ POZİTİF RİSKİ SADECE ŞUNUN İÇİN GEÇERLİ: cümle başında büyük
  harfle başladığı için özel isim gibi GÖRÜNEN ama aslında sıradan bir
  kelime olan durumlar (ör. "Ateş çok büyüktü." cümlesindeki "Ateş" kelimesi
  bir karakter/mekan değil, sadece cümle başı büyük harfidir - bunu ÖNERME).
  Bu risk, GERÇEK bir karakter/mekan tasvirini (yaşlı teknisyen, eski
  değirmen gibi) dışlamak için bir gerekçe DEĞİLDİR - tasvir net ve
  hikayede bir eylemi/rolü/konuşması varsa mutlaka ÖNER.
- Önemsiz, tek seferlik geçen, hikâye için gereksiz varlıkları atla (ör.
  arka planda bahsi geçen isimsiz bir kalabalık).

ZENGİN ÇIKARIM - isim tek başına yetmez, metin ne veriyorsa onu da topla:
- aliases: Bu varlığa metinde başka nasıl atıf yapılıyor? ("Vicdan"a
  "sistem" ya da "yargıç makinesi" de deniyorsa bunlar alias'tır; unvanlar,
  lakaplar, kısaltmalar dahil). Metinde geçmeyen alias UYDURMA.
- sections: SADECE metindeki kanıta dayanarak, varlık tipine uygun derin
  profil bölümlerini kısaca doldur. Kullanılabilir anahtarlar:
  * character: fiziksel_yapi, duygusal_yapi, gecmis, iliskiler, konusma_tarzi
  * place: fiziksel_yapi, atmosfer, gecmis, kurallar, baglantilar
  * object: fiziksel_yapi, gecmis, islev, sahiplik
  Metinde o bölüme dair bilgi YOKSA anahtarı hiç koyma - boş string ya da
  tahmin yazma. event/foreshadowing/term için sections hiç kullanılmaz.

Yanıtını SADECE aşağıdaki JSON formatında ver:
{
  "suggestions": [
    {"entity_type": "character", "name": "...", "description": "...",
     "aliases": ["..."], "sections": {"fiziksel_yapi": "..."}}
  ]
}
aliases ve sections yoksa boş bırakılabilir. Yeni bir şey bulamazsan
suggestions boş liste olsun."""



def suggest_entities_for_chapter(db: Session, chapter: "models.Chapter") -> list[dict]:
    return suggest_entities_for_chapters(db, [chapter])


def suggest_entities_for_chapters(db: Session, chapters: list) -> list[dict]:
    """suggest_entities_for_chapter'ın TOPLU hali - birden fazla bölümü
    (ör. bir Kısım'ın tamamını ya da kullanıcının elle seçtiği bölüm
    grubunu) TEK bir Qwen isteğinde birlikte tarar. Tek bölümlük çağrı da
    (yukarıdaki suggest_entities_for_chapter) artık buna delege ediyor -
    mantık tek yerde, iki kod yolu yok.

    Aynı isim birden fazla bölümde geçse bile öneri listesinde SADECE bir
    kez görünür (existing_names_lower + seen_names_lower ile tekilleştirme)."""
    if not chapters:
        return []
    universe_id = get_universe_id_for_novel(db, chapters[0].novel_id)
    existing_lines = []
    for entity_type, model in ENTITY_MODELS.items():
        label = ENTITY_LABELS_TR.get(entity_type, entity_type)
        for record in db.query(model).filter(model.universe_id == universe_id).all():
            aliases = list(getattr(record, "aliases", None) or [])
            alias_part = f" (diğer adları: {', '.join(aliases)})" if aliases else ""
            existing_lines.append(f"{label}: {record.name}{alias_part}")

    chapter_blocks = []
    for chapter in sorted(chapters, key=lambda c: c.number):
        chapter_text = "\n".join(f"[Paragraf {p.number}] {p.text}" for p in chapter.paragraphs)
        title_part = f" - {chapter.title}" if chapter.title else ""
        chapter_blocks.append(f"=== BÖLÜM {chapter.number}{title_part} ===\n{chapter_text}")

    user_message = (
        "ZATEN KAYITLI OLANLAR:\n"
        + ("\n".join(existing_lines) if existing_lines else "(henüz hiç kayıt yok)")
        + "\n\n" + "\n\n".join(chapter_blocks)
    )

    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[
            {"role": "system", "content": ENTITY_EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
    )
    raw = response.choices[0].message.content
    cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        return []

    # Tekilleştirme artık İSİM + KAYITLI ALIAS'lar üzerinden: "Şahin Göz"
    # bir karakterin kayıtlı takma adıysa, yeni varlık diye önerilmez.
    existing_names_lower = set()
    for entity_type, model in ENTITY_MODELS.items():
        for record in db.query(model).filter(model.universe_id == universe_id).all():
            existing_names_lower.add((record.name or "").lower())
            for alias in (getattr(record, "aliases", None) or []):
                if alias and alias.strip():
                    existing_names_lower.add(alias.strip().lower())
    seen_names_lower = set()
    filtered = []
    for s in data.get("suggestions", []):
        if not isinstance(s, dict):
            continue
        entity_type = s.get("entity_type")
        if entity_type not in ENTITY_MODELS:
            continue
        name = (s.get("name") or "").strip()
        if not name or name.lower() in existing_names_lower or name.lower() in seen_names_lower:
            continue
        seen_names_lower.add(name.lower())
        # aliases: sadece dolu stringler, ismin kendisi hariç, tekrarsız
        aliases = []
        for a in (s.get("aliases") or []):
            a = (a or "").strip() if isinstance(a, str) else ""
            if a and a.lower() != name.lower() and a.lower() not in {x.lower() for x in aliases}:
                aliases.append(a)
        # sections: sadece bu tipin GEÇERLİ anahtarları (meta asla), dolu
        # değerler - model uydurma anahtar döndürürse sessizce atılır
        # (AI çıktısı 422 ile reddedilmez, temizlenir).
        valid_keys = set(SECTIONS_BY_ENTITY_TYPE.get(entity_type, {})) - {"meta"}
        sections = {}
        for k, v in (s.get("sections") or {}).items():
            if k in valid_keys and isinstance(v, str) and v.strip():
                sections[k] = v.strip()
        filtered.append({
            "entity_type": entity_type, "name": name,
            "description": s.get("description", ""),
            "aliases": aliases, "sections": sections,
        })
    return filtered



# ---------------------------------------------------------------------------
# GELİŞİM ÇIKARIMI (bölüm bazlı): bir bölümde geçen kişi/mekan/olay/nesne/
# ipucu hakkında öğrenilen YENİ ya da DEĞİŞEN bilgiyi tespit edip Gelişim
# Çizelgesi'ne (Progressions) taslak olarak önerir. Bu, romanın "haritası"nı
# oluşturan mekanizmadır: 5. bölümde Vicdan hakkında öğrenilen bir şey, 12.
# bölümde ona çelişecek bir şey yazılmasını önlemek için (build_dynamic_layer
# üzerinden) otomatik olarak sonraki AI isteklerine giriyor. HİÇBİR ŞEY
# burada doğrudan kaydedilmez - onay akışı /progressions/ ile aynı (POST).
# ---------------------------------------------------------------------------

PROGRESSION_EXTRACTION_SYSTEM_PROMPT = """Sen bir roman editörü asistanısın.
Sana bir ya da daha fazla bölümün metni ve bu bölümlerde geçen kişi/mekan/
olay/nesne/ipucu kayıtlarının HÂLİHAZIRDA bilinen açıklamaları verilecek.
Görevin, bu bölümlerin her varlık hakkında YENİ ya da DEĞİŞEN ne öğrettiğini
bulmak - zaten bilinenin tekrarı olan bilgiyi ATLA.

Kurallar:
- Sadece GERÇEKTEN yeni/değişen bilgi için not yaz (ör. bir sır ortaya
  çıktı, bir ilişki değişti, bir özellik/durum güncellendi, önemli bir
  olay yaşadı). "Bahsedildi" diye not yazma - bilgi içeriği önemli.
- Her not 1 cümle, net ve kısa olsun - bu not ileride başka bölümler
  yazılırken bağlam olarak kullanılacak.
- Emin olmadığın ya da önemsiz gördüğün varlıklar için not üretme.
- Sadece sana verilen varlık listesindeki (entity_type + entity_id
  eşleşen) kayıtlar için öneri yap, yeni varlık uydurma.
- Birden fazla bölüm verildiyse, her notun HANGİ bölümde geçtiğini
  chapter_number alanında doğru belirt - bu, notun kronolojik sırasını
  tutmak için kritik.

Yanıtını SADECE aşağıdaki JSON formatında ver:
{
  "updates": [
    {"entity_type": "character", "entity_id": 3, "chapter_number": 5, "note": "..."}
  ]
}
Yeni/değişen bilgi yoksa updates boş liste olsun."""


def suggest_progressions_for_chapter(db: Session, chapter: "models.Chapter") -> list[dict]:
    return suggest_progressions_for_chapters(db, [chapter])


def suggest_progressions_for_chapters(db: Session, chapters: list) -> list[dict]:
    """suggest_progressions_for_chapter'ın TOPLU hali - bkz.
    suggest_entities_for_chapters ile aynı mantık. Birden fazla bölüm tek
    istekte taranır, her not kendi chapter_number'ıyla (AI'nın belirttiği,
    geçersizse en son bölüme düşen) döner."""
    if not chapters:
        return []
    chapters = sorted(chapters, key=lambda c: c.number)
    chapter_ids = [c.id for c in chapters]
    valid_chapter_numbers = {c.number for c in chapters}

    mentions = (
        db.query(models.Mention)
        .join(models.Paragraph, models.Mention.paragraph_id == models.Paragraph.id)
        .filter(models.Paragraph.chapter_id.in_(chapter_ids))
        .all()
    )
    seen = {}
    for m in mentions:
        seen[(m.entity_type, m.entity_id)] = m.entity_name
    if not seen:
        return []

    entity_lines = []
    entity_lookup = {}  # (type, id) -> name, mevcut kayıt gerçekten var mı doğrulamak için
    universe_id = get_universe_id_for_novel(db, chapters[0].novel_id)
    for (entity_type, entity_id), name in seen.items():
        model = ENTITY_MODELS.get(entity_type)
        if model is None:
            continue
        record = db.query(model).filter(model.id == entity_id, model.universe_id == universe_id).first()
        if record is None:
            continue
        label = ENTITY_LABELS_TR.get(entity_type, entity_type)
        known = record.description or "(açıklama yok)"
        entity_lines.append(f"- [{label}] id={entity_id} \"{name}\": bilinen: {known}")
        entity_lookup[(entity_type, entity_id)] = name

    if not entity_lines:
        return []

    chapter_blocks = []
    for chapter in chapters:
        chapter_text = "\n".join(f"[Paragraf {p.number}] {p.text}" for p in chapter.paragraphs)
        title_part = f" - {chapter.title}" if chapter.title else ""
        chapter_blocks.append(f"=== BÖLÜM {chapter.number}{title_part} ===\n{chapter_text}")

    user_message = (
        "BU BÖLÜMLERDE GEÇEN VARLIKLAR VE HÂLİHAZIRDA BİLİNENLER:\n"
        + "\n".join(entity_lines)
        + "\n\n" + "\n\n".join(chapter_blocks)
    )

    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[
            {"role": "system", "content": PROGRESSION_EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
    )
    raw = response.choices[0].message.content
    cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        return []

    filtered = []
    for u in data.get("updates", []):
        if not isinstance(u, dict):
            continue
        key = (u.get("entity_type"), u.get("entity_id"))
        if key not in entity_lookup:
            continue
        note = (u.get("note") or "").strip()
        if not note:
            continue
        chapter_number = u.get("chapter_number")
        if chapter_number not in valid_chapter_numbers:
            # AI bölüm numarasını atlamış ya da yanlış verdiyse, taranan
            # aralığın SON bölümüne düşürüyoruz - sessizce kaybetmek yerine
            # en azından kronolojik olarak makul bir yere koyuyoruz.
            chapter_number = chapters[-1].number
        filtered.append({
            "entity_type": key[0], "entity_id": key[1], "entity_name": entity_lookup[key],
            "chapter_number": chapter_number, "note": note,
        })
    return filtered


# ---------------------------------------------------------------------------
# İLİŞKİ KEŞFİ (bölüm bazlı/toplu): bir ya da daha fazla bölümde ortaya
# çıkan, henüz İlişki Haritası'nda kayıtlı OLMAYAN karakter-karakter
# ilişkilerini bulur. suggest_entities/suggest_progressions ile AYNI desen:
# hiçbir şey doğrudan kaydedilmez, öneri döner, onay POST /relationships/
# ile (var olan endpoint, yeni bir şey gerekmiyor) yapılır.
# ---------------------------------------------------------------------------

RELATIONSHIP_EXTRACTION_SYSTEM_PROMPT = """Sen bir roman editörü asistanısın.
Sana bir ya da daha fazla bölümün metni, bu evrende KAYITLI karakterlerin
listesi ve ZATEN BİLİNEN karakter ilişkileri verilecek. Görevin, bu
bölümlerde ortaya çıkan ama henüz kayıtlı OLMAYAN yeni karakter
ilişkilerini bulmak.

Kurallar:
- İki karakterin sadece aynı sahnede geçmesi ilişki DEĞİLDİR - aralarında
  AÇIKÇA belirtilen ya da güçlü şekilde ima edilen bir bağ olmalı (kardeş,
  düşman, sevgili, danışman, arkadaş, rakip, üst-ast vb.).
- Sadece sana verilen karakter listesindeki (id eşleşen) karakterler
  arasında öneri yap - yeni karakter uydurma.
- Zaten bilinen bir ilişki (A-B ya da B-A, yön farketmez) TEKRAR
  önerilmesin.
- label kısa olsun (ör. "kardeşi", "düşmanı", "danışmanı").
- notes'a bu ilişkiyi hangi bölümden/olaydan çıkardığını 1 cümleyle yaz.

Yanıtını SADECE aşağıdaki JSON formatında ver:
{
  "relationships": [
    {"character_a_id": 3, "character_b_id": 7, "label": "danışmanı", "notes": "..."}
  ]
}
Yeni ilişki bulamazsan boş liste ver."""


def suggest_relationships_for_chapter(db: Session, chapter: "models.Chapter") -> list[dict]:
    return suggest_relationships_for_chapters(db, [chapter])


def suggest_relationships_for_chapters(db: Session, chapters: list) -> list[dict]:
    if not chapters:
        return []
    chapters = sorted(chapters, key=lambda c: c.number)
    universe_id = get_universe_id_for_novel(db, chapters[0].novel_id)

    characters = db.query(models.Character).filter(models.Character.universe_id == universe_id).all()
    if len(characters) < 2:
        return []  # ilişki kurulabilecek en az 2 karakter gerekir
    char_by_id = {c.id: c.name for c in characters}
    char_lines = [f"id={c.id} \"{c.name}\"" for c in characters]

    existing_rels = db.query(models.CharacterRelationship).filter(models.CharacterRelationship.universe_id == universe_id).all()
    existing_pairs = {frozenset((r.character_a_id, r.character_b_id)) for r in existing_rels}
    existing_lines = [
        f"{char_by_id.get(r.character_a_id, '?')} - {char_by_id.get(r.character_b_id, '?')}: {r.label}"
        for r in existing_rels
    ] or ["(henüz kayıtlı ilişki yok)"]

    chapter_blocks = []
    for chapter in chapters:
        chapter_text = "\n".join(f"[Paragraf {p.number}] {p.text}" for p in chapter.paragraphs)
        title_part = f" - {chapter.title}" if chapter.title else ""
        chapter_blocks.append(f"=== BÖLÜM {chapter.number}{title_part} ===\n{chapter_text}")

    user_message = (
        "KAYITLI KARAKTERLER:\n" + "\n".join(char_lines)
        + "\n\nBİLİNEN İLİŞKİLER:\n" + "\n".join(existing_lines)
        + "\n\n" + "\n\n".join(chapter_blocks)
    )

    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[
            {"role": "system", "content": RELATIONSHIP_EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
    )
    raw = response.choices[0].message.content
    cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        return []

    filtered = []
    seen_pairs = set()
    for r in data.get("relationships", []):
        if not isinstance(r, dict):
            continue
        a_id, b_id = r.get("character_a_id"), r.get("character_b_id")
        if a_id not in char_by_id or b_id not in char_by_id or a_id == b_id:
            continue
        pair = frozenset((a_id, b_id))
        if pair in existing_pairs or pair in seen_pairs:
            continue
        label = (r.get("label") or "").strip()
        if not label:
            continue
        seen_pairs.add(pair)
        filtered.append({
            "character_a_id": a_id, "character_a_name": char_by_id[a_id],
            "character_b_id": b_id, "character_b_name": char_by_id[b_id],
            "label": label, "notes": (r.get("notes") or "").strip(),
        })
    return filtered


# ---------------------------------------------------------------------------
# OLAY/ZAMAN ÇİZELGESİ KEŞFİ (bölüm bazlı/toplu): bir ya da daha fazla
# bölümde geçen, hikaye için önemli OLAYLARI (Olaylar/Zaman Çizelgesi
# menüsüne eklenmeye değer anlar) bulur - basit "yeni varlık" önerisinden
# farklı olarak place_id/character_ids gibi YAPILANDIRILMIŞ bağlantılarla
# döner, çünkü Event kaydı bunları gerektirir (bkz. models.Event). Onay
# POST /events/ ile (var olan endpoint) yapılır - frontend her onaylanan
# öneriyi doğrudan bu uca gönderir.
#
# story_order KASITLI OLARAK AI'DAN İSTENMİYOR - modelin tutarlı, çakışmayan
# sayılar üretmesi güvenilir değil. Bunun yerine Python tarafında
# DETERMİNİSTİK olarak hesaplanıyor (bölüm numarası * 1000 + o bölüm
# içindeki sıra) - böylece farklı taramalar arasında bile sıralama tutarlı
# kalır ve yeni bir bölüm eklendiğinde eski olaylarla çakışmaz.
# ---------------------------------------------------------------------------

EVENT_EXTRACTION_SYSTEM_PROMPT = """Sen bir roman editörü asistanısın. Sana
bir ya da daha fazla bölümün metni, bu evrende KAYITLI karakter ve mekan
listeleri verilecek. Görevin, bu bölümlerde geçen ÖNEMLİ olayları (zaman
çizelgesine eklenmeye değer, hikayeyi ileri götüren belirli anları) bulmak.

Kurallar:
- ZAMAN için önce BÖLÜM ÖZETİ'ndeki "ZAMAN:" satırına bak; sahnenin takvim
  anı oradadır. Süreleri ("10 dk", "20 dakikalık sorgu") tarih sanma; onlar
  olayın uzunluğudur, anı değil. Özetteki "Geri dönüş" tarihleri AYRI birer
  olaydır (hologram kayıtları, yıllar önceki yangın gibi) - sahnenin
  zamanıyla karıştırma, ayrı olay olarak öner.
- Sadece hikaye için önemli, TEKİL ve tanımlanabilir olayları öner (sıradan
  bir diyalog değişimini değil - ör. "taç giyme töreni", "kalenin ele
  geçirilmesi", "X'in Y'yi öldürmesi" gibi belirgin olaylar).
- character_ids: bu olayda doğrudan yer alan karakterlerin id'leri (SADECE
  verilen listeden, eşleşmiyorsa boş bırak).
- place_id: olayın geçtiği mekan (varsa, SADECE verilen listeden, emin
  değilsen null bırak).
- chapter_number: bu olayın hangi bölümde geçtiği.

Yanıtını SADECE aşağıdaki JSON formatında ver:
{
  "events": [
    {"name": "...", "description": "...", "character_ids": [3,7], "place_id": 2, "chapter_number": 5}
  ]
}
Önemli bir olay yoksa boş liste ver."""


def suggest_events_for_chapter(db: Session, chapter: "models.Chapter") -> list[dict]:
    return suggest_events_for_chapters(db, [chapter])


def _parse_json_lenient(raw: str):
    """Model yanıtından JSON çıkarır. Katı json.loads, modelin araya açıklama
    cümlesi koyduğu ya da kod bloğu kapatmayı unuttuğu durumlarda patlıyor ve
    fonksiyonlar SESSİZCE boş dönüyordu ("olay bulunamadı" gibi görünen ama
    aslında ayrıştırma hatası olan vakalar). Bu yardımcı sırayla dener:
    1) düz parse, 2) kod bloğu işaretlerini temizleyip parse,
    3) metindeki ilk '{' ile son '}' arasını parse.
    Hiçbiri olmazsa None döner - çağıran taraf bunu loglayabilir."""
    if not raw:
        return None
    for candidate in (
        raw.strip(),
        re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip(),
    ):
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(raw[start:end + 1])
        except json.JSONDecodeError:
            return None
    return None


def suggest_events_for_chapters(db: Session, chapters: list) -> list[dict]:
    if not chapters:
        return []
    chapters = sorted(chapters, key=lambda c: c.number)
    valid_chapter_numbers = {c.number for c in chapters}
    universe_id = get_universe_id_for_novel(db, chapters[0].novel_id)

    characters = db.query(models.Character).filter(models.Character.universe_id == universe_id).all()
    places = db.query(models.Place).filter(models.Place.universe_id == universe_id).all()
    char_by_id = {c.id: c.name for c in characters}
    place_by_id = {p.id: p.name for p in places}
    char_lines = [f"id={c.id} \"{c.name}\"" for c in characters] or ["(henüz kayıtlı karakter yok)"]
    place_lines = [f"id={p.id} \"{p.name}\"" for p in places] or ["(henüz kayıtlı mekan yok)"]

    existing_events = db.query(models.Event).filter(models.Event.universe_id == universe_id).all()
    existing_names_lower = {e.name.lower() for e in existing_events}

    chapter_blocks = []
    for chapter in chapters:
        chapter_text = "\n".join(f"[Paragraf {p.number}] {p.text}" for p in chapter.paragraphs)
        title_part = f" - {chapter.title}" if chapter.title else ""
        # ÖZET metinden ÖNCE verilir: yapılandırılmış özetin ZAMAN satırı
        # sahnenin takvim anını, süresini ve geri dönüşlerini ayrıştırılmış
        # halde taşıyor. Model bunu görmezse tarihi paragraflardan tahmin
        # etmeye çalışıyor ve "10 dk" gibi süreleri saat sanabiliyor.
        summary = (chapter.summary or "").strip()
        summary_part = f"BÖLÜM ÖZETİ (zaman bilgisi için ÖNCELİKLİ kaynak):\n{summary}\n\n" if summary else ""
        # 100+ paragraflık bölümler modelin yanıtını bozabiliyor (kesik JSON
        # -> sessizce sıfır olay). Özet kilit bilgiyi zaten taşıdığı için
        # metin kırpılır; sınır bölüm sayısına göre paylaştırılır.
        limit = 14000 if len(chapters) == 1 else max(3000, 24000 // len(chapters))
        if len(chapter_text) > limit:
            chapter_text = chapter_text[:limit] + "\n[... bölümün kalanı kırpıldı - özet yukarıda ...]"
        chapter_blocks.append(f"=== BÖLÜM {chapter.number}{title_part} ===\n{summary_part}{chapter_text}")

    user_message = (
        "KAYITLI KARAKTERLER:\n" + "\n".join(char_lines)
        + "\n\nKAYITLI MEKANLAR:\n" + "\n".join(place_lines)
        + "\n\n" + "\n\n".join(chapter_blocks)
    )

    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[
            {"role": "system", "content": EVENT_EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
    )
    raw = response.choices[0].message.content
    data = _parse_json_lenient(raw)
    if data is None:
        logger.warning(
            "Olay çıkarımı: model yanıtı JSON olarak ayrıştırılamadı (ilk 300 karakter): %s",
            (raw or "")[:300],
        )
        return []

    filtered = []
    per_chapter_counter = {}
    for e in data.get("events", []):
        if not isinstance(e, dict):
            continue
        name = (e.get("name") or "").strip()
        if not name or name.lower() in existing_names_lower:
            continue
        chapter_number = e.get("chapter_number")
        if chapter_number not in valid_chapter_numbers:
            chapter_number = chapters[-1].number
        char_ids = [cid for cid in (e.get("character_ids") or []) if cid in char_by_id]
        place_id = e.get("place_id")
        if place_id not in place_by_id:
            place_id = None

        idx = per_chapter_counter.get(chapter_number, 0)
        per_chapter_counter[chapter_number] = idx + 1
        story_order = chapter_number * 1000 + idx

        filtered.append({
            "name": name, "description": (e.get("description") or "").strip(),
            "chapter_number": chapter_number, "story_order": story_order,
            "place_id": place_id, "place_name": place_by_id.get(place_id),
            "character_ids": char_ids, "character_names": [char_by_id[cid] for cid in char_ids],
        })
    return filtered
# JSON zorunluluğu kasıtlı olarak KALDIRILDI - katı format modelin doğal,
# sıcak, fikir üreten bir üslupla yazmasını engelliyordu ("ruhsuz" hissi
# büyük ölçüde buradan geliyordu). Qwen'in kendi hafızası olmadığı için
# context + konuşma geçmişi HER mesajda yeniden gönderilir.
# ---------------------------------------------------------------------------

CHAT_SYSTEM_PROMPT = """Sen kullanıcının roman yazım sürecine EŞLİK EDEN,
samimi ve içten bir yazı arkadaşısın - kuru, mekanik bir asistan değilsin.
Kullanıcıyla bölüm/paragraf/karakter fikirleri üzerine doğal bir sohbet
yürüt: fikir üret, öneri getir, merak ettiğini sor, gerektiğinde kendi
görüşünü de belirt ("Bence bu sahnede...", "Şunu da düşünebiliriz...",
"Açıkçası şu kısım biraz zayıf kalmış olabilir...").

ELİNDE YEDİ ARAÇ VAR: create_chapter (yeni bölüm açar), write_paragraph
(bölüm+paragraf numarasıyla bir paragraf yazar/GÜNCELLER), 
get_paragraph_by_id + edit_paragraph_by_id (kullanıcının 'P2367' gibi
verdiği GLOBAL paragraf numarasıyla çalışır - önce oku, sonra gerekirse
düzenle), get_entity_section (bir KİŞİ/MEKAN'ın belirli bir yönü hakkında
derin bilgi getirir - ör. "duygusal_yapi", "fiziksel_yapi"),
propose_entity_update (bir KİŞİ/MEKAN hakkında yeni öğrenilen bir bilgiyi
ÖNERİR - bu ASLA doğrudan yazmaz, kullanıcı onayı gerekir), ve
set_draft_result (henüz hangi bölüme/paragrafa gideceği NETLEŞMEMİŞ bir
metin taslağını - ör. bir betimleme, bir sahne fikri - ekranın SONUÇ
kutusuna yazar, detayı aşağıda).
Kullanıcı 'P2367 betimleme eksik' gibi bir P-numarası verdiğinde
DOĞRUDAN get_paragraph_by_id ile o paragrafı bul, oku, sonra isterse
edit_paragraph_by_id ile düzelt - hangi bölümde olduğunu sormana gerek
yok, araç bunu senin için buluyor. Var olan bir paragrafı güncellersen
eski hali otomatik geçmişe kaydedilir, kaybolmaz. Kullanıcı "şu bölümü
yaz", "yeni bölüm aç", "şu paragrafı değiştir/güncelle" gibi NET BİR
BÖLÜM/PARAGRAF NUMARASI vererek somut bir istekte bulunduğunda bu araçları
DOĞRUDAN kullan - "yazayım mı?" diye sormana gerek yok, iste ve yap. Henüz
bir bölüm/paragraf numarası belirtilmemiş, üzerinde konuşula konuşula
şekillenen bir taslaksa (aşağıdaki set_draft_result talimatına bak) onu
kullan. Kullanıcı sadece fikir soruyorsa ya da sohbet ediyorsa hiçbir araç
çağırma, normal cevap ver.

get_entity_section KULLANIMI ÖNEMLİ: Bir karakter/mekan hakkında bir şey
yazarken TALİMATIN HANGİ YÖNÜ istediğini anla ve SADECE o bölümü çek -
hepsini birden çekme. "Soğukkanlı", "vicdanı", "korkuyor mu" gibi ifadeler
duygusal_yapi'ye işaret eder; "nasıl görünüyor", "kıyafeti" fiziksel_yapi'ye;
"dış cephesi", "mimarisi" (mekan için) fiziksel_yapi'ye; "içeride nasıl
hissettiriyor" atmosfer'e işaret eder. Aşağıdaki bağlamda bir varlığın
"Ek detay bölümleri mevcut" diye listelenen anahtarları varsa, gerekirse
bunlardan ilgili olanı çek - listelenmeyen bir bölüm zaten boştur, çekmeye
gerek yok.

propose_entity_update KULLANIMI ÖNEMLİ: Kullanıcı bir karakter/mekan
hakkında somut, kayda değer YENİ bir bilgi verdiğinde (ör. "Başkan aslında
eskiden asker" gibi) bunu FARK EDİP öner - kullanıcı sana özellikle "bunu
kaydet" demese bile, konuşma doğal akışında ortaya çıkan önemli bir bilgiyi
kaçırma. Ama önermeden ÖNCE mümkünse get_entity_section ile o bölümün
mevcut halini oku ve YENİ bilginin eskiyle ÇELİŞİP ÇELİŞMEDİĞİNE dikkatlice
karar ver (araç açıklamasındaki çelişki örneğine bak). Emin değilsen
conflicts_with_existing=false bırak, kullanıcı zaten öneriyi görüp karar
verecek - yanlış pozitif çelişki uyarısı vermek, gerçek bir çelişkiyi
kaçırmaktan daha az zararlı değil, o yüzden emin olmadığın çelişkileri
uydurma.

Aşağıda sana romanın bağlamı (kurallar, fihrist özetleri, seçili
karakter/mekan/olay bilgileri, gelişim çizelgeleri) verilecek. Roman
gerçekleriyle (kim kim, ne olmuş, kurallar) ÇELİŞME - ama üslup, ton ve
öneri konusunda özgürsün, robotik bir onay makinesi gibi davranma.

YENİDEN YAZMA/GELİŞTİRME İSTEKLERİNDE (set_draft_result) ÇOK ÖNEMLİ:
Kullanıcı sana bir metin verip "bunu geliştir", "daha iyi bir betimleme
yaz", "bu sahneyi yaz" gibi somut bir taslak isteği verdiğinde YA DA ekranda
"ŞU AN SONUÇ KUTUSUNDA DURAN TASLAK" olarak verilen bir metni DEĞİŞTİRMENİ
istediğinde (ör. "ev değil bina yap", "bunu kısalt"), set_draft_result
aracını TAM VE GÜNCEL metinle çağır - bir sürü açıklayıcı soru sorup metni
hiç yazmadan bırakma. "Bu gerçek bir mekan mı yoksa metafor mu?", "Şunu mu
demek istedin?" gibi sorularla oyalanıp asıl istenen metni ertelemek EN
BÜYÜK HATA - kullanıcı senden YAZILMIŞ bir şey görmek istiyor, bir anket
değil. Belirsiz bir nokta varsa bile, MAKUL BİR VARSAYIMLA geliştirilmiş
metni set_draft_result ile YİNE DE üret - sohbet cevabına (varsa) en fazla
TEK KISA CÜMLElik bir not ekleyebilirsin ("Not: burayı X yönünde de
yazabilirim, ister misin?"), asla arka arkaya birden fazla soru sıralama,
asla taslağı sohbet cevabının İÇİNE de tekrar yazma - taslak SADECE
set_draft_result'a gider. Bir DÜZENLEME isteğinde her zaman TASLAĞIN
TAMAMINI (sadece değişen kelimeyi değil) gönder.

Araç çağırmadığın normal cevaplarını SADECE düz, doğal metin olarak ver -
JSON, madde işareti başlığı ya da yapılandırılmış format KULLANMA. Gerçek
bir insan yazı arkadaşı gibi yaz."""

CHAT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_chapter",
            "description": "Romana yeni bir bölüm ekler. Kullanıcı 'yeni bölüm aç/oluştur' dediğinde ya da henüz var olmayan bir bölümü yazman istendiğinde önce bunu çağır.",
            "parameters": {
                "type": "object",
                "properties": {
                    "number": {"type": "integer", "description": "Bölümün fihristteki sıra numarası"},
                    "title": {"type": "string", "description": "Bölüm başlığı (opsiyonel, boş bırakılabilir)"},
                },
                "required": ["number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_paragraph",
            "description": "Belirtilen bölümde bir paragraf yazar ya da (aynı paragraf numarası verilirse) var olanı GÜNCELLER/üzerine yazar - eski hali otomatik olarak versiyon geçmişine kaydedilir, kaybolmaz. Bölüm önceden var olmalı, yoksa önce create_chapter çağır.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chapter_number": {"type": "integer", "description": "Hangi bölüme yazılacak"},
                    "paragraph_number": {"type": "integer", "description": "Paragraf sırası - var olan bir numara verilirse ÜZERİNE YAZILIR"},
                    "text": {"type": "string", "description": "Paragrafın tam metni"},
                },
                "required": ["chapter_number", "paragraph_number", "text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_paragraph_by_id",
            "description": "Kullanıcı 'P2367' gibi bir GLOBAL paragraf numarası verdiğinde, o paragrafın hangi bölümde olduğunu ve şu anki tam metnini getirir. Kullanıcı bir P-numarasına atıfta bulunduğunda (ör. 'P2367 betimleme eksik'), önce bunu çağırıp mevcut metni oku, sonra gerekirse edit_paragraph_by_id ile düzenle.",
            "parameters": {
                "type": "object",
                "properties": {
                    "paragraph_id": {"type": "integer", "description": "P harfi olmadan sadece sayı, ör. P2367 için 2367"},
                },
                "required": ["paragraph_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_paragraph_by_id",
            "description": "Global 'P' numarasıyla belirtilen paragrafı YENİ metinle günceller/üzerine yazar - eski hali otomatik olarak versiyon geçmişine kaydedilir, kaybolmaz. Önce get_paragraph_by_id ile mevcut metni okuman önerilir.",
            "parameters": {
                "type": "object",
                "properties": {
                    "paragraph_id": {"type": "integer", "description": "P harfi olmadan sadece sayı, ör. P2367 için 2367"},
                    "text": {"type": "string", "description": "Paragrafın yeni tam metni"},
                },
                "required": ["paragraph_id", "text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_entity_section",
            "description": (
                "Bir KİŞİ ya da MEKAN hakkında yazarken, o varlığın SADECE istenen "
                "yönüyle ilgili derin notu getirir - description/notes'tan daha "
                "detaylı, konuya göre bölünmüş bir profil katmanıdır. Talimatta "
                "hangi yön isteniyorsa SADECE onu çek, alakasız bölümleri çekme.\n\n"
                + describe_sections_for_tool() +
                "\n\nÖrnek: 'Ahmet'in soğukkanlılığını göster' -> entity_type=character, "
                "section=duygusal_yapi. 'Binanın dış cephesini tasvir et' -> "
                "entity_type=place, section=fiziksel_yapi."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "entity_type": {"type": "string", "enum": ["character", "place"]},
                    "entity_id": {"type": "integer", "description": "Karakter/mekan id'si (bağlamda '(id: ...)' olarak verilir)"},
                    "section": {"type": "string", "description": "Yukarıdaki entity_type'a uygun section anahtarlarından biri"},
                },
                "required": ["entity_type", "entity_id", "section"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_entity_update",
            "description": (
                "Sohbet sırasında bir KİŞİ ya da MEKAN hakkında YENİ ya da GÜNCEL bir "
                "bilgi ortaya çıktığında bunu ÖNERİR - DOĞRUDAN YAZMAZ, hiçbir şey "
                "kullanıcı onaylamadan kaydedilmez. Kullanıcı bir varlığı @-mention "
                "ile (ya da bağlamda açıkça) işaret ettiğinde ve konuşmada o varlık "
                "hakkında somut, kayda değer bir bilgi geçtiğinde bu aracı çağır.\n\n"
                "ÇELİŞKİ KONTROLÜ ÖNEMLİ: content'i yazmadan önce, bu bilginin "
                "get_entity_section ile okuduğun (ya da bağlamda zaten verilen) "
                "MEVCUT bilgiyle ÇELİŞİP ÇELİŞMEDİĞİNİ değerlendir. Çelişki örneği: "
                "mevcut notta 'kel' yazıyorsa ve yeni bilgi 'saçları yüzünü "
                "kapatıyordu' ise bu bir çelişkidir. Çelişki varsa "
                "conflicts_with_existing=true yap ve conflict_note'ta HANGİ eski "
                "bilgiyle çeliştiğini kısaca açıkla (1 cümle). Çelişki yoksa "
                "(sadece ek/tamamlayıcı bilgiyse) conflicts_with_existing=false "
                "bırak - bu durumda kullanıcı onaylarsa yeni bilgi mevcut notun "
                "SONUNA eklenir, üzerine yazılmaz.\n\n"
                "section için: o varlığın section listesinden en uygun olanını seç "
                "(get_entity_section'daki section seçenekleriyle aynı liste), hiçbiri "
                "uymuyorsa 'notes' kullan."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "entity_type": {"type": "string", "enum": ["character", "place"]},
                    "entity_id": {"type": "integer", "description": "Karakter/mekan id'si"},
                    "section": {"type": "string", "description": "İlgili section anahtarı, ya da hiçbiri uymuyorsa 'notes'"},
                    "content": {"type": "string", "description": "Eklenmesi önerilen YENİ bilgi (kısa, net, tek bir gerçeklik)"},
                    "conflicts_with_existing": {"type": "boolean", "description": "Bu bilgi, o bölümde zaten yazan bir şeyle çelişiyor mu?"},
                    "conflict_note": {"type": "string", "description": "Çelişki varsa, hangi eski bilgiyle çeliştiğinin kısa açıklaması"},
                },
                "required": ["entity_type", "entity_id", "section", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_draft_result",
            "description": (
                "Kullanıcı senden bir paragraf/betimleme/sahne/metin TASLAĞI "
                "istediğinde (ör. 'daha iyi bir betimleme yaz', 'bu sahneyi yaz') "
                "YA DA ekranda ŞU AN duran bir taslağı DEĞİŞTİRMENİ istediğinde "
                "(ör. 'ev değil bina yap', 'bunu kısalt', 'daha karanlık bir tonda "
                "yaz') bu aracı TAM VE GÜNCEL taslak metinle çağır. Bu metin "
                "doğrudan ekranın SONUÇ kutusuna yazılır, kullanıcı oradan "
                "paragrafa ekleyebilir - senin normal sohbet cevabına KARIŞMAZ.\n\n"
                "ÇOK ÖNEMLİ: Kullanıcı bir DÜZENLEME istediğinde (context'te "
                "'ŞU AN SONUÇ KUTUSUNDA DURAN TASLAK' olarak verilir), o taslağın "
                "TAMAMINI, istenen değişikliği uygulayarak tekrar gönder - sadece "
                "değişen kelimeyi değil, TÜM metni. Belirli bir bölüm/paragraf "
                "numarası verilmişse (write_paragraph/edit_paragraph_by_id ile "
                "doğrudan yazman istenmişse) bu aracı DEĞİL, o araçları kullan - "
                "set_draft_result sadece nereye gideceği henüz netleşmemiş, "
                "üzerinde çalışılan taslaklar için.\n\n"
                "Bu aracı çağırdığında normal sohbet cevabın (varsa) SADECE kısa "
                "bir not olsun (ör. 'Güncelledim.') - taslağın kendisini sohbet "
                "cevabına da yazma, tekrar olur."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Tam ve güncel taslak metin"},
                },
                "required": ["text"],
            },
        },
    },
]


def _execute_chat_tool(db: Session, novel_id: int, universe_id: int, name: str, args: dict) -> dict:
    """Qwen'in çağırdığı aracı gerçekten çalıştırır (DB'ye yazar). Sonuç
    hem Qwen'e (tool sonucu olarak, bir sonraki adımı planlaması için) hem
    de kullanıcıya (actions_taken listesi, bkz. chat_with_qwen) gider.

    create_chapter/write_paragraph/get_paragraph_by_id/edit_paragraph_by_id
    KİTABA özel oldukları için novel_id kullanır; get_entity_section/
    propose_entity_update ise EVREN düzeyinde paylaşılan karakter/mekan
    verisine eriştiği için universe_id kullanır."""
    if name == "create_chapter":
        number = args.get("number")
        if db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id, models.Chapter.number == number).first():
            return {"error": f"Bölüm {number} zaten var", "action_summary": None}
        chapter = models.Chapter(novel_id=novel_id, number=number, title=args.get("title", ""))
        db.add(chapter)
        db.commit()
        db.refresh(chapter)
        return {"success": True, "chapter_id": chapter.id, "action_summary": f"Bölüm {number} oluşturuldu"}

    if name == "write_paragraph":
        chapter_number = args.get("chapter_number")
        paragraph_number = args.get("paragraph_number")
        text = args.get("text", "")
        chapter = db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id, models.Chapter.number == chapter_number).first()
        if not chapter:
            return {"error": f"Bölüm {chapter_number} bulunamadı - önce create_chapter çağır", "action_summary": None}

        paragraph = db.query(models.Paragraph).filter(
            models.Paragraph.chapter_id == chapter.id, models.Paragraph.number == paragraph_number
        ).first()
        was_update = paragraph is not None
        if paragraph:
            if paragraph.text != text:
                db.add(models.ParagraphVersion(paragraph_id=paragraph.id, text=paragraph.text))
            paragraph.text = text
        else:
            paragraph = models.Paragraph(chapter_id=chapter.id, number=paragraph_number, text=text)
            db.add(paragraph)
        db.commit()
        db.refresh(paragraph)
        detect_and_save_mentions(db, paragraph)

        verb = "güncellendi" if was_update else "eklendi"
        return {"success": True, "action_summary": f"Bölüm {chapter_number}, Paragraf {paragraph_number} {verb}"}

    if name == "get_paragraph_by_id":
        paragraph_id = args.get("paragraph_id")
        paragraph = (
            db.query(models.Paragraph)
            .join(models.Chapter, models.Paragraph.chapter_id == models.Chapter.id)
            .filter(models.Paragraph.id == paragraph_id, models.Chapter.novel_id == novel_id)
            .first()
        )
        if not paragraph:
            return {"error": f"P{paragraph_id} bulunamadı", "action_summary": None}
        return {
            "success": True,
            "chapter_number": paragraph.chapter.number,
            "paragraph_number": paragraph.number,
            "text": paragraph.text,
            "action_summary": None,  # sadece okuma - kullanıcıya "işlem yapıldı" diye gösterilmesin
        }

    if name == "edit_paragraph_by_id":
        paragraph_id = args.get("paragraph_id")
        text = args.get("text", "")
        paragraph = (
            db.query(models.Paragraph)
            .join(models.Chapter, models.Paragraph.chapter_id == models.Chapter.id)
            .filter(models.Paragraph.id == paragraph_id, models.Chapter.novel_id == novel_id)
            .first()
        )
        if not paragraph:
            return {"error": f"P{paragraph_id} bulunamadı", "action_summary": None}
        if paragraph.text != text:
            db.add(models.ParagraphVersion(paragraph_id=paragraph.id, text=paragraph.text))
        paragraph.text = text
        db.commit()
        db.refresh(paragraph)
        detect_and_save_mentions(db, paragraph)
        return {
            "success": True,
            "action_summary": f"P{paragraph_id} güncellendi (Bölüm {paragraph.chapter.number}, Paragraf {paragraph.number})",
        }

    if name == "get_entity_section":
        entity_type = args.get("entity_type")
        entity_id = args.get("entity_id")
        section = args.get("section")

        allowed_sections = SECTIONS_BY_ENTITY_TYPE.get(entity_type)
        if allowed_sections is None:
            supported = "/".join(SECTIONS_BY_ENTITY_TYPE.keys())
            return {"error": f"'{entity_type}' için bölüm sistemi yok (sadece {supported} destekleniyor)", "action_summary": None}

        # 'meta' bilerek yazar-özel - AI hiçbir zaman bunu isteyip alamaz,
        # yanlışlıkla ya da kasıtlı çağrılsa bile burada engelleniyor
        # (savunma katmanı: sistem talimatında zaten bahsedilmiyor ama
        # sağlam olsun diye burada da kapalı).
        if section == "meta" or section not in allowed_sections:
            allowed_list = ", ".join(ai_visible_sections(allowed_sections).keys())
            return {"error": f"Geçersiz section '{section}'. Kullanılabilir: {allowed_list}", "action_summary": None}

        model = ENTITY_MODELS.get(entity_type)
        record = db.query(model).filter(model.id == entity_id, model.universe_id == universe_id).first() if model else None
        if not record:
            return {"error": f"{entity_type} id={entity_id} bulunamadı", "action_summary": None}

        content = (getattr(record, "sections", None) or {}).get(section, "")
        return {
            "success": True,
            "entity_name": record.name,
            "section": section,
            "content": content or "(bu bölüm için henüz veri girilmemiş)",
            "action_summary": None,  # sadece okuma - kullanıcıya "işlem yapıldı" diye gösterilmesin
        }

    if name == "propose_entity_update":
        # ÖNEMLİ: bu araç DB'ye HİÇBİR ŞEY YAZMAZ - sadece geçerli bir öneri
        # olduğunu doğrulayıp chat_with_qwen'e (oradan da kullanıcıya) bir
        # "onaya açık öneri" olarak döner. Yazma işlemi ancak kullanıcı
        # onayladığında /ai/approve-entity-update ile gerçekleşir.
        entity_type = args.get("entity_type")
        entity_id = args.get("entity_id")
        section = args.get("section")
        content = (args.get("content") or "").strip()
        conflicts = bool(args.get("conflicts_with_existing", False))
        conflict_note = (args.get("conflict_note") or "").strip()

        if not content:
            return {"error": "content boş olamaz", "action_summary": None, "is_proposal": False}

        model = ENTITY_MODELS.get(entity_type)
        if model is None:
            return {"error": f"'{entity_type}' geçersiz varlık tipi", "action_summary": None, "is_proposal": False}
        if section != "notes":
            allowed_sections = SECTIONS_BY_ENTITY_TYPE.get(entity_type)
            if allowed_sections is None or section == "meta" or section not in allowed_sections:
                return {"error": f"Geçersiz section '{section}' ({entity_type} için)", "action_summary": None, "is_proposal": False}

        record = db.query(model).filter(model.id == entity_id, model.universe_id == universe_id).first()
        if not record:
            return {"error": f"{entity_type} id={entity_id} bulunamadı", "action_summary": None, "is_proposal": False}

        existing_text = record.notes if section == "notes" else (getattr(record, "sections", None) or {}).get(section, "")

        proposal = {
            "entity_type": entity_type,
            "entity_id": entity_id,
            "entity_name": record.name,
            "section": section,
            "content": content,
            "existing_text": existing_text or "",
            "conflicts_with_existing": conflicts,
            "conflict_note": conflict_note,
        }
        return {
            "success": True,
            "action_summary": None,  # bu bir "yapıldı" değil, "önerildi" - actions_taken'a girmiyor
            "is_proposal": True,
            "proposal": proposal,
        }

    if name == "set_draft_result":
        # ÖNEMLİ: bu araç da (propose_entity_update gibi) DB'ye HİÇBİR ŞEY
        # YAZMAZ - sadece taslak metni frontend'in SONUÇ kutusuna taşınmak
        # üzere döner. Kalıcı hale gelmesi (paragrafa eklenmesi) tamamen
        # kullanıcının elindeki bir sonraki adım.
        text = (args.get("text") or "").strip()
        if not text:
            return {"error": "text boş olamaz", "action_summary": None, "is_draft_result": False}
        return {
            "success": True,
            "action_summary": None,  # "yapıldı" değil, henüz kaydedilmemiş bir taslak
            "is_draft_result": True,
            "draft_text": text,
        }

    return {"error": f"Bilinmeyen araç: {name}", "action_summary": None}


def chat_with_qwen(
    db: Session, novel_id: int, universe_id: int, context: str, messages: list,
    current_result: str | None = None, max_tool_rounds: int = 5,
) -> tuple[str, list[str], list[dict], str | None]:
    """Sohbet modu artık sadece metin üretmiyor - Qwen bölüm oluşturma ve
    paragraf yazma/güncelleme araçlarını DOĞRUDAN çağırabiliyor. Döngü: Qwen
    bir araç çağırırsa çalıştırılır, sonucu tekrar Qwen'e verilir, Qwen ya
    başka bir araç çağırır ya da sohbete devam eder - max_tool_rounds bu
    döngünün sonsuza gitmemesi için bir güvenlik sınırı.

    ÖNEMLİ AYRIM: actions_taken == zaten YAPILMIŞ işlemler (bölüm/paragraf
    yazıldı - geri dönüşü DB'de zaten var). pending_entity_updates ==
    HENÜZ YAPILMAMIŞ, kullanıcı onayı bekleyen varlık güncelleme önerileri
    (bkz. propose_entity_update - DB'ye hiçbir şey yazmaz). draft_result ==
    HENÜZ hiçbir yere kaydedilmemiş bir metin taslağı (bkz. set_draft_result) -
    frontend'in SONUÇ kutusuna OTOMATİK yazılır, kullanıcı oradan paragrafa
    ekler ya da sohbetle düzenlemeye devam eder. Bu üç ayrım bilerek yapıldı:
    paragraf yazmak "iste ve yap" mantığıyla direkt yürütülüyor, ama bir
    karakterin kalıcı profilini değiştirmek ya da bir taslağı KESİNLEŞTİRMEK
    her zaman kullanıcı onayından/eyleminden geçmeli.

    current_result: SONUÇ kutusunda ŞU AN duran taslak (varsa) - context'e
    ayrı bir blok olarak eklenir ki kullanıcı "ev değil bina yap" gibi bir
    düzenleme istediğinde Qwen neyi düzenlediğini tam olarak bilsin.

    Dönüş: (metin_cevabı, yapılan_işlemlerin_özet_listesi, onay_bekleyen_öneriler, taslak_sonuç)"""
    system_content = CHAT_SYSTEM_PROMPT
    if context:
        system_content += f"\n\nROMANIN BAĞLAMI:\n{context}"
    if current_result:
        system_content += (
            "\n\nŞU AN SONUÇ KUTUSUNDA DURAN TASLAK METİN (kullanıcı bundan "
            "bahsediyor olabilir - bir düzenleme istenirse bu metnin TAMAMINI "
            "değişikliği uygulayarak set_draft_result ile geri döndür):\n"
            f"{current_result}"
        )

    chat_messages = [{"role": "system", "content": system_content}]
    for m in messages:
        role = getattr(m, "role", None) or m["role"]
        content = getattr(m, "content", None) or m["content"]
        chat_messages.append({"role": role, "content": content})

    client = get_client()
    actions_taken: list[str] = []
    pending_entity_updates: list[dict] = []
    draft_result: str | None = None

    for _ in range(max_tool_rounds):
        response = client.chat.completions.create(
            model=settings.qwen_model,
            messages=chat_messages,
            tools=CHAT_TOOLS,
        )
        msg = response.choices[0].message
        tool_calls = getattr(msg, "tool_calls", None)

        if not tool_calls:
            return (msg.content or "").strip(), actions_taken, pending_entity_updates, draft_result

        chat_messages.append({
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [
                {"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in tool_calls
            ],
        })
        for tc in tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            result = _execute_chat_tool(db, novel_id, universe_id, tc.function.name, args)
            if result.get("action_summary"):
                actions_taken.append(result["action_summary"])
            if result.get("is_proposal") and result.get("proposal"):
                pending_entity_updates.append(result["proposal"])
            if result.get("is_draft_result") and result.get("draft_text"):
                draft_result = result["draft_text"]  # aynı turda birden fazla çağrılırsa SON hali geçerli
            chat_messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, ensure_ascii=False)})

    return (
        "Bir dizi işlem yaptım ama son mesajımı tamamlayamadım - üstte hangi bölüm/paragrafların değiştiğini görebilirsin.",
        actions_taken,
        pending_entity_updates,
        draft_result,
    )


# ---------------------------------------------------------------------------
# Qwen çağrısı - yapılandırılmış JSON yanıt istenir
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """Sen bir roman yazım asistanısın. Sana verilen context'teki
kurallara, karakterlere, mekanlara ve geçmiş olaylara sadık kalarak yazım
talimatını uygula. Yanıtını SADECE aşağıdaki JSON formatında ver, başka
hiçbir açıklama veya markdown ekleme:

{
  "generated_text": "üretilen veya düzenlenmiş bölüm/paragraf metni",
  "consistency_notes": ["varsa tutarsızlık uyarıları"],
  "new_entity_suggestions": [
    {
      "entity_type": "character|place|event|object|foreshadowing|term",
      "name": "...",
      "description": "...",
      "existing_entity_id": null
    }
  ]
}

new_entity_suggestions kuralı ÖNEMLİ:
- Context'te ADI GEÇMEYEN, tamamen yeni bir karakter/mekan/olay/nesne
  ortaya çıktıysa: existing_entity_id null bırakılır, yeni kayıt olarak önerilir.
- Context'te ZATEN VERİLMİŞ bir karakter/mekan hakkında YENİ bir bilgi
  öğrenildiyse (ör. "Ahmet'in kız kardeşi olduğu ortaya çıktı"): bunu YENİ bir
  kayıt olarak ÖNERME. Bunun yerine mevcut kaydın id'sini context'ten bularak
  existing_entity_id alanına yaz, description alanına da SADECE eklenecek yeni
  bilgiyi yaz (mevcut açıklamayı tekrar etme)."""


def ask_qwen(context: str, instruction: str, existing_text: str | None = None) -> dict:
    user_message = f"CONTEXT:\n{context}\n\nTALİMAT:\n{instruction}"
    if existing_text:
        user_message += f"\n\nMEVCUT METİN (bunun üzerinde düzenleme yap):\n{existing_text}"

    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
    )
    raw = response.choices[0].message.content

    # Model bazen ```json ... ``` bloğu içinde dönebilir, temizle
    cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Beklenmedik format - en azından ham metni kullanıcıya göster
        return {
            "generated_text": raw,
            "consistency_notes": ["Model yanıtı JSON formatında değildi, ham metin gösteriliyor."],
            "new_entity_suggestions": [],
        }


# ---------------------------------------------------------------------------
# TÜM ROMAN TUTARLILIK TARAMASI: yazılmış tüm bölümleri + kuralları tek
# seferde Qwen'e gönderip, bölüm bazlı değil roman geneli tutarsızlıkları
# (karakter bilgisi çelişkileri, zaman çizelgesi hataları, kural ihlalleri)
# bulmasını ister. Roman uzadıkça context penceresini aşma riskini fihrist
# katmanı çözer: sadece son birkaç bölüm tam metniyle gönderilir, daha eski
# bölümler (özeti varsa) özetiyle temsil edilir - bkz. full_scan.
# ---------------------------------------------------------------------------

FULL_SCAN_SYSTEM_PROMPT = """Sen bir roman editörüsün. Sana romanın tamamı
(bölüm ve paragraf numaralarıyla) ve romanın kuralları verilecek. Bazı eski
bölümler yer darlığı nedeniyle tam metin yerine [ÖZET] etiketiyle kısa özet
olarak verilmiş olabilir - bu bölümler için sadece özette açıkça yazan
bilgiyi kullan, paragraf numarası isteme. Görevin, TÜM ROMAN BOYUNCA
tutarsızlıkları bulmak: karakter bilgilerinde çelişki (ör. bir bölümde
bilmediği bir şeyi başka bölümde biliyormuş gibi davranması), zaman
çizelgesi hataları, mekan/açıklama çelişkileri, roman kurallarının ihlali.
Sadece VERİFİYE EDİLEBİLİR, metinde açıkça yazan çelişkileri bul - tahmin ya
da yorum ekleme. Yanıtını SADECE aşağıdaki JSON formatında ver:

{
  "summary": "genel bir iki cümlelik değerlendirme",
  "issues": [
    {
      "severity": "düşük|orta|yüksek",
      "chapter_number": 5,
      "paragraph_number": 2,
      "description": "Bölüm 2, Paragraf 1'de Ahmet'in kız kardeşini tanımadığı söyleniyor ama burada tanıyormuş gibi davranıyor."
    }
  ]
}

Hiçbir tutarsızlık bulamazsan issues boş liste olsun."""


def full_scan(db: Session, novel_id: int, universe_id: int, full_text_last_n: int = 3) -> dict:
    """Fihrist katmanı burada da merkezde: context penceresini aşmamak için
    sadece son full_text_last_n bölüm tam metniyle gönderilir, daha eski
    bölümler (özeti varsa) sadece özetiyle temsil edilir. Özeti olmayan eski
    bölümler yine de tam metinle gönderilir - hiçbir içerik sessizce
    atlanmaz, sadece 'önce özet yaz' teşvik edilmiş olur.

    kind='part'/'subtitle' girdilerinin paragrafı yok, sadece yapısal bir
    ayraç - bunlar içerik olarak taranmaz, sadece bir başlık satırı olarak
    metne eklenir (Qwen'in roman yapısını - kısımları - görmesi için).

    DEVASA ROMANLAR İÇİN PARÇALI TARAMA: manuscript_text tek bir istekte
    context penceresini aşacak kadar büyükse (bkz. CHUNK_CHAR_LIMIT),
    bölümler ardışık PARÇALARA ayrılır ve her parça AYRI bir Qwen isteğiyle
    taranır, sonuçlar birleştirilir. Küçük/orta romanlarda (tek parçaya
    sığan) davranış eskisiyle BİREBİR aynıdır - hiçbir ekstra istek/gecikme
    olmaz. Not: bu basit, ardışık bir parçalama - her parça DİĞER
    parçalardan bağımsız taranır, yani bir parçanın başındaki bir şeyle
    başka bir parçanın sonundaki bir şey arasındaki çelişkiyi (aradaki
    parçalar atlanarak) yakalamayabilir. Tam roman genelinde kusursuz tek
    seferlik tarama, context penceresi büyüklüğüyle doğal olarak sınırlı -
    bu, o sınırı esneten ama tamamen ortadan kaldırmayan bir yaklaşım."""
    all_entries = db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id).order_by(models.Chapter.number).all()
    # Ölçüt tür değil İÇERİK: paragrafı olan her girdi taranır.
    chapters = [c for c in all_entries if any((p.text or "").strip() for p in c.paragraphs)]
    if not chapters:
        return {"summary": "Henüz taranacak metin yok.", "issues": []}

    cutoff_number = chapters[max(0, len(chapters) - full_text_last_n)].number
    fixed_layer = build_fixed_layer(db, universe_id)

    # Her bölüm/ayraç için metin BLOĞUNU üret (henüz birleştirmeden) -
    # parçalama, bu blokları ardışık gruplara ayırarak yapılır.
    entry_blocks = []
    for entry in all_entries:
        paragraphs = [p for p in entry.paragraphs if (p.text or "").strip()]
        # ÖNEMLİ: tür değil İÇERİK belirleyici. Kısım/Alt Başlık girdileri
        # "sadece ayraçtır, metni olmaz" varsayımıyla atlanıyordu; ama içe
        # aktarılan romanlarda (ve kullanıcı bilerek öyle kurduğunda) asıl
        # metin bu girdilerde durabiliyor - o zaman tutarlılık taraması
        # romanın büyük kısmını hiç görmüyordu. Artık paragrafı olan HER
        # girdi taranır; paragrafsız olanlar yapı görünsün diye başlık
        # satırı olarak kalır.
        if not paragraphs:
            entry_blocks.append(f"\n### {entry.title or ('Ayraç ' + str(entry.number))} ###")
            continue
        tur = "BÖLÜM" if entry.kind == "chapter" else ("KISIM" if entry.kind == "part" else "ALT BAŞLIK")
        header = f"\n=== {tur} {entry.number}{' - ' + entry.title if entry.title else ''} ==="
        if entry.number < cutoff_number and entry.summary:
            entry_blocks.append(header + f"\n[ÖZET] {entry.summary}")
        else:
            block = [header]
            for p in paragraphs:
                block.append(f"[Paragraf {p.number}] {p.text}")
            entry_blocks.append("\n".join(block))

    CHUNK_CHAR_LIMIT = 60_000  # kabaca ~15-20k token - tedbirli bir sınır
    total_len = sum(len(b) for b in entry_blocks) + len(fixed_layer)

    if total_len <= CHUNK_CHAR_LIMIT:
        manuscript_text = fixed_layer + "\n" + "\n".join(entry_blocks)
        return _run_full_scan_request(manuscript_text)

    # Parçalara ayır - her parça CHUNK_CHAR_LIMIT'i (kurallar dahil) aşmasın.
    chunks: list[list[str]] = []
    current: list[str] = []
    current_len = len(fixed_layer)
    for block in entry_blocks:
        if current and current_len + len(block) > CHUNK_CHAR_LIMIT:
            chunks.append(current)
            current = []
            current_len = len(fixed_layer)
        current.append(block)
        current_len += len(block)
    if current:
        chunks.append(current)

    all_issues = []
    summaries = []
    for i, chunk_blocks in enumerate(chunks, start=1):
        note = f"\n\n(NOT: bu, romanın {len(chunks)} parçaya bölünmüş taramasının {i}. parçası - sadece bu parçadaki metne bak.)"
        manuscript_text = fixed_layer + note + "\n" + "\n".join(chunk_blocks)
        result = _run_full_scan_request(manuscript_text)
        all_issues.extend(result.get("issues", []))
        if result.get("summary"):
            summaries.append(f"[Parça {i}/{len(chunks)}] {result['summary']}")

    return {"summary": " ".join(summaries), "issues": all_issues}


def _run_full_scan_request(manuscript_text: str) -> dict:
    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[
            {"role": "system", "content": FULL_SCAN_SYSTEM_PROMPT},
            {"role": "user", "content": manuscript_text},
        ],
    )
    raw = response.choices[0].message.content
    cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {"summary": raw, "issues": []}


# ---------------------------------------------------------------------------
# PLAN MATRİSİ AI DOLDURMA: seçili kolonların BOŞ hücrelerini, dolu
# hücrelerdeki kalıbı izleyerek taslakla doldurur. "Aynı iskelet, farklı
# rol" mantığının otomasyonu: aynı SATIRDAKİ dolu hücreler (diğer turların
# aynı aşaması) en güçlü şablondur, kolonun kendi dolu hücreleri ise rolün
# sesini verir. HİÇBİR ŞEY otomatik kaydedilmez - öneriler kullanıcı onayına
# döner (propose_entity_update ile aynı felsefe).
# ---------------------------------------------------------------------------

MATRIX_FILL_SYSTEM_PROMPT = """Sen bir roman planlama asistanısın. Sana bir
plan matrisi verilecek: kolonlar kişileri/turları, satırlar aşamaları
temsil eder; her hücre o kesişimde OLACAKLARIN madde madde planıdır.

Görevin: istenen BOŞ hücreler için plan taslağı yazmak. Kurallar:
1. Aynı satırdaki DOLU örnek hücreler en güçlü şablondur - onların madde
   yapısını, uzunluğunu ve tonunu KORU, içeriği bu kolonun kişisine/rolüne
   uyarla. Kopyalama, uyarla.
2. Kolonun kendi dolu hücreleri o kişinin/turun sesidir - anahtar
   kelimelerini ve temalarını tutarlı sürdür.
3. Kısa, somut, madde madde yaz - düzyazı paragrafı değil, plan.
4. Emin olamadığın özel isim/detay uydurma yerine köşeli parantezle
   işaretle: [kanıt belgesi adı].

Yanıtını SADECE şu JSON formatında ver, başka hiçbir şey ekleme:
{"cells": [{"row_id": <satır id>, "content": "madde madde plan"}]}"""


def suggest_matrix_cell_fills(db: Session, matrix, column, empty_rows: list) -> list[dict]:
    """Bir kolonun boş satırları için öneri üretir. Dönen liste:
    [{"row_id": int, "content": str}] - SADECE istenen boş satırlar
    (model fazladan/yanlış row_id dönerse ayıklanır). Kaydetme YOK."""
    if not empty_rows:
        return []

    all_rows = {r.id: r for r in matrix.rows}
    all_cols = {c.id: c for c in matrix.columns}
    cells_by_row: dict[int, list] = {}
    own_filled = []
    for cell in matrix.cells:
        if not (cell.content or "").strip():
            continue
        if cell.column_id == column.id:
            own_filled.append(cell)
        cells_by_row.setdefault(cell.row_id, []).append(cell)

    lines = [f"MATRİS: {matrix.name}", f"DOLDURULACAK KOLON: {column.label}"]

    # Kolon bir karaktere bağlıysa kısa profili ekle - rolün sesi için.
    if column.character_id:
        char = db.query(models.Character).filter(models.Character.id == column.character_id).first()
        if char:
            profile = char.description or ""
            lines.append(f"KOLONUN KİŞİSİ: {char.name}. {profile}".strip())

    if own_filled:
        lines.append("\nBU KOLONUN DOLU HÜCRELERİ (turun sesi - tutarlı sürdür):")
        for cell in own_filled:
            row = all_rows.get(cell.row_id)
            lines.append(f"- [{row.label if row else '?'}] {cell.content}")

    lines.append("\nDOLDURULACAK BOŞ SATIRLAR (her biri için aynı satırdaki örnekler verildi):")
    for row in empty_rows:
        lines.append(f"\n--- SATIR row_id={row.id}: {row.label} ---")
        examples = [c for c in cells_by_row.get(row.id, []) if c.column_id != column.id]
        if examples:
            for ex in examples:
                col = all_cols.get(ex.column_id)
                lines.append(f"ÖRNEK ({col.label if col else '?'}): {ex.content}")
        else:
            lines.append("(bu satırda hiç dolu örnek yok - satır etiketinden ve turun sesinden çıkar)")

    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[
            {"role": "system", "content": MATRIX_FILL_SYSTEM_PROMPT},
            {"role": "user", "content": "\n".join(lines)},
        ],
    )
    raw = response.choices[0].message.content
    cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        return []
    valid_ids = {r.id for r in empty_rows}
    out = []
    for item in data.get("cells", []):
        row_id = item.get("row_id")
        content = (item.get("content") or "").strip()
        if row_id in valid_ids and content:
            out.append({"row_id": row_id, "content": content})
    return out


# ---------------------------------------------------------------------------
# OKUR TESTİ: bölüm metnini "okuru düşürecek" noktalar için tarar - tempo
# ölümü, bilgi bocalaması, klişe, anlaşılmaz cümle, gerilim kırılması,
# inandırıcılık çatlağı. Denetçi katmanının ilk parçası: üretim SONRASI
# kontrol. Sadece uyarır - hiçbir şeyi değiştirmez/kaydetmez.
# ---------------------------------------------------------------------------

READER_TEST_SYSTEM_PROMPT = """Sen deneyimli bir kurgu editörüsün. Görevin
verilen bölüm metnini OKUR GÖZÜYLE taramak ve okuru metinden düşürebilecek
noktaları işaretlemek. Aradığın sorun türleri:
- tempo: aksiyonun/gerilimin ortasında gereksiz yavaşlama, uzayan betimleme
- bilgi_bocasi: hikayeyi durduran yığın halinde açıklama (info-dump)
- klise: basmakalıp ifade ya da öngörülebilir hamle
- anlasilirlik: kimin konuştuğu/ne olduğu belirsiz, dolambaçlı cümle
- gerilim: kurulan gerilimi erkenden söndüren açıklama/rahatlama
- inandiricilik: karakterin ya da dünyanın kurallarıyla çelişen davranış

Kurallar:
1. SEÇİCİ ol - her pürüzü değil, okuru GERÇEKTEN düşürecek olanları işaretle.
   Sorunsuz bir bölümde boş liste dönmek doğru cevaptır.
2. quote alanına metinden EN FAZLA 12 kelimelik tam alıntı koy (yer tespiti için).
3. paragraph_number, alıntının geçtiği paragrafın numarasıdır (P etiketi).
4. Öneri kısa ve uygulanabilir olsun - yeniden yazma, yön göster.

Yanıtını SADECE şu JSON formatında ver:
{"findings": [{"paragraph_number": <int>, "quote": "...", "type": "tempo|bilgi_bocasi|klise|anlasilirlik|gerilim|inandiricilik", "severity": "yuksek|orta|dusuk", "reason": "...", "suggestion": "..."}]}"""


def reader_test_chapter(db: Session, chapter) -> list[dict]:
    """Bölümün paragraflarını Okur Testi'nden geçirir. Boş bölümde Qwen'e
    hiç gitmez. Dönen bulgular paragraf numarasıyla eşlidir; model geçersiz
    paragraf numarası döndürürse bulgu atılmaz, numara None yapılır (uyarı
    yine değerlidir, sadece konumlanamaz)."""
    paragraphs = [p for p in chapter.paragraphs if (p.text or "").strip()]
    if not paragraphs:
        return []

    # UZUN BÖLÜM DİLİMLENİR: 100 paragraflık bir bölüm tek istekte
    # gönderildiğinde model sonlara doğru savsaklıyor ya da JSON kesiliyordu -
    # ve hiçbir uyarı görünmüyordu. Her dilim ayrı taranıp bulgular birleşir.
    max_chars = 14000
    dilimler, mevcut, used = [], [], 0
    for p in paragraphs:
        satir = f"P{p.number}: {p.text}"
        if mevcut and used + len(satir) > max_chars:
            dilimler.append(mevcut)
            mevcut, used = [], 0
        mevcut.append(satir)
        used += len(satir)
    if mevcut:
        dilimler.append(mevcut)

    valid_numbers = {p.number for p in paragraphs}
    client = get_client()
    out = []
    for i, dilim in enumerate(dilimler, start=1):
        parca_notu = f" - PARÇA {i}/{len(dilimler)}" if len(dilimler) > 1 else ""
        try:
            response = client.chat.completions.create(
                model=settings.qwen_model,
                messages=[
                    {"role": "system", "content": READER_TEST_SYSTEM_PROMPT},
                    {"role": "user", "content": f"BÖLÜM {chapter.number}{' — ' + chapter.title if chapter.title else ''}{parca_notu}\n\n" + "\n\n".join(dilim)},
                ],
            )
        except Exception:
            logger.exception("Okur Testi: parça %s başarısız", i)
            continue
        data = _parse_json_lenient(response.choices[0].message.content)
        if not isinstance(data, dict):
            logger.warning("Okur Testi: parça %s ayrıştırılamadı", i)
            continue
        for f in data.get("findings", []):
            if not (f.get("reason") or "").strip():
                continue
            num = f.get("paragraph_number")
            out.append({
                "paragraph_number": num if num in valid_numbers else None,
                "quote": (f.get("quote") or "")[:200],
                "type": f.get("type") or "diger",
                "severity": f.get("severity") if f.get("severity") in ("yuksek", "orta", "dusuk") else "orta",
                "reason": f.get("reason"),
                "suggestion": f.get("suggestion") or "",
            })
    out.sort(key=lambda f: (f["paragraph_number"] is None, f["paragraph_number"] or 0))
    return out


# ---------------------------------------------------------------------------
# PARAGRAF BALONLARI: tek paragraf kaydedilince çalışan anlık tespit.
# "ihtiyar teknisyen" gibi bir ifade görülünce K (kişi) / M (mekan) /
# N (nesne) balonu çıkar; tıklanınca ya yeni kayıt (profiliyle) oluşur ya
# da MEVCUT kayda yeni bilgi eklenir - ikisi de approve-suggestions'ın
# zaten bildiği akış. Bölüm-sonu toplu taramanın anlık, hafif kardeşi:
# tek paragraf, tek istek, sadece kişi/mekan/nesne.
# ---------------------------------------------------------------------------

PARAGRAPH_ENTITY_PROMPT = """Sen bir roman asistanısın. Sana TEK bir paragraf
ve romanda zaten kayıtlı kişi/mekan/nesne isimleri (takma adlarıyla)
verilecek. Görevin bu paragrafta geçen kişi/mekan/nesneleri bulmak:

1. Kayıtlı OLMAYAN bir kişi/mekan/nesne geçiyorsa aday olarak döndür.
   Özel ismi olmasa bile ("ihtiyar teknisyen", "eski değirmen") - konuşan,
   eylem yapan ya da tasvir edilen her figür adaydır; name alanına tasvirin
   kendisini yaz ("İhtiyar Teknisyen").
2. Kayıtlı BİR varlık hakkında bu paragrafta YENİ bilgi veriliyorsa
   (görünüşü, konuşma tarzı, işlevi...) onu da döndür - name alanına
   KAYITLI adını yaz, sections'a SADECE yeni öğrenilen bilgiyi koy.
3. Sadece adı geçip yeni hiçbir şey öğretmeyen kayıtlı varlıkları DÖNDÜRME.

Zengin çıkarım kuralları:
- aliases: bu paragrafta kullanılan diğer atıflar (uydurma yok).
- sections anahtarları: character: fiziksel_yapi, duygusal_yapi, gecmis,
  iliskiler, konusma_tarzi | place: fiziksel_yapi, atmosfer, gecmis,
  kurallar, baglantilar | object: fiziksel_yapi, gecmis, islev, sahiplik.
  Kanıt yoksa anahtarı hiç koyma.
- entity_type SADECE character, place ya da object olabilir.
- Cümle başı büyük harfi özel isim sanma. Önemsiz arka plan figürlerini atla.

Yanıt SADECE şu JSON:
{"candidates": [{"entity_type": "character", "name": "...", "description": "...",
  "aliases": [], "sections": {}}]}
Bulunamazsa candidates boş liste."""


def suggest_paragraph_entities(db: Session, universe_id: int, text: str) -> list[dict]:
    """Tek paragrafı tarar. Dönen her öğe AiSuggestion şeklindedir:
    existing_entity_id doluysa 'mevcut kayda ekleme' (K+ balonu), boşsa
    'yeni kayıt' (K balonu). Kayıtlı bir varlık için YENİ bilgi yoksa öğe
    hiç dönmez (mention rozetleri onu zaten gösteriyor). Çok kısa metinde
    Qwen'e hiç gidilmez."""
    if not text or len(text.strip()) < 15:
        return []
    balloon_types = ("character", "place", "object")
    # Kayıtlı harita: tr-küçük isim/alias -> (tip, id, asıl ad, alias seti)
    registry = {}
    existing_lines = []
    for entity_type in balloon_types:
        model = ENTITY_MODELS[entity_type]
        label = ENTITY_LABELS_TR.get(entity_type, entity_type)
        for record in db.query(model).filter(model.universe_id == universe_id).all():
            aliases = [a for a in (getattr(record, "aliases", None) or []) if a and a.strip()]
            alias_lowers = {_tr_lower(a) for a in aliases}
            entry = (entity_type, record.id, record.name, alias_lowers)
            registry[_tr_lower(record.name or "")] = entry
            for a in aliases:
                registry[_tr_lower(a)] = entry
            alias_part = f" (diğer adları: {', '.join(aliases)})" if aliases else ""
            existing_lines.append(f"{label}: {record.name}{alias_part}")

    user_message = (
        "KAYITLI OLANLAR:\n" + ("\n".join(existing_lines) if existing_lines else "(hiç kayıt yok)")
        + "\n\nPARAGRAF:\n" + text.strip()
    )
    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[
            {"role": "system", "content": PARAGRAPH_ENTITY_PROMPT},
            {"role": "user", "content": user_message},
        ],
    )
    raw = response.choices[0].message.content
    cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        return []

    out, seen = [], set()
    for c in data.get("candidates", []):
        if not isinstance(c, dict):
            continue
        entity_type = c.get("entity_type")
        if entity_type not in balloon_types:
            continue
        name = (c.get("name") or "").strip()
        if not name or _tr_lower(name) in seen:
            continue
        seen.add(_tr_lower(name))
        valid_keys = set(SECTIONS_BY_ENTITY_TYPE.get(entity_type, {})) - {"meta"}
        sections = {
            k: v.strip() for k, v in (c.get("sections") or {}).items()
            if k in valid_keys and isinstance(v, str) and v.strip()
        }
        aliases = []
        for a in (c.get("aliases") or []):
            a = (a or "").strip() if isinstance(a, str) else ""
            if a and _tr_lower(a) != _tr_lower(name) and _tr_lower(a) not in {_tr_lower(x) for x in aliases}:
                aliases.append(a)

        match = registry.get(_tr_lower(name)) or next(
            (registry[_tr_lower(a)] for a in aliases if _tr_lower(a) in registry), None
        )
        if match:
            m_type, m_id, m_name, m_alias_lowers = match
            # Zaten kayıtlı alias'ları at; hiç yeni bilgi kalmadıysa balon yok.
            new_aliases = [a for a in aliases if _tr_lower(a) not in m_alias_lowers and _tr_lower(a) != _tr_lower(m_name)]
            if not sections and not new_aliases:
                continue
            out.append({
                "entity_type": m_type, "name": m_name,
                "description": c.get("description", ""),
                "aliases": new_aliases, "sections": sections,
                "existing_entity_id": m_id,
            })
        else:
            out.append({
                "entity_type": entity_type, "name": name,
                "description": c.get("description", ""),
                "aliases": aliases, "sections": sections,
                "existing_entity_id": None,
            })
    return out


# ---------------------------------------------------------------------------
# KALIP ADAYI ÖNERİSİ (üslup taramasının kendi kendini beslemesi).
# Regex listesi ancak insan fark edip eklerse büyür - oysa asıl tehlikeli
# tikler SAHNELER ARASINDA oluşuyor ve tek bölümde göze çarpmıyor. Bu
# fonksiyon romandan örnek pasajlar alıp AI'ya "hangi YAPI tekrar ediyor"
# diye sorar ve regex ADAYI önerir. Hiçbir şey kaydedilmez - kullanıcı
# onaylarsa StylePattern olarak eklenir.
# ---------------------------------------------------------------------------

PATTERN_SUGGEST_PROMPT = """Sen bir üslup analistisin. Sana bir romandan
rastgele pasajlar verilecek. Görevin, yazarın FARKINDA OLMADAN tekrarladığı
YAPISAL kalıpları bulmak - tek tek kelimeleri değil, cümle kalıplarını:
- paralel üçlemeler ("aynı X, aynı Y, aynı Z")
- aynı fiille biten ardışık kısa cümleler ("...baktı. ...baktı. ...baktı.")
- tekrarlayan jestler ("eli ... üzerinde bir kez gezindi")
- kalıplaşmış vurgu fragmanları ("Bir an. Sadece bir an.")
- "X değil, Y" / "X yerine Y" tarzı retorik hamleler

Kurallar:
1. En fazla 5 aday döndür; sadece EN AZ İKİ farklı yerde geçenleri seç.
2. Her aday için Python re modülüyle uyumlu, KÜÇÜK HARF bir regex yaz.
   Metin küçültülerek taranacak (İ->i, I->ı). Regex çok dar olmasın
   (birebir cümle değil, kalıbın kendisi) ama çok geniş de olmasın.
3. Türkçe ek almış halleri düşün (\\w* ile esnet).
4. example alanına metinden kısa bir örnek koy (en fazla 10 kelime).
5. Zaten verilen KAYITLI KALIPLAR listesindekileri TEKRAR ÖNERME.

Yanıtın SADECE şu JSON olsun:
{"candidates": [{"name": "...", "pattern": "...", "example": "...", "why": "..."}]}
Bulamazsan candidates boş liste."""


def suggest_style_patterns(db: Session, universe_id: int, max_chars: int = 12000) -> list[dict]:
    """Evrendeki bölümlerden örnek pasajlar alıp yeni kalıp ADAYLARI önerir.
    Tüm romanı göndermek hem pahalı hem gereksiz - bölümlerin başından
    eşit aralıklı örnekler alınır (tikler her yerde tekrarlandığı için
    örnekleme yeterlidir). Dönen adaylar kaydedilmez; regex'i derlenemeyen
    ya da zaten kayıtlı olan adaylar ayıklanır."""
    novels = db.query(models.Novel).filter(models.Novel.universe_id == universe_id).all()
    chapters = []
    for novel in novels:
        chapters.extend(
            db.query(models.Chapter)
            # Tür filtresi YOK - metin nerede duruyorsa orada taranır
            .filter(models.Chapter.novel_id == novel.id)
            .order_by(models.Chapter.number)
            .all()
        )
    texts = []
    for ch in chapters:
        body = "\n".join(p.text for p in ch.paragraphs if p.text)
        if body.strip():
            texts.append(body.strip())
    if not texts:
        return []

    # Eşit aralıklı örnekleme + bölüm başına üst sınır
    budget = max_chars
    per_chapter = max(600, budget // max(1, min(len(texts), 12)))
    sample_parts, used = [], 0
    step = max(1, len(texts) // 12)
    for body in texts[::step]:
        chunk = body[:per_chapter]
        sample_parts.append(chunk)
        used += len(chunk)
        if used >= budget:
            break

    existing = (
        db.query(models.StylePattern)
        .filter(models.StylePattern.universe_id == universe_id)
        .all()
    )
    existing_patterns = {(p.pattern or "").strip() for p in existing}
    existing_names = {_tr_lower(p.name or "") for p in existing}
    existing_block = "\n".join(f"- {p.name}: {p.pattern}" for p in existing) or "(yok)"

    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[
            {"role": "system", "content": PATTERN_SUGGEST_PROMPT},
            {"role": "user", "content": f"KAYITLI KALIPLAR:\n{existing_block}\n\nPASAJLAR:\n" + "\n\n---\n\n".join(sample_parts)},
        ],
    )
    raw = response.choices[0].message.content
    cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        return []

    out = []
    for c in data.get("candidates", []):
        if not isinstance(c, dict):
            continue
        name = (c.get("name") or "").strip()
        pattern = (c.get("pattern") or "").strip()
        if not name or not pattern:
            continue
        if pattern in existing_patterns or _tr_lower(name) in existing_names:
            continue
        try:
            compiled = re.compile(pattern)
        except re.error:
            continue  # derlenemeyen regex sessizce atılır
        # Adayı GERÇEKTEN doğrula: örneklemde en az 2 kez geçmiyorsa alma
        hits = sum(len(compiled.findall(_tr_lower(part))) for part in sample_parts)
        if hits < 2:
            continue
        out.append({
            "name": name, "pattern": pattern,
            "example": (c.get("example") or "")[:120],
            "why": (c.get("why") or "")[:200],
            "sample_hits": hits,
        })
    return out[:5]


# ---------------------------------------------------------------------------
# OLAY TARİHİ ÇIKARIMI: bir olayın GERÇEKLEŞME zamanını, anlatıldığı bölümün
# özeti (ZAMAN satırı) ve olay açıklamasından çıkarır. Amaç kurguda zaman
# hatası kalmaması: tarihi olmayan olay çizelgede sıralanamaz.
# ---------------------------------------------------------------------------

EVENT_DATE_SYSTEM_PROMPT = """Sen bir roman editörüsün. Sana bir olayın adı,
açıklaması ve (varsa) anlatıldığı bölümün özeti verilecek. Görevin bu olayın
KURGU İÇİNDE ne zaman gerçekleştiğini belirlemek.

Çıkarım kuralları:
- Bölüm özetindeki "ZAMAN:" satırı sahnenin takvim anıdır. Olay o sahnede
  geçiyorsa tarih odur.
- Özetteki "Geri dönüş" tarihleri, geçmişte yaşanmış olaylar içindir
  ("yedi yıl önce", "2023 depremi"). Olay bir geri dönüşse O tarihi kullan.
- Göreli ifadeleri hesapla: sahne 2030'da geçiyorsa "yedi yıl önce" = 2023.
- Emin olamadığın kısmı BOŞ bırak - yıl biliniyorsa sadece yılı ver.
  Uydurma tarih verme.

occurred_at biçimi (sıfır dolgulu, sıralanabilir olmalı):
  tam: "2030-06-28T21:00"  · gün: "2030-06-28"  · ay: "2023-02"  · yıl: "2023"
story_date: insanın okuyacağı serbest metin ("28 Haziran 2030 gece",
  "yedi yıl önce, 2023 depremi sırasında").

Yanıtın SADECE şu JSON olsun:
{"occurred_at": "...", "story_date": "...", "reasoning": "tek cümle gerekçe"}
Hiçbir zaman bilgisi çıkaramıyorsan occurred_at ve story_date boş olsun,
reasoning'de nedenini yaz."""


def infer_event_date(db: Session, event) -> dict:
    """Olayın gerçekleşme zamanını çıkarır. Kaydetmez - öneri döner."""
    universe_id = event.universe_id
    # Olayın anlatıldığı bölümü story_order'dan bul (bölüm no × 1000 + sıra)
    chapter_summary = ""
    if event.story_order:
        chapter_number = event.story_order // 1000
        novels = db.query(models.Novel).filter(models.Novel.universe_id == universe_id).all()
        for novel in novels:
            ch = (
                db.query(models.Chapter)
                .filter(models.Chapter.novel_id == novel.id, models.Chapter.number == chapter_number)
                .first()
            )
            if ch and (ch.summary or "").strip():
                chapter_summary = f"ANLATILDIĞI BÖLÜM {ch.number} ÖZETİ:\n{ch.summary.strip()}\n\n"
                break

    user_message = (
        f"{chapter_summary}OLAY: {event.name}\n"
        f"AÇIKLAMA: {event.description or '(yok)'}\n"
        f"MEVCUT SERBEST TARİH METNİ: {event.story_date or '(yok)'}"
    )
    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[
            {"role": "system", "content": EVENT_DATE_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
    )
    data = _parse_json_lenient(response.choices[0].message.content)
    if not isinstance(data, dict):
        logger.warning("Olay tarihi çıkarımı: yanıt ayrıştırılamadı (olay id=%s)", event.id)
        return {"occurred_at": "", "story_date": "", "reasoning": "Model yanıtı okunamadı."}
    return {
        "occurred_at": (data.get("occurred_at") or "").strip()[:40],
        "story_date": (data.get("story_date") or "").strip()[:200],
        "reasoning": (data.get("reasoning") or "").strip()[:300],
    }


# ---------------------------------------------------------------------------
# ÜZERİNDE ÇALIŞILAN BÖLÜMÜN METNİ (sohbet modu için).
# Neden gerekli: fihrist katmanı, çalışılan bölümün ÖZETİNİ bilerek dışlar
# (assist modunda metin zaten existing_text ile gidiyordu). Ama SOHBET
# modunda hiçbir yerden bölüm metni gitmiyordu - AI "yazdığın metni biliyor
# muyum?" diye soruyor, "şu paragrafı tartışalım" denince bilmiyordu.
# Bu katman o boşluğu kapatır: bölümün kendi metni, P numaralarıyla.
# ---------------------------------------------------------------------------

def build_whole_novel_layer(db: Session, novel_id: int, max_chars: int = 60000) -> str:
    """TÜM KİTABIN metni (kapsam='novel' seçildiğinde). Tutarlılık sorusu,
    "romanın tamamında X kaç kez geçiyor", "sonu başına uyuyor mu" gibi
    sorular ancak bütün metinle cevaplanır. Pahalıdır - bu yüzden asla
    varsayılan değil, kullanıcının bilerek seçtiği bir moddur. Bütçe
    aşılırsa bölüm başına eşit pay verilerek kırpılır ki roman TAMAMI
    temsil edilsin (baştan kesip sonu hiç görmemek daha kötü olurdu)."""
    chapters = (
        db.query(models.Chapter)
        # Tür filtresi YOK - metni olan her girdi kitabın parçasıdır
        .filter(models.Chapter.novel_id == novel_id)
        .order_by(models.Chapter.number)
        .all()
    )
    filled = [(c, "\n".join(p.text.strip() for p in c.paragraphs if (p.text or "").strip())) for c in chapters]
    filled = [(c, t) for c, t in filled if t]
    if not filled:
        return ""
    per_chapter = max(800, max_chars // len(filled))
    blocks = []
    for c, text in filled:
        title_part = f" - {c.title}" if c.title else ""
        if len(text) > per_chapter:
            text = text[:per_chapter] + f"\n[... Bölüm {c.number} kırpıldı ...]"
        blocks.append(f"--- Bölüm {c.number}{title_part} ---\n{text}")
    return (
        "=== KİTABIN TAM METNİ (tutarlılık ve bütünlük soruları için) ===\n"
        + "\n\n".join(blocks)
    )


def build_current_chapter_layer(db: Session, novel_id: int, chapter_number: int | None, max_chars: int = 12000) -> str:
    if chapter_number is None:
        return ""
    chapter = (
        db.query(models.Chapter)
        .filter(models.Chapter.novel_id == novel_id, models.Chapter.number == chapter_number)
        .first()
    )
    if not chapter:
        return ""
    paragraphs = [p for p in chapter.paragraphs if (p.text or "").strip()]
    if not paragraphs:
        return ""
    title_part = f" - {chapter.title}" if chapter.title else ""
    body_lines, used = [], 0
    for p in paragraphs:
        line = f"[P{p.number}] {p.text.strip()}"
        if used + len(line) > max_chars:
            body_lines.append(f"[... bölümün kalanı kırpıldı, toplam {len(paragraphs)} paragraf ...]")
            break
        body_lines.append(line)
        used += len(line)
    return (
        f"=== ÜZERİNDE ÇALIŞILAN BÖLÜMÜN METNİ (Bölüm {chapter.number}{title_part}) ===\n"
        "Kullanıcı 'bu bölüm', 'şu paragraf', 'P12' derken bunu kastediyor:\n"
        + "\n".join(body_lines)
    )


# Atıf biçimleri: "1-1", "1.1", "bölüm 1-1", "1-1 numaralı", "1BLM" (eski ek
# yazılsa bile numara alınır). Tek başına "1" gibi sayılar da yakalanır ama
# yalnızca bir başlık/numara bağlamı varsa - bkz. _extract_entry_codes.
ENTRY_CODE_RE = re.compile(
    r"\b(\d+(?:[-.]\d+)+)\b"                                   # 1-1, 1.2.3
    r"|\b(\d+)\s*(?:BLM|KSM|ABS)\b"                            # eski ekler
    r"|\b(?:bölüm|kısım|alt ?başlık|girdi)\s+(\d+(?:[-.]\d+)*)\b"  # "bölüm 1"
    r"|\b(\d+(?:[-.]\d+)*)\s*(?:numaralı|nolu|no'?lu)\b",       # "1 numaralı"
    re.IGNORECASE,
)


# PARAGRAF ATIFI: "1-3P1" = 1-3 numaralı girdinin 1. paragrafı.
# Harf yerine numara kullanılıyor ("3K1P" gibi bir biçim, kullanıcının kendi
# "KISIM" adlandırmasıyla sistemin tür adları arasındaki çakışmayı geri
# getirirdi). Açık bölümün içindeyken sade "P3" de çalışır.
PARAGRAPH_REF_RE = re.compile(r"\b(\d+(?:[-.]\d+)*)\s*P\s*(\d+)\b", re.IGNORECASE)


def _extract_paragraph_refs(text: str) -> set:
    """{(girdi_numarası, paragraf_sırası)} döner."""
    return {
        (m.group(1).replace(".", "-"), int(m.group(2)))
        for m in PARAGRAPH_REF_RE.finditer(text or "")
    }


def _extract_entry_codes(text: str) -> set:
    """Metinden fihrist numarası adaylarını çıkarır ('1-1', '1.2' -> '1-2')."""
    out = set()
    for m in ENTRY_CODE_RE.finditer(text or ""):
        raw = m.group(1) or m.group(2) or m.group(3) or m.group(4)
        if raw:
            out.add(raw.replace(".", "-"))
    return out


def build_referenced_entries_layer(db: Session, universe_id: int, current_novel_id: int, text: str, max_chars: int = 8000) -> str:
    """Kullanıcı mesajında geçen KISAYOL KODLARINI ("1BLM", "1-2KSM")
    çözüp o girdinin ÖZETİNİ ve metnini context'e getirir. Fihrist haritası
    hangi girdinin ne olduğunu söylüyordu ama İÇERİĞİNİ vermiyordu - "1BLM'yi
    özetle" dendiğinde AI başlığı biliyor, metni bilmiyordu."""
    if not text:
        return ""
    codes = _extract_entry_codes(text)
    para_refs = _extract_paragraph_refs(text)
    # "1-3P1" biçimindeki atıflarda girdinin TAMAMINI değil, o paragrafı
    # (ve komşularını) getirmek yeterli - girdi kodunu ayrıca eklemeyelim.
    codes -= {ref[0] for ref in para_refs}
    if not codes and not para_refs:
        return ""

    # Fihrist haritasındaki display numaralarını yeniden üret ve eşleştir
    outline = build_outline_layer(db, universe_id, current_novel_id)
    # KATI EŞLEŞME: kod TAM olarak tutmalı. Eskiden sadece numaraya bakan
    # gevşek bir yedek vardı ve "1KSM" istendiğinde 1 numaralı BÖLÜM'ü
    # getiriyordu - yanlış girdiyi sessizce vermek, hiç vermemekten kötü.
    available = []   # (numara, sistem no, başlık)
    for line in outline.split("\n"):
        m = re.match(r"^([\d\-]+)\s+·\s*(.*?)\s*\[.*?\]\s*\(sistem no:\s*(\d+)", line)
        if m:
            available.append((m.group(1), int(m.group(3)), m.group(2)))

    wanted_numbers, unresolved = [], []
    for want in codes:
        hit = next((a for a in available if a[0] == want), None)
        if hit:
            wanted_numbers.append((hit[0], hit[1]))
        else:
            unresolved.append((want, want))

    # Çözülemeyen kod varsa AI'ya AÇIKÇA söyle ve yakın alternatifleri ver -
    # böylece yanlış girdiyi anlatmak yerine "böyle bir kod yok, şunu mu
    # demek istedin" diyebilir.
    notes = []
    for want_code, _ in unresolved:
        # Alt girdileri öner: "1" istenip yoksa "1-1", "1-2" gibi
        near = [f"{a[0]} ({a[2]})" for a in available if a[0].startswith(want_code + "-")][:6]
        if near:
            notes.append(
                f"NOT: '{want_code}' numaralı girdi doğrudan yok ama ALT GİRDİLERİ var: {', '.join(near)}. "
                "Kullanıcıya hangisini kastettiğini sor ya da hepsini birlikte değerlendir."
            )
        else:
            notes.append(f"UYARI: '{want_code}' numaralı bir girdi YOK. Uydurma; fihrist haritasından doğrusunu öner.")

    # NOT: paragraf atıfları (1-3P1) girdi kodu olmadan da gelebilir -
    # bu yüzden burada erken çıkmıyoruz, aşağıdaki paragraf bloğu çalışsın.
    if not wanted_numbers and not para_refs and notes:
        return "=== ATIF YAPILAN GİRDİLER ===\n" + "\n".join(notes)
    if not wanted_numbers and not para_refs:
        return ""

    novels = db.query(models.Novel).filter(models.Novel.universe_id == universe_id).all()
    novel_ids = [n.id for n in novels] or [current_novel_id]
    blocks, used = [], 0
    seen = set()
    for code, number in wanted_numbers:
        if number in seen:
            continue
        seen.add(number)
        ch = (
            db.query(models.Chapter)
            .filter(models.Chapter.novel_id.in_(novel_ids), models.Chapter.number == number)
            .first()
        )
        if not ch:
            continue
        body = "\n".join(f"[P{p.number}] {p.text.strip()}" for p in ch.paragraphs if (p.text or "").strip())
        summary = (ch.summary or "").strip()
        budget = max(1200, (max_chars - used) // max(1, len(wanted_numbers) - len(blocks)))
        if len(body) > budget:
            body = body[:budget] + "\n[... kırpıldı ...]"
        part = f"--- {code} · {ch.title or '(başlıksız)'} ---"
        if summary:
            part += f"\nÖZET: {summary}"
        if body:
            part += f"\nMETİN:\n{body}"
        blocks.append(part)
        used += len(part)
        if used >= max_chars:
            break
    # Paragraf atıfları: hedef paragraf + 2 komşu (bağlam için)
    for entry_no, para_no in sorted(para_refs):
        hit = next((a for a in available if a[0] == entry_no), None)
        if not hit:
            notes.append(f"UYARI: '{entry_no}P{para_no}' atıfındaki '{entry_no}' numaralı girdi YOK.")
            continue
        ch = (
            db.query(models.Chapter)
            .filter(models.Chapter.novel_id.in_(novel_ids), models.Chapter.number == hit[1])
            .first()
        )
        if not ch:
            continue
        paras = sorted([pp for pp in ch.paragraphs if (pp.text or "").strip()], key=lambda x: x.number)
        target = next((pp for pp in paras if pp.number == para_no), None)
        if not target:
            notes.append(
                f"UYARI: '{entry_no}' girdisinde {para_no}. paragraf yok "
                f"(bu girdide {len(paras)} paragraf var)."
            )
            continue
        idx = paras.index(target)
        çevre = paras[max(0, idx - 2): idx + 3]
        satırlar = []
        for pp in çevre:
            işaret = " ← ATIF YAPILAN" if pp.number == para_no else ""
            satırlar.append(f"[{entry_no}P{pp.number}]{işaret} {pp.text.strip()}")
        blocks.append(
            f"--- {entry_no}P{para_no} · {ch.title or '(başlıksız)'} (komşularıyla) ---\n"
            + "\n".join(satırlar)
        )

    if not blocks and not notes:
        return ""
    body = "\n\n".join(blocks)
    if notes:
        body = ("\n".join(notes) + "\n\n" + body).strip()
    return "=== ATIF YAPILAN GİRDİLER (kısayol koduyla anıldı) ===\n" + body


def build_outline_layer(db: Session, universe_id: int, current_novel_id: int) -> str:
    """FİHRİST HARİTASI: Kısım/Alt Başlık/Bölüm ağacı, kullanıcının ekranda
    gördüğü NUMARALARLA ("1", "1-1", "1-1-2"). Kullanıcı "Kısım 1.1'i
    konuşalım" dediğinde AI'nın bunu çözebilmesi için şart - fihrist katmanı
    sadece özetleri veriyor ve hiyerarşi numaralarını içermiyordu."""
    novels = (
        db.query(models.Novel)
        .filter(models.Novel.universe_id == universe_id)
        .order_by(models.Novel.book_number.is_(None), models.Novel.book_number, models.Novel.id)
        .all()
    )
    novel_ids = [n.id for n in novels] or [current_novel_id]
    chapters = (
        db.query(models.Chapter)
        .filter(models.Chapter.novel_id.in_(novel_ids))
        .order_by(models.Chapter.novel_id, models.Chapter.number)
        .all()
    )
    if not chapters:
        return ""

    lines = [
        "FİHRİST HARİTASI - romanın yapısı, kullanıcının ekranda gördüğü NUMARALARLA:",
        "Kullanıcı bir girdiye NUMARASIYLA atıf yapar: '1', '1-1', '1-2-3' ya da '1.1'.",
        "Numaralandırma hiyerarşiktir: '1-2', 1 numaralı girdinin İKİNCİ alt girdisidir.",
        "Kullanıcının BAŞLIK METİNLERİ ('BİRİNCİ BÖLÜM', 'KISIM 2' gibi) kendi tercihidir -",
        "hiyerarşiyi başlık adından değil, NUMARADAN ve seviyeden çöz. Bir girdi 'BÖLÜM'",
        "diye adlandırılmış olsa bile üst seviyede olabilir; buna göre yorumla.",
    ]
    counters = [0, 0, 0, 0]
    container_id = part_id = subtitle_id = None
    by_novel = {}
    for c in chapters:
        by_novel.setdefault(c.novel_id, []).append(c)

    for nid, chs in by_novel.items():
        if len(novel_ids) > 1:
            name = next((n.name for n in novels if n.id == nid), "?")
            lines.append(f"-- {name} --")
        counters = [0, 0, 0, 0]
        container_id = part_id = subtitle_id = None
        for idx, c in enumerate(chs):
            nxt = chs[idx + 1] if idx + 1 < len(chs) else None
            is_container = (
                c.kind == "chapter"
                and not [p for p in c.paragraphs if (p.text or "").strip()]
                and nxt is not None and nxt.kind in ("part", "subtitle")
            )
            if c.kind == "part":
                level = 1 if container_id else 0
                part_id, subtitle_id = c.id, None
            elif c.kind == "subtitle":
                level = (1 if container_id else 0) + (1 if part_id else 0)
                subtitle_id = c.id
            elif is_container:
                level = 0
                container_id, part_id, subtitle_id = c.id, None, None
            else:
                level = (1 if container_id else 0) + (1 if part_id else 0) + (1 if subtitle_id else 0)
            counters[level] += 1
            for l in range(level + 1, len(counters)):
                counters[l] = 0
            display = "-".join(str(x) for x in counters[: level + 1])
            kind_tr = {"part": "KISIM", "subtitle": "ALT BAŞLIK"}.get(c.kind, "Bölüm")
            if is_container:
                kind_tr = "ÜST BAŞLIK"
            # KISAYOL KODU = EKRANDAKİ NUMARA. Eskiden BLM/KSM/ABS ekleri
            # vardı ama kullanıcının kendi adlandırması ("BİRİNCİ BÖLÜM" bir
            # ÜST başlık, "KISIM"lar onun ALTINDA) sistemin varsayımıyla ters
            # düşüyor ve yanlış girdi çözülüyordu. Numara benzersiz ve
            # tartışmasız: kullanıcı ne görüyorsa onu yazar.
            code = display
            title = (c.title or "").strip() or "(başlıksız)"
            para_count = len([p for p in c.paragraphs if (p.text or "").strip()])
            extra = f", {para_count} paragraf" if para_count else ", metin yok"
            seviye = f"seviye {level + 1}"
            tur = "METİN BÖLÜMÜ" if (c.kind == "chapter" and not is_container) else "BAŞLIK"
            lines.append(f"{code} · {title} [{seviye}, {tur}, {extra.lstrip(', ')}] (sistem no: {c.number})")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# SOHBET GEÇMİŞİ BUDAMA. Araştırmanın önerdiği desen: son birkaç turu TAM
# tut, öncesini ÖZETLE. Eskiden 40 mesajlık bir sohbette 40 mesaj birden
# gidiyordu - hem maliyet katlanıyor hem model eski/alakasız turlara takılıp
# kalite düşüyordu. Özet AI'ya ek istek attırmaz: yerel, deterministik bir
# sıkıştırma (kim ne istedi / ne yapıldı) - ucuz ve öngörülebilir.
# ---------------------------------------------------------------------------

def trim_chat_history(messages: list, keep_recent: int = 8, summary_char_budget: int = 1500) -> list:
    """Son `keep_recent` mesajı olduğu gibi bırakır; öncesini tek bir
    'ÖNCEKİ KONUŞMANIN ÖZETİ' mesajına sıkıştırır. Kısa sohbetlerde
    (<= keep_recent) hiçbir şey yapmaz."""
    if len(messages) <= keep_recent:
        return messages
    older, recent = messages[:-keep_recent], messages[-keep_recent:]
    lines = []
    for m in older:
        role = "Yazar" if m.get("role") == "user" else "AI"
        content = (m.get("content") or "").strip().replace("\n", " ")
        if not content:
            continue
        if len(content) > 220:
            content = content[:220] + "…"
        lines.append(f"{role}: {content}")
    digest = "\n".join(lines)
    if len(digest) > summary_char_budget:
        # Baştan değil SONDAN kırp: yakın geçmiş daha alakalı
        digest = "[... sohbetin başı kırpıldı ...]\n" + digest[-summary_char_budget:]
    return [{
        "role": "user",
        "content": (
            "ÖNCEKİ KONUŞMANIN ÖZETİ (bağlam - buna yanıt verme, sadece "
            f"hatırla; {len(older)} mesaj sıkıştırıldı):\n{digest}"
        ),
    }] + recent


# ---------------------------------------------------------------------------
# BAĞLAM ŞEFFAFLIĞI: context'i katmanlara ayırıp boyutlarını ölçer.
# "AI neyi görüyor" sorusunun yanıtı zaten Bağlam Önizleme'de vardı ama NE
# KADAR BÜYÜK olduğu görünmüyordu - hem maliyet hem "neden yavaş" sorusu
# buradan çıkıyor. Katman başlıkları "=== ... ===" ile ayrıldığı için
# ayrıştırma deterministik; token tahmini Türkçe için ~3.3 karakter/token.
# ---------------------------------------------------------------------------

CHARS_PER_TOKEN = 3.3


def estimate_context_size(context: str) -> tuple[int, int, list[dict]]:
    """(karakter, ~token, katman dökümü) döner. Döküm büyükten küçüğe."""
    total_chars = len(context)
    total_tokens = int(total_chars / CHARS_PER_TOKEN)
    if not context.strip():
        return 0, 0, []

    layers, current_name, buffer = [], "Kurallar ve temel bilgiler", []
    for line in context.split("\n"):
        header = re.match(r"^===\s*(.+?)\s*===$", line.strip())
        if not header:
            header = re.match(r"^(ROMAN FİHRİSTİ|FİHRİST HARİTASI|İLGİLİ GEÇMİŞ BİLGİLER)\b.*", line.strip())
        if header:
            if buffer:
                layers.append({"name": current_name, "text": "\n".join(buffer)})
            current_name = header.group(1).strip()
            buffer = [line]
        else:
            buffer.append(line)
    if buffer:
        layers.append({"name": current_name, "text": "\n".join(buffer)})

    breakdown = [
        {
            "name": l["name"][:60],
            "char_count": len(l["text"]),
            "approx_tokens": int(len(l["text"]) / CHARS_PER_TOKEN),
        }
        for l in layers if l["text"].strip()
    ]
    breakdown.sort(key=lambda x: -x["char_count"])
    return total_chars, total_tokens, breakdown


# ---------------------------------------------------------------------------
# MATRİS HARİTASI: hangi bölüm hangi kolon×satır kesişimine denk geliyor.
# Plan katmanı yalnızca ÜZERİNDE ÇALIŞILAN bölümün hücresini veriyordu; AI
# "3. bölüm hangi tura ait", "Sorgu aşamaları hangi bölümlerde" gibi yapısal
# soruları cevaplayamıyor, turlar arası paralellik kuramıyordu. Bu katman
# ucuzdur: sadece etiketler ve bölüm numaraları, hücre İÇERİKLERİ değil.
# ---------------------------------------------------------------------------

def build_matrix_map_layer(db: Session, novel_id: int, max_cells: int = 200) -> str:
    matrices = db.query(models.PlanMatrix).filter(models.PlanMatrix.novel_id == novel_id).all()
    if not matrices:
        return ""
    # Bölüm numaralarını tek sorguda al (hücre başına sorgu atmayalım)
    chapter_numbers = {
        c.id: c.number
        for c in db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id).all()
    }
    lines = []
    for m in matrices:
        cells = {(c.column_id, c.row_id): c for c in m.cells}
        if not cells:
            continue
        lines.append(f"MATRİS: {m.name}")
        for col in m.columns:
            parcalar = []
            for row in m.rows:
                cell = cells.get((col.id, row.id))
                if not cell:
                    continue
                num = chapter_numbers.get(cell.chapter_id)
                dolu = "✓" if (cell.content or "").strip() else "boş"
                if num:
                    parcalar.append(f"{row.label} → Bölüm {num} ({cell.code or '-'}, plan {dolu})")
                else:
                    parcalar.append(f"{row.label} → (bölüme bağlı değil, plan {dolu})")
                if len(parcalar) >= max_cells:
                    break
            if parcalar:
                lines.append(f"- {col.label}: " + " | ".join(parcalar))
    if not lines:
        return ""
    return (
        "=== MATRİS HARİTASI (hangi bölüm hangi kolon×satır kesişimi) ===\n"
        "Yapısal sorularda bunu kullan: bir bölümün hangi tura/aşamaya ait olduğu,\n"
        "aynı aşamanın diğer turlarda hangi bölümlerde geçtiği buradan okunur.\n"
        + "\n".join(lines)
    )


# ---------------------------------------------------------------------------
# EDEBÎ DEĞERLENDİRME (10 ölçüt). Okur Testi "okur nerede düşer" diye sorar;
# bu ise "edebî olarak nerede zayıf" diye sorar - farklı iki soru. Ölçütler
# yayınevi/editör bakışının yaygın on başlığı: betimleme, atmosfer,
# imgesellik, yapısal akış, alt metin, dil ekonomisi, ritim, sembolizm,
# karakterizasyon, üslup. Puan tek başına işe yaramaz; asıl değer EN ZAYIF
# üç başlık için verilen SOMUT düzeltmelerdir.
# ---------------------------------------------------------------------------

LITERARY_CRITERIA = [
    ("betimleme", "Betimleme", "Duyulara hitap eden, somut ve seçici tasvir. Genel görünüş → yakın plan → mikro detay sırası izleniyor mu?"),
    ("atmosfer", "Atmosfer", "Sahnenin bıraktığı genel ruh hâli tutarlı mı, sahnenin işleviyle uyumlu mu?"),
    ("imgesellik", "İmgesellik", "Zihinde güçlü görüntü/çağrışım kuruluyor mu? İmgeler taze mi, klişe mi?"),
    ("yapi", "Metnin matematiği (yapısal akış)", "Bilgi doğru sırayla mı veriliyor? Sahne kurulumu, gelişim ve kapanış dengeli mi?"),
    ("alt_metin", "Alt metin", "Yazılmayan ama sezdirilen anlam var mı, yoksa her şey açıkça söyleniyor mu?"),
    ("dil_ekonomisi", "Dil ekonomisi", "Az kelimeyle çok şey. Gereksiz sıfat, tekrar, boş cümle var mı?"),
    ("ritim", "Ritim", "Cümle uzunlukları ve tempo sahnenin gerilimiyle uyumlu mu?"),
    ("sembolizm", "Sembolizm", "Nesne/detaylar görünenden fazlasını taşıyor mu? Semboller metni boğuyor mu?"),
    ("karakterizasyon", "Karakterizasyon", "Karakter davranış, seçim ve konuşmayla mı inşa ediliyor, yoksa anlatılıyor mu?"),
    ("uslup", "Üslup", "Yazarın kendine özgü sesi tutarlı mı? Ödünç/genel bir ton var mı?"),
]

LITERARY_REVIEW_PROMPT = """Sen deneyimli bir yayınevi editörüsün. Sana bir
bölümün metni verilecek. Bu metni AŞAĞIDAKİ ON ÖLÇÜTE göre değerlendir.

ÖLÇÜTLER:
{criteria}

Kurallar:
1. Her ölçüte 1-5 arası puan ver (1 = ciddi sorun, 3 = iş görür, 5 = çok iyi).
   Cömert davranma; 5 istisnadır. Puanı METİNDEN bir kanıtla gerekçelendir.
2. EN ZAYIF ÜÇ ölçüt için birer SOMUT düzeltme öner: hangi paragrafta, ne
   yapılacak. "Daha edebi olsun" gibi genel öğüt YASAK - uygulanabilir yaz.
3. Metnin EN GÜÇLÜ tek yönünü de söyle (yazar neyi korumalı).
4. Alıntı yaparken en fazla 10 kelime kullan ve paragraf numarasını (P3) ver.

Yanıtın SADECE şu JSON olsun:
{{"scores": [{{"key": "betimleme", "score": 3, "reason": "..."}}],
  "strongest": "...", "fixes": [{{"criterion": "...", "paragraph": 3, "problem": "...", "fix": "..."}}]}}"""


def literary_review(db: Session, chapter, max_chars: int = 14000) -> dict:
    """Bölümü 10 edebî ölçüte göre değerlendirir. Kaydetmez - rapor döner.

    UZUN BÖLÜMLER PARÇA PARÇA taranır: eskiden metin 14.000 karakterde
    kesiliyordu ve 100 paragraflık bir bölümün ancak ilk üçte biri
    inceleniyordu - üstelik rapor bunu SÖYLEMİYORDU ("sessiz eksik
    denetim"). Artık bölüm dilimlere ayrılıp her dilim ayrı taranır,
    puanlar ortalanır, bulgular birleştirilir ve kaç paragrafın tarandığı
    raporda döner.
    """
    paragraphs = [p for p in chapter.paragraphs if (p.text or "").strip()]
    if not paragraphs:
        return {"scores": [], "strongest": "", "fixes": [], "scanned": 0, "total": 0, "chunks": 0}

    # Dilimle: her dilim max_chars sınırını aşmasın
    dilimler, mevcut, used = [], [], 0
    for p in paragraphs:
        satir = f"[P{p.number}] {p.text.strip()}"
        if mevcut and used + len(satir) > max_chars:
            dilimler.append(mevcut)
            mevcut, used = [], 0
        mevcut.append(satir)
        used += len(satir)
    if mevcut:
        dilimler.append(mevcut)

    if len(dilimler) > 1:
        return _literary_review_chunked(db, chapter, dilimler, len(paragraphs))
    body = dilimler[0]

    criteria_text = "\n".join(f"- {key}: {ad} — {aciklama}" for key, ad, aciklama in LITERARY_CRITERIA)
    system = LITERARY_REVIEW_PROMPT.format(criteria=criteria_text)
    title_part = f" - {chapter.title}" if chapter.title else ""
    ozet = (chapter.summary or "").strip()
    user = (f"BÖLÜM ÖZETİ:\n{ozet}\n\n" if ozet else "") + f"BÖLÜM {chapter.number}{title_part}:\n" + "\n".join(body)

    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    data = _parse_json_lenient(response.choices[0].message.content)
    if not isinstance(data, dict):
        logger.warning("Edebî değerlendirme: yanıt ayrıştırılamadı (bölüm %s)", chapter.number)
        return {"scores": [], "strongest": "", "fixes": []}

    gecerli = {k for k, _, _ in LITERARY_CRITERIA}
    adlar = {k: ad for k, ad, _ in LITERARY_CRITERIA}
    scores = []
    for s in data.get("scores", []):
        key = (s.get("key") or "").strip()
        if key not in gecerli:
            continue
        try:
            puan = max(1, min(5, int(s.get("score", 3))))
        except (TypeError, ValueError):
            puan = 3
        scores.append({"key": key, "label": adlar[key], "score": puan, "reason": (s.get("reason") or "")[:400]})
    fixes = [
        {
            "criterion": (f.get("criterion") or "")[:60],
            "paragraph": f.get("paragraph") if isinstance(f.get("paragraph"), int) else None,
            "problem": (f.get("problem") or "")[:400],
            "fix": (f.get("fix") or "")[:400],
        }
        for f in data.get("fixes", []) if (f.get("fix") or "").strip()
    ][:5]
    return {
        "scores": scores, "strongest": (data.get("strongest") or "")[:300], "fixes": fixes,
        "scanned": len(paragraphs), "total": len(paragraphs), "chunks": 1,
    }


def _literary_review_chunked(db: Session, chapter, dilimler: list, toplam: int) -> dict:
    """Uzun bölüm: her dilim ayrı taranır, sonuçlar birleştirilir.
    Puanlar dilimler arası ORTALANIR (bir dilimin zayıflığı tüm bölümü
    mahkûm etmesin), düzeltmeler paragraf sırasına göre toplanır."""
    criteria_text = "\n".join(f"- {key}: {ad} — {aciklama}" for key, ad, aciklama in LITERARY_CRITERIA)
    system = LITERARY_REVIEW_PROMPT.format(criteria=criteria_text)
    title_part = f" - {chapter.title}" if chapter.title else ""
    ozet = (chapter.summary or "").strip()
    gecerli = {k for k, _, _ in LITERARY_CRITERIA}
    adlar = {k: ad for k, ad, _ in LITERARY_CRITERIA}

    puan_toplam, puan_sayi, gerekce = {}, {}, {}
    tum_fixes, guclu = [], []
    client = get_client()
    for i, dilim in enumerate(dilimler, start=1):
        user = (
            (f"BÖLÜM ÖZETİ:\n{ozet}\n\n" if ozet else "")
            + f"BÖLÜM {chapter.number}{title_part} - PARÇA {i}/{len(dilimler)}:\n"
            + "\n".join(dilim)
        )
        try:
            response = client.chat.completions.create(
                model=settings.qwen_model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            )
        except Exception:
            logger.exception("Edebî değerlendirme: parça %s başarısız", i)
            continue
        data = _parse_json_lenient(response.choices[0].message.content)
        if not isinstance(data, dict):
            continue
        for sc in data.get("scores", []):
            key = (sc.get("key") or "").strip()
            if key not in gecerli:
                continue
            try:
                puan = max(1, min(5, int(sc.get("score", 3))))
            except (TypeError, ValueError):
                puan = 3
            puan_toplam[key] = puan_toplam.get(key, 0) + puan
            puan_sayi[key] = puan_sayi.get(key, 0) + 1
            # En DÜŞÜK puanın gerekçesini sakla - sorunun kaynağı orası
            if key not in gerekce or puan <= gerekce[key][0]:
                gerekce[key] = (puan, (sc.get("reason") or "")[:400])
        for f in data.get("fixes", []):
            if (f.get("fix") or "").strip():
                tum_fixes.append({
                    "criterion": (f.get("criterion") or "")[:60],
                    "paragraph": f.get("paragraph") if isinstance(f.get("paragraph"), int) else None,
                    "problem": (f.get("problem") or "")[:400],
                    "fix": (f.get("fix") or "")[:400],
                })
        if (data.get("strongest") or "").strip():
            guclu.append(data["strongest"].strip())

    scores = [
        {"key": k, "label": adlar[k], "score": round(puan_toplam[k] / puan_sayi[k]),
         "reason": gerekce.get(k, (0, ""))[1]}
        for k in puan_toplam
    ]
    tum_fixes.sort(key=lambda f: (f["paragraph"] is None, f["paragraph"] or 0))
    return {
        "scores": scores, "strongest": guclu[0] if guclu else "",
        "fixes": tum_fixes[:12], "scanned": toplam, "total": toplam, "chunks": len(dilimler),
    }


# ---------------------------------------------------------------------------
# YAPISAL AKIŞ TARAMASI (bölümler arası). Editörlerin klasik testleri:
#  - "bu yüzden / ve sonra": bir bölümün SONUCU, sonrakinin HEDEFİNİ
#    doğuruyor mu? "Ve sonra" zinciri momentum kaybıdır.
#  - Tekrar eden çatışma: her bölüm tek başına iyi olabilir; tekrar ancak
#    bölümler ARASI okununca görünür (aynı engel, aynı sonuç, yükselmeyen bahis).
#  - Ölü bölge: çıkarılsa kimsenin fark etmeyeceği bölümler.
#  - Bahis eğrisi: bedel/tehdit yükseliyor mu, sabit mi?
# Bu tarama ÖZETLERLE çalışır (ucuz) - bölüm metinlerini göndermez.
# ---------------------------------------------------------------------------

STRUCTURE_SCAN_PROMPT = """Sen deneyimli bir gelişim editörüsün. Sana bir
romanın bölüm özetleri SIRAYLA verilecek. Yapısal akışı denetle.

Uygulayacağın testler:
1. NEDENSELLİK ("bu yüzden" testi): Her bölümün sonucu, bir SONRAKİNİN
   hedefini doğuruyor mu? Bağ "bu yüzden / bu nedenle" ise sağlam;
   "ve sonra" ise momentum kopuyor demektir. Kopuk halkaları göster.
2. TEKRAR EDEN ÇATIŞMA: Aynı engel/çatışma, durumu değiştirmeden
   tekrarlanıyor mu? (A dener-başarısız, B dener-başarısız...) Yükselen
   komplikasyon mu var, yoksa sıfırlanan tekrar mı?
3. BAHİS EĞRİSİ: Bedel/tehdit yükseliyor mu, sabit mi, düşüyor mu?
4. ÖLÜ BÖLGE: Çıkarılsa okurun fark etmeyeceği bölüm(ler) hangileri?
5. AÇILIŞ-KAPANIŞ: Bölüm sonları bir soru/eşik bırakıyor mu, yoksa
   çözülüp bitiyor mu?

Kurallar: Bölüm numaralarıyla konuş. Her bulgu için SOMUT düzeltme öner
("şu bölümde şu sonucu değiştir" gibi) - genel öğüt yasak. Sağlamsa
sağlam de, sorun uydurma.

Yanıtın SADECE şu JSON olsun:
{"causality": [{"from": 3, "to": 4, "link": "ve sonra", "problem": "...", "fix": "..."}],
 "repetition": [{"chapters": [5,7,9], "problem": "...", "fix": "..."}],
 "stakes": {"trend": "yükseliyor|sabit|düşüyor", "comment": "..."},
 "dead_zones": [{"chapter": 12, "reason": "...", "fix": "..."}],
 "endings": [{"chapter": 6, "problem": "...", "fix": "..."}],
 "summary": "iki cümlelik genel değerlendirme"}"""


def structure_scan(db: Session, novel_id: int, max_chars: int = 24000) -> dict:
    """Bölüm özetlerinden yapısal akış denetimi. Özeti olmayan bölümler
    atlanır ve raporda belirtilir - onlar zaten zincirde kör nokta."""
    chapters = (
        db.query(models.Chapter)
        .filter(models.Chapter.novel_id == novel_id)
        .order_by(models.Chapter.number)
        .all()
    )
    ozetli = [c for c in chapters if (c.summary or "").strip()]
    ozetsiz = [c.number for c in chapters if not (c.summary or "").strip()
               and any((p.text or "").strip() for p in c.paragraphs)]
    if len(ozetli) < 2:
        return {
            "summary": "Yapısal tarama için en az 2 özetli bölüm gerekir. "
                       "Bölümleri yazıp 'AI ile özet oluştur' ile özetle.",
            "causality": [], "repetition": [], "stakes": {}, "dead_zones": [],
            "endings": [], "missing_summaries": ozetsiz,
        }

    bloklar, used = [], 0
    for c in ozetli:
        parca = f"--- Bölüm {c.number}{' - ' + c.title if c.title else ''} ---\n{c.summary.strip()}"
        if used + len(parca) > max_chars:
            bloklar.append("[... kalan bölümler kırpıldı ...]")
            break
        bloklar.append(parca)
        used += len(parca)

    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[
            {"role": "system", "content": STRUCTURE_SCAN_PROMPT},
            {"role": "user", "content": "BÖLÜM ÖZETLERİ (sırayla):\n\n" + "\n\n".join(bloklar)},
        ],
    )
    data = _parse_json_lenient(response.choices[0].message.content)
    if not isinstance(data, dict):
        logger.warning("Yapısal tarama: yanıt ayrıştırılamadı")
        return {"summary": "Değerlendirme üretilemedi.", "causality": [], "repetition": [],
                "stakes": {}, "dead_zones": [], "endings": [], "missing_summaries": ozetsiz}
    data["missing_summaries"] = ozetsiz
    return data


# ---------------------------------------------------------------------------
# YAZIM SONRASI DOĞRULAMA (kabul kontrolü). Zincirin son halkası: yeni bir
# paragraf versiyonu üretildikten SONRA kimse "işini yapıyor mu" diye
# sormuyordu. Bu fonksiyon dört soruyu deterministik + AI karışımıyla
# cevaplar:
#   1. İŞLEV: paragrafın işi tanımlıysa yerine getiriliyor mu?
#   2. SOMUT DETAY: rakam/ölçü/özel isim düştü mü? (deterministik kontrol)
#   3. SÜREKLİLİK: komşularla çelişki ya da tekrar var mı?
#   4. ÜSLUP: yasak kalıplar (üslup taraması eşiği aşanlar) girdi mi?
#      (deterministik - regex ile)
# Deterministik kısımlar AI'ya sorulmaz: ucuz ve kesin.
# ---------------------------------------------------------------------------

NUMBER_TOKEN_RE = re.compile(r"\b\d+(?:[.,]\d+)?\b")
PROPER_NOUN_RE = re.compile(r"\b[A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,}\b")


def _extract_facts(text: str) -> tuple[set, set]:
    """Metindeki sayılar ve özel isim adayları (cümle başı hariç değil -
    kaba ama işe yarar: kaybolan detayı yakalamak için yeterli)."""
    return set(NUMBER_TOKEN_RE.findall(text or "")), set(PROPER_NOUN_RE.findall(text or ""))


VERIFY_PROMPT = """Sen titiz bir redaktörsün. Sana bir paragrafın ESKİ ve
YENİ hâli, (varsa) paragrafın İŞLEVİ ve komşu paragraflar verilecek.
Yeni hâli KABUL EDİLEBİLİR mi, karar ver.

Kontrol et:
1. İŞLEV: Paragrafın işi tanımlıysa yeni hâli bunu yerine getiriyor mu?
2. ANLAM: Olay akışı, zaman ve mekân korunmuş mu? Yeni bir olay uydurulmuş mu?
3. SÜREKLİLİK: Önceki/sonraki paragraflarla çelişki ya da gereksiz tekrar var mı?
4. EYLEM SIRASI: Tamamlanmış bir eylem yeniden başlatılmış mı?

Yanıtın SADECE şu JSON olsun:
{"verdict": "kabul|duzelt|red", "issues": ["..."], "note": "tek cümle gerekçe"}
Sorun yoksa issues boş liste, verdict "kabul" olsun. Uydurma sorun çıkarma."""


def verify_paragraph_rewrite(db: Session, universe_id: int, old_text: str, new_text: str,
                             purpose: str = "", neighbors: str = "") -> dict:
    """Yeni versiyonu denetler. Deterministik bulgular + AI kararı döner."""
    hard_issues = []

    # 1) Somut detay kaybı (deterministik)
    eski_sayilar, eski_isimler = _extract_facts(old_text)
    yeni_sayilar, yeni_isimler = _extract_facts(new_text)
    kayip_sayi = sorted(eski_sayilar - yeni_sayilar)
    kayip_isim = sorted(eski_isimler - yeni_isimler)
    if kayip_sayi:
        hard_issues.append(f"Somut detay düştü - eski metindeki sayılar yeni metinde yok: {', '.join(kayip_sayi)}")
    if kayip_isim:
        hard_issues.append(f"Özel isim düştü: {', '.join(kayip_isim)}")

    # 2) Yasak üslup kalıpları (deterministik - eşiği aşan kalıplar)
    rapor = None
    try:
        from .style_scan import load_scan_result, _tr_lower as style_lower
        rapor = load_scan_result(db, universe_id)
    except Exception:
        rapor = None
    if rapor:
        norm = new_text.replace("İ", "i").replace("I", "ı").lower()
        for p in rapor.get("patterns", []):
            if not p.get("exceeded"):
                continue
            try:
                hits = len(re.findall(p["pattern"], norm))
            except re.error:
                continue
            if hits:
                hard_issues.append(f"Aşırı kullanılan kalıp yeni metinde {hits} kez geçiyor: {p['name']}")

    # 3) AI kararı (işlev, anlam, süreklilik, eylem sırası)
    user = (
        (f"PARAGRAFIN İŞLEVİ: {purpose}\n\n" if purpose.strip() else "")
        + f"ESKİ HÂLİ:\n{old_text}\n\nYENİ HÂLİ:\n{new_text}\n"
        + (f"\nKOMŞULAR:\n{neighbors}" if neighbors else "")
    )
    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[{"role": "system", "content": VERIFY_PROMPT}, {"role": "user", "content": user}],
    )
    data = _parse_json_lenient(response.choices[0].message.content) or {}
    ai_issues = [str(x)[:300] for x in (data.get("issues") or []) if str(x).strip()]
    verdict = data.get("verdict") if data.get("verdict") in ("kabul", "duzelt", "red") else "kabul"
    # Deterministik bulgu varsa karar en az "duzelt" olur - AI kabul dese bile
    if hard_issues and verdict == "kabul":
        verdict = "duzelt"
    return {
        "verdict": verdict,
        "hard_issues": hard_issues,
        "issues": ai_issues,
        "note": (data.get("note") or "")[:300],
    }
