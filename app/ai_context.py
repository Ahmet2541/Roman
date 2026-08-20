"""Bağlam katmanları (context layers).

AI'ya romanın TAMAMI değil, o an İLGİLİ olan gönderilir. Bu modül o
"ilgili olan"ı katman katman kurar: kurallar, fihrist, plan, seçili
varlıklar, üslup uyarıları, bilgi durumu, anlatıcı sözleşmesi...

Buradaki fonksiyonların HİÇBİRİ AI çağırmaz - yalnızca veritabanından
okuyup metin üretirler. Bu yüzden qwen_client'tan güvenle ayrıldılar
(testlerin sahte Qwen bağlantısını etkilemezler).

Geriye dönük uyum: qwen_client bunları içe aktarıp yeniden dışa verir,
mevcut `from .qwen_client import build_X` çağrıları çalışmaya devam eder.
"""
import logging
import re
from typing import List, Optional

from sqlalchemy.orm import Session

from . import models
from . import plan_schema, schemas
from .config import settings
from .prompts import *  # noqa: F401,F403 - katmanlarda geçen yönergeler
from .sections import (
    SECTIONS_BY_ENTITY_TYPE,
    ai_visible_sections,
    describe_sections_for_tool,
    relevant_sections_for_instruction,
    _tr_lower,
)
from .novel_context import get_universe_id_for_novel
from .style_scan import build_style_warning_layer
from .entities import ENTITY_MODELS, ENTITY_LABELS_TR

logger = logging.getLogger("roman_api.context")

ENTRY_CODE_RE = re.compile(
    r"\b(\d+(?:[-.]\d+)+)\b"                                   # 1-1, 1.2.3
    r"|\b(\d+)\s*(?:BLM|KSM|ABS)\b"                            # eski ekler
    r"|\b(?:bölüm|kısım|alt ?başlık|girdi)\s+(\d+(?:[-.]\d+)*)\b"  # "bölüm 1"
    r"|\b(\d+(?:[-.]\d+)*)\s*(?:numaralı|nolu|no'?lu)\b",       # "1 numaralı"
    re.IGNORECASE,
)

PARAGRAPH_REF_RE = re.compile(r"\b(\d+(?:[-.]\d+)*)\s*P\s*(\d+)\b", re.IGNORECASE)

PARAGRAPH_REF_RE = re.compile(r"\b(\d+(?:[-.]\d+)*)\s*P\s*(\d+)\b", re.IGNORECASE)


def _extract_entry_codes(text: str) -> set:
    """Metinden fihrist numarası adaylarını çıkarır ('1-1', '1.2' -> '1-2')."""
    out = set()
    for m in ENTRY_CODE_RE.finditer(text or ""):
        raw = m.group(1) or m.group(2) or m.group(3) or m.group(4)
        if raw:
            out.add(raw.replace(".", "-"))
    return out
# ---------------------------------------------------------------------------
# SOHBET GEÇMİŞİ BUDAMA. Araştırmanın önerdiği desen: son birkaç turu TAM
# tut, öncesini ÖZETLE. Eskiden 40 mesajlık bir sohbette 40 mesaj birden
# gidiyordu - hem maliyet katlanıyor hem model eski/alakasız turlara takılıp
# kalite düşüyordu. Özet AI'ya ek istek attırmaz: yerel, deterministik bir
# sıkıştırma (kim ne istedi / ne yapıldı) - ucuz ve öngörülebilir.
# ---------------------------------------------------------------------------


def _extract_paragraph_refs(text: str) -> set:
    """{(girdi_numarası, paragraf_sırası)} döner."""
    return {
        (m.group(1).replace(".", "-"), int(m.group(2)))
        for m in PARAGRAPH_REF_RE.finditer(text or "")
    }





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


def build_knowledge_layer(db: Session, universe_id: int, chapter_number: int | None) -> str:
    """BİLGİ DURUMU: bu bölüm yazılırken OKUR ve KARAKTERLER neyi biliyor?

    Gerilim çoğu zaman olaydan değil, bu üç eksenin farkından doğar. Bilgi
    Haritası menüde duruyordu ama hiçbir prompta girmiyordu - yani "okur
    bunu henüz bilmiyor" bilgisi denetime hiç ulaşmıyordu. Bu katman
    sızdırma (erken ifşa) ve dramatik ironi kayıplarını görünür kılar.
    """
    facts = db.query(models.KnowledgeFact).filter(
        models.KnowledgeFact.universe_id == universe_id).all()
    if not facts:
        return ""
    n = chapter_number or 0
    gizli, sezdirilen, bilinen, sizdirma = [], [], [], []
    for f in facts:
        bilgi = (f.information or "").strip()
        if not bilgi:
            continue
        ifsa = f.reveal_chapter
        kim = f.known_by_characters or []
        # Bu bölümde ifşa edilecek mi, yoksa daha sonra mı?
        if ifsa and n and ifsa > n:
            sizdirma.append(f"{bilgi} (ifşası Bölüm {ifsa} - BURADA AÇIKLAMA)")
        elif f.reader_state == "hayir":
            gizli.append(bilgi)
        elif f.reader_state == "sezdirildi":
            sezdirilen.append(bilgi)
        else:
            bilinen.append(bilgi)
        # Dramatik ironi: okur bilir, karakterler bilmez
        if f.reader_state == "evet" and not kim:
            bilinen[-1:] = [f"{bilgi} [DRAMATİK İRONİ: okur bilir, karakterler bilmez - "
                            f"karakterlerin davranışı bu bilgisizlikle TUTARLI olmalı]"]

    lines = ["=== BİLGİ DURUMU (okur ne biliyor?) ==="]
    if sizdirma:
        lines.append("SIZDIRMA YASAĞI - bunlar SONRAKİ bölümlerde ifşa edilecek, burada "
                     "açıkça yazma, ima bile etme:\n- " + "\n- ".join(sizdirma))
    if gizli:
        lines.append("OKUR HENÜZ BİLMİYOR (gizemi koru):\n- " + "\n- ".join(gizli))
    if sezdirilen:
        lines.append("OKURA SEZDİRİLDİ (biliniyormuş gibi yazma, hâlâ örtük):\n- " + "\n- ".join(sezdirilen))
    if bilinen:
        lines.append("OKUR BİLİYOR (tekrar açıklama, biliniyor varsay):\n- " + "\n- ".join(bilinen))
    return "\n\n".join(lines) if len(lines) > 1 else ""


def build_forward_layer(db: Session, novel_id: int, chapter_number: int | None) -> str:
    """İLERİ BAKIŞ: SONRAKİ bölümün planı ve (varsa) özeti. Özet zinciri
    hep GERİYE bakıyordu ("önceki bölümden ne devraldık"); oysa bir sahne
    yazılırken asıl soru "bu, sonraki bölümü nasıl kuruyor" olmalı. Bu
    katman olmadan bölüm sonları eşik bırakmak yerine çözülüp kapanıyor.
    """
    if chapter_number is None:
        return ""
    sonraki = (
        db.query(models.Chapter)
        .filter(models.Chapter.novel_id == novel_id, models.Chapter.number > chapter_number)
        .order_by(models.Chapter.number)
        .first()
    )
    if not sonraki:
        return ""
    parcalar = []
    ozet = (sonraki.summary or "").strip()
    if ozet:
        parcalar.append(f"SONRAKİ BÖLÜMÜN ÖZETİ (Bölüm {sonraki.number}):\n{ozet}")
    # Sonraki bölüme bağlı plan hücresi (varsa)
    hucre = (
        db.query(models.MatrixCell)
        .filter(models.MatrixCell.chapter_id == sonraki.id)
        .first()
    )
    if hucre and (hucre.content or "").strip():
        parcalar.append(f"SONRAKİ BÖLÜMÜN PLANI:\n{hucre.content.strip()}")
    if not parcalar:
        return ""
    return (
        "=== İLERİ BAKIŞ (sonraki bölüm) ===\n"
        "Bu bölüm oraya BAĞLANMALI: kapanış bir eşik/soru bıraksın, sonrakinin\n"
        "hedefini doğursun. Sonrakinde anlatılacak bilgiyi burada ÖNDEN VERME.\n"
        + "\n\n".join(parcalar)
    )


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
        # MİRAS (yapı kilidi): turun damgası/güven kelimesi ve parçanın
        # no/süresi hücrede DEĞİL kolon/satır kaydında durur - buraya CANLI
        # okunur. Böylece damga kelimesini değiştirdiğinde 56 hücrenin
        # metnini yeniden yazman gerekmez. Talimat Kasası (satırın kalıcı
        # yazım kısıtları) da aynı blokta gider.
        miras = plan_schema.render_miras(
            getattr(col, "tur_data", None),
            getattr(row, "parca_data", None),
            getattr(row, "instructions", "") or "",
        )
        if miras:
            block += f"\n{miras}"
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

            # ALT SAHNELER (hiyerarşik plan mirası): kullanıcının çalışma
            # biçiminde matris satırları hikâyeyi SIRAYLA taşır; bölüm
            # numarası verilen satır bir BÖLÜM, ondan sonra gelen bağsız
            # satırlar o bölümün SAHNELERİ/paragraflarıdır. Eskiden yalnızca
            # bağlı hücre gidiyordu - yani bölümün sahne sahne planı AI'ya
            # hiç ulaşmıyor, "8 hücre bölüme bağlı değil" uyarısındaki
            # planlar boşa yazılmış oluyordu.
            for cell in cells:
                matrix = db.query(models.PlanMatrix).filter(
                    models.PlanMatrix.id == cell.matrix_id).first()
                if not matrix:
                    continue
                sirali_satirlar = sorted(matrix.rows, key=lambda r: r.position)
                try:
                    baslangic = next(i for i, r in enumerate(sirali_satirlar) if r.id == cell.row_id)
                except StopIteration:
                    continue
                alt_bloklar = []
                for row in sirali_satirlar[baslangic + 1:]:
                    komsu = next((c for c in matrix.cells
                                  if c.column_id == cell.column_id and c.row_id == row.id), None)
                    if komsu is None:
                        continue
                    # Başka bir bölüme bağlı satıra gelindi -> bu bölüm biter
                    if komsu.chapter_id:
                        break
                    icerik = (komsu.content or "").strip()
                    if not icerik:
                        continue
                    kod = f"{komsu.code}: " if komsu.code else ""
                    alt_bloklar.append(f"[{kod}{row.label}]\n{icerik}")
                    own_cell_ids.add(komsu.id)
                    if (row.instructions or "").strip():
                        alt_bloklar.append(f"  ↳ KISIT: {row.instructions.strip()}")
                if alt_bloklar:
                    blocks.append(
                        "--- BU BÖLÜMÜN SAHNELERİ (sırayla yazılacak) ---\n"
                        + "\n\n".join(alt_bloklar)
                    )
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


def plan_hucre_varliklari(db: Session, novel_id: int, chapter_number: int | None) -> list:
    """Bu bölüme bağlı plan hücresinin (ve alt sahnelerinin) KİŞİ/MEKAN/NESNE
    listesini varlık referansına çevirir.

    NEDEN: plan katmanı "KİŞİLER: Genç Mühendis (umut → gurur)" diyor ama
    Genç Mühendis'in KİM OLDUĞU ayrı bir katmanda - ve o katman şimdiye
    kadar sadece ELLE seçilenlerden besleniyordu. Yani hücrede kişiyi
    yazıyordun, profili yazım anında AI'ya gitmiyordu; model karakteri
    tanımadan yazıyordu. Hücre zaten sahnede kimin olduğunu biliyor,
    profilleri oradan çekmek doğal olan.

    Sadece ID'ye BAĞLI varlıklar döner - serbest metin olarak yazılmış
    ("Panelvan ?" gibi kayıtsız) adların profili zaten yoktur.
    """
    if chapter_number is None:
        return []
    from . import plan_schema

    ch = (db.query(models.Chapter)
          .filter(models.Chapter.novel_id == novel_id,
                  models.Chapter.number == chapter_number).first())
    if ch is None:
        return []
    hucreler = (db.query(models.MatrixCell)
                .filter(models.MatrixCell.chapter_id == ch.id).all())
    if not hucreler:
        return []

    refs, gorulen = [], set()
    for h in hucreler:
        d = plan_schema.normalize_cell(h.data)
        adaylar = [("character", k.get("id")) for k in d["kisiler"]]
        adaylar += [("object", n.get("id")) for n in d["nesneler"]]
        adaylar.append(("place", d.get("mekan_id")))
        for tip, eid in adaylar:
            if isinstance(eid, int) and (tip, eid) not in gorulen:
                gorulen.add((tip, eid))
                refs.append(schemas.EntityRef(entity_type=tip, entity_id=eid))
    return refs


def build_context(
    db: Session, novel_id: int, universe_id: int, selected_entities: list,
    chapter_number: int | None = None, instruction_text: str = "",
    include_hidden: bool = False, include_chapter_text: bool = False,
    text_scope: str = "chapter", include_own_summary: bool = False,
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
    # İleri bakış: sonraki bölümün planı/özeti - "bu sahne oraya nasıl bağlanıyor"
    forward = build_forward_layer(db, novel_id, chapter_number)
    # Bilgi durumu: okur ne biliyor, ne sızdırılmamalı (dramatik ironi koruması)
    knowledge = build_knowledge_layer(db, universe_id, chapter_number)
    # Turlar arası paralellik: aynı aşamanın diğer turlardaki hâlleri
    parallel = build_parallel_layer(db, novel_id, chapter_number)
    # Anlatıcı sözleşmesi: kim anlatıyor, hangi mesafeden, neyi bilebilir
    voice = build_voice_layer(db, universe_id)
    # ÜZERİNDE ÇALIŞILAN BÖLÜMÜN KENDİ ÖZETİ: fihrist katmanı bunu bilerek
    # dışlıyor (yeni bölüm YAZILIRKEN model kendi özetini kopyalamasın diye).
    # Ama var olan bir paragrafı DÜZENLERKEN tam tersi gerekli: ZAMAN,
    # ATMOSFER, DUYGU ve KAPANIŞ TONU bilgisi olmadan yeniden yazım kör
    # kalıyordu - sahnenin tonunu bilmeden "güçlendirme" yapılıyordu.
    own_summary = ""
    if include_own_summary and chapter_number is not None:
        ch = (
            db.query(models.Chapter)
            .filter(models.Chapter.novel_id == novel_id, models.Chapter.number == chapter_number)
            .first()
        )
        if ch and (ch.summary or "").strip():
            baslik = f" - {ch.title}" if ch.title else ""
            own_summary = (
                f"=== ÜZERİNDE ÇALIŞILAN BÖLÜMÜN ÖZETİ (Bölüm {ch.number}{baslik}) ===\n"
                "Yeniden yazım bu tona, zamana ve atmosfere UYMALI:\n"
                + ch.summary.strip()
            )
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
    # PLANDAN GELEN VARLIKLAR: hücrede yazılı kişi/mekan/nesne profilleri
    # de gitsin. Elle seçilenlerle BİRLEŞTİRİLİR (üzerine yazmaz) - yazar
    # sahne dışından bir karakteri de bilerek ekleyebilir.
    try:
        plan_refs = plan_hucre_varliklari(db, novel_id, chapter_number)
    except Exception:
        # Bu katman bir İYİLEŞTİRME (profilleri otomatik ekler), çekirdek
        # değil. Patlarsa bütün bağlamı düşürmemeli - elle seçilenlerle
        # devam edilir.
        logger.exception("Plan hücresi varlıkları okunamadı, atlanıyor")
        plan_refs = []
    birlesik = list(selected_entities or [])
    mevcut = {(r.entity_type, r.entity_id) for r in birlesik}
    for r in plan_refs:
        if (r.entity_type, r.entity_id) not in mevcut:
            birlesik.append(r)
    dynamic = build_dynamic_layer(db, universe_id, birlesik, instruction_text=instruction_text, include_hidden=include_hidden)
    return "\n\n".join(part for part in [fixed, index, outline, matrix_map, referenced, style, style_warnings, plan, parallel, voice, forward, knowledge, own_summary, chapter_text, dynamic] if part)


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
# TURLAR ARASI PARALELLİK: aynı matris SATIRININ diğer kolonlardaki (turlardaki)
# hücreleri. Kullanıcının yapısında aynı iskelet 8 kez tekrarlanıyor; sistem
# "bu aşamayı Tur 1'de şöyle işledin, tekrarlama" diyemiyordu - matris
# haritası yalnızca EŞLEŞMEYİ veriyordu, İÇERİĞİ değil. Monotoni riskinin
# ölçülebilir hale gelmesi buna bağlı.
# ---------------------------------------------------------------------------

def build_parallel_layer(db: Session, novel_id: int, chapter_number: int | None,
                         max_chars: int = 6000) -> str:
    if chapter_number is None:
        return ""
    chapter = (
        db.query(models.Chapter)
        .filter(models.Chapter.novel_id == novel_id, models.Chapter.number == chapter_number)
        .first()
    )
    if not chapter:
        return ""
    cells = db.query(models.MatrixCell).filter(models.MatrixCell.chapter_id == chapter.id).all()
    if not cells:
        return ""

    bloklar, used = [], 0
    for cell in cells:
        matrix = db.query(models.PlanMatrix).filter(models.PlanMatrix.id == cell.matrix_id).first()
        if not matrix:
            continue
        row = next((r for r in matrix.rows if r.id == cell.row_id), None)
        if not row:
            continue
        kendi_kolon = next((c for c in matrix.columns if c.id == cell.column_id), None)
        parcalar = []
        for komsu in matrix.cells:
            if komsu.row_id != row.id or komsu.column_id == cell.column_id:
                continue
            icerik = (komsu.content or "").strip()
            if not icerik:
                continue
            kolon = next((c for c in matrix.columns if c.id == komsu.column_id), None)
            etiket = kolon.label if kolon else "?"
            # Yazılmışsa ÖZETİ de ver - plan "ne olacak", özet "ne oldu"
            ozet = ""
            if komsu.chapter_id:
                ch = db.query(models.Chapter).filter(models.Chapter.id == komsu.chapter_id).first()
                if ch and (ch.summary or "").strip():
                    ozet = f"\n  YAZILDI (Bölüm {ch.number}): {ch.summary.strip()[:400]}"
            parca = f"[{etiket}] {icerik[:400]}{ozet}"
            if used + len(parca) > max_chars:
                break
            parcalar.append(parca)
            used += len(parca)
        if parcalar:
            bloklar.append(f"AŞAMA: {row.label}\n" + "\n\n".join(parcalar))

    if not bloklar:
        return ""
    return (
        "=== AYNI AŞAMANIN DİĞER TURLARI (paralellik denetimi) ===\n"
        "Bu aşama başka turlarda da işleniyor. Aşağıdakileri OKU ve:\n"
        "- Aynı çözümü, aynı imgeyi, aynı cümle kalıbını TEKRARLAMA.\n"
        "- Aynı işlevi FARKLI bir yoldan gerçekleştir (başka duyu, başka açı,\n"
        "  başka tempo). Yapı aynı kalabilir, ifade aynı kalamaz.\n"
        "- Bahis yükselmeli: bu tur öncekinden daha ileri gitmeli.\n\n"
        + "\n\n".join(bloklar)
    )


# ---------------------------------------------------------------------------
# ANLATICI / ODAK (VOICE) KATMANI. Eksikti ve önemliydi: aynı paragraf,
# anlatıcının kim olduğuna göre tamamen farklı okunur. "İçeride babasının
# eski sandalyesi duruyordu" - karakterin zihnindeysek bu HAFIZA, dış
# anlatıcıysa GÖZLEM, güvenilmez anlatıcıysa ŞÜPHELİ bir bilgidir.
#
# İki iş yapar:
#   (a) build_voice_layer: romanın anlatıcı sözleşmesi context'e girer, yeni
#       metin bu sözleşmeye uyar.
#   (b) scan_voice: yazılmış metinde SÖZLEŞME İHLALLERİNİ arar - en sık
#       hata BAKIŞ AÇISI KAYMASI (aynı sahnede iki karakterin zihnine girme)
#       ve anlatıcının bilemeyeceği bilgiyi vermesi.
# ---------------------------------------------------------------------------


def build_voice_layer(db: Session, universe_id: int) -> str:
    """Anlatıcı sözleşmesi context katmanı. Kurallar menüsünde 'anlatıcı'
    ya da 'bakış açısı' geçen kayıtlardan derlenir - ayrı bir tablo açmak
    yerine var olan kural altyapısı kullanılır (kullanıcı zaten oraya
    yazıyor)."""
    kurallar = db.query(models.Rule).filter(models.Rule.universe_id == universe_id).all()
    ilgili = []
    for r in kurallar:
        metin = f"{r.title or ''} {r.description or ''}"
        if any(k in _tr_lower(metin) for k in
               ("anlatıcı", "bakış açısı", "odak", "anlatım zamanı", "birinci tekil", "üçüncü")):
            satir = (r.title or "").strip()
            if (r.description or "").strip():
                satir += f": {r.description.strip()}"
            if satir:
                ilgili.append(satir)
    if not ilgili:
        return ""
    return (
        "=== ANLATICI SÖZLEŞMESİ (bu metin ona UYMALI) ===\n"
        "Kim anlatıyor, hangi mesafeden, neyi bilebilir - yeni metin bunu\n"
        "bozmamalı. Odak karakteri dışındakinin zihnine GİRME; anlatıcının\n"
        "bilemeyeceği bilgiyi verme.\n- " + "\n- ".join(ilgili[:8])
    )
