import json
import logging
import re

from openai import OpenAI
from sqlalchemy.orm import Session

from .config import settings
from .prompts import (
    REVIEW_OPTIONS_PROMPT,
    CHAPTER_SUMMARY_SYSTEM_PROMPT,
    PARAGRAPH_SPLIT_SYSTEM_PROMPT,
    ENTITY_EXTRACTION_SYSTEM_PROMPT,
    PROGRESSION_EXTRACTION_SYSTEM_PROMPT,
    RELATIONSHIP_EXTRACTION_SYSTEM_PROMPT,
    EVENT_EXTRACTION_SYSTEM_PROMPT,
    CHAT_SYSTEM_PROMPT,
    SYSTEM_PROMPT,
    FULL_SCAN_SYSTEM_PROMPT,
    MATRIX_FILL_SYSTEM_PROMPT,
    READER_TEST_SYSTEM_PROMPT,
    PARAGRAPH_ENTITY_PROMPT,
    PATTERN_SUGGEST_PROMPT,
    EVENT_DATE_SYSTEM_PROMPT,
    LITERARY_REVIEW_PROMPT,
    STRUCTURE_SCAN_PROMPT,
    VERIFY_PROMPT,
    RETEST_PROMPT,
    MOTIF_EXTRACT_PROMPT,
    MOTIF_ANALYZE_PROMPT,
    PARAGRAPH_ROLE_PROMPT,
    FUSION_PROMPT,
    TRADEOFF_PROMPT,
    NECESSITY_PROMPT,
    PLAN_FROM_TEXT_PROMPT,
    MICRO_EDIT_PROMPT,
    KNOWLEDGE_EXTRACT_PROMPT,
    TUR_REVIEW_PROMPT,
    VOICE_SCAN_PROMPT,
)
from .ai_context import (  # noqa: F401 - geriye dönük uyum (facade)
    build_fixed_layer,
    build_index_layer,
    build_dynamic_layer,
    build_style_layer,
    build_knowledge_layer,
    build_forward_layer,
    build_plan_layer,
    build_context,
    build_whole_novel_layer,
    build_current_chapter_layer,
    build_referenced_entries_layer,
    build_outline_layer,
    build_matrix_map_layer,
    build_parallel_layer,
    build_voice_layer,
)

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
        # ZAMAN AŞIMI + YENİDEN DENEME: yoktu. Ağ tıkandığında istek
        # sonsuza kadar bekliyor, kullanıcı "Failed to fetch" görüyordu.
        # openai kütüphanesi ikisini de destekliyor - yeni bağımlılık yok.
        # Yeniden deneme yalnızca GEÇİCİ hatalarda çalışır (bağlantı,
        # 429, 5xx); içerik hatasında tekrar denenmez.
        _client = OpenAI(
            api_key=settings.dashscope_api_key,
            base_url=settings.dashscope_base_url,
            timeout=settings.qwen_timeout_seconds,
            max_retries=settings.qwen_max_retries,
        )
    return _client
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


# ---------------------------------------------------------------------------
# AI İLE PARAGRAF BÖLME: elinde net paragraf ayraçları (boş satır) olmayan,
# tek blok hâlinde yapıştırılmış bir metni mantıklı paragraflara böler.
# KRİTİK KURAL: tek kelime bile DEĞİŞTİRİLMEZ - sadece nereye paragraf
# arası konacağına karar verir. Bu yüzden içe aktarma (import) sırasında
# blank-line ayracı bulamayan uzun bölümlerde ve "büyük metin yapıştır"
# özelliğinde kullanılır.
# ---------------------------------------------------------------------------


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


# Araç adları kullanıcıya sızmasın: prompt yasaklıyor ama model kimi zaman
# yine de yazıyor. Yanıt kullanıcıya gitmeden temizlenir - iç mekanizma
# ekranda görünmemeli.
_TOOL_LEAK_RE = re.compile(
    r"\s*(?:İstersen\s+)?[^.\n]*\b(set_draft_result|write_paragraph|"
    r"propose_entity_update|get_entity_section)\b[^.\n]*\.?",
    flags=re.IGNORECASE,
)


def strip_tool_leaks(text: str) -> str:
    if not text:
        return text
    temiz = _TOOL_LEAK_RE.sub("", text)
    return re.sub(r"\n{3,}", "\n\n", temiz).strip()


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
    ("karakterizasyon", "Karakterizasyon", "Karakter davranış, seçim ve konuşmayla mı inşa ediliyor, yoksa anlatılıyor mu? DİYALOG varsa: her konuşanın sesi ayrışıyor mu, replikler karakteri açığa çıkarıyor mu, alt metin taşıyor mu?"),
    ("uslup", "Üslup", "Yazarın kendine özgü sesi tutarlı mı? Ödünç/genel bir ton var mı?"),
]


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


def _canonical_names(db: Session, universe_id: int) -> set:
    """Evrende KAYITLI karakter/mekan/nesne adları ve takma adları.

    Neden gerekli: eskiden "büyük harfle başlayan her kelime özel isimdir"
    varsayımıyla regex kullanılıyordu ve CÜMLE BAŞI kelimeler ("Ama",
    "Sonra", "Küçük") özel isim sanılıyordu. Cümle yapısı değişince
    "özel isim düştü" diye HAKSIZ uyarı üretiliyor, derin kontrol
    neredeyse her öneriyi reddediyordu. Artık ölçüt kanon: sadece
    gerçekten kayıtlı adlar korunmalı sayılır."""
    isimler = set()
    for model in (models.Character, models.Place, models.Object):
        for kayit in db.query(model).filter(model.universe_id == universe_id).all():
            if (kayit.name or "").strip():
                isimler.add(kayit.name.strip())
            for takma in (getattr(kayit, "aliases", None) or []):
                if (takma or "").strip():
                    isimler.add(takma.strip())
    return isimler


def _extract_facts(text: str, canon: set | None = None) -> tuple[set, set]:
    """(sayılar, metinde geçen KANONİK isimler). Kanon verilmezse isim
    kontrolü yapılmaz - uydurma uyarı üretmektense hiç üretmemek yeğdir."""
    sayilar = set(NUMBER_TOKEN_RE.findall(text or ""))
    if not canon:
        return sayilar, set()
    metin = text or ""
    return sayilar, {ad for ad in canon if ad and ad in metin}


def verify_paragraph_rewrite(db: Session, universe_id: int, old_text: str, new_text: str,
                             purpose: str = "", neighbors: str = "",
                             proposal_goal: str = "", expected_effect: str = "",
                             accepted_changes: str = "") -> dict:
    """Yeni versiyonu denetler. Deterministik bulgular + AI kararı döner."""
    hard_issues = []

    # AYNI METİN KORUMASI: eski ve yeni hâl aynıysa doğrulanacak bir şey
    # yoktur. Eskiden bu durumda AI çağrılıyor ve "öneri başarıyla
    # uygulanmış" gibi YANILTICI bir onay dönüyordu - kullanıcı hiçbir
    # denetimden geçmemiş metni onaylanmış sanıyordu.
    if (old_text or "").strip() == (new_text or "").strip():
        return {
            "verdict": "duzelt",
            "hard_issues": ["Metin DEĞİŞMEMİŞ - eski ve yeni hâl birebir aynı. "
                            "Doğrulanacak bir değişiklik yok."],
            "issues": [],
            "note": "Öneri metni değiştirmemiş; yeniden üretmeyi ya da sohbetle "
                    "yönlendirmeyi dene.",
        }

    # 1) Somut detay kaybı (deterministik) - isimler KANON listesinden
    canon = _canonical_names(db, universe_id)
    eski_sayilar, eski_isimler = _extract_facts(old_text, canon)
    yeni_sayilar, yeni_isimler = _extract_facts(new_text, canon)
    kayip_sayi = sorted(eski_sayilar - yeni_sayilar)
    kayip_isim = sorted(eski_isimler - yeni_isimler)
    if kayip_sayi:
        hard_issues.append(f"Somut detay düştü - eski metindeki sayılar yeni metinde yok: {', '.join(kayip_sayi)}")
    if kayip_isim:
        # ZAMİR İSTİSNASI: bir ismin yerine zamir geçmesi KAYIP değildir -
        # dilin doğal işleyişidir ("Vicdan bekledi" -> "O bekledi"). Salt
        # dize varlığına bakmak burada yanlış uyarı üretiyor ve modeli
        # ismi zorla geri koymaya itiyor (yapay metin).
        zamirler = ("o ", "onu", "ona", "onun", "kendi", "adam", "kadın", "ihtiyar",
                    "teknisyen", "yargıç", "başkan", "mühendis")
        yeni_norm = _tr_lower(new_text)
        zamir_var = any(z in yeni_norm for z in zamirler)
        if zamir_var and len(kayip_isim) <= 2:
            hard_issues.append(
                f"Özel isim geçmiyor ({', '.join(kayip_isim)}) - yerine zamir/sıfat "
                f"kullanılmış olabilir. Bağlamdan kim olduğu anlaşılıyorsa SORUN DEĞİL; "
                f"anlaşılmıyorsa ismi geri koy."
            )
        else:
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
    korunacak = sorted(eski_isimler | eski_sayilar)
    user = (
        (f"YAZARLA KARARLAŞTIRILMIŞ DEĞİŞİKLİKLER (bunlar BİLEREK yapıldı - "
         f"kayıp/sorun olarak YAZMA):\n{accepted_changes}\n\n" if accepted_changes.strip() else "")
        + (f"ÖNERİNİN AMACI: {proposal_goal}\n" if proposal_goal.strip() else "")
        + (f"BEKLENEN ETKİ: {expected_effect}\n" if expected_effect.strip() else "")
        + ("\n" if (proposal_goal.strip() or expected_effect.strip()) else "")
        + (f"PARAGRAFIN İŞLEVİ: {purpose}\n\n" if purpose.strip() else "")
        + (f"KORUNMASI GEREKEN VERİLER (yalnızca bunlar): {', '.join(korunacak)}\n\n" if korunacak else "")
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
    # İŞLEV KORUNUMU: "hata düzeltildi ama metin zayıfladı" durumunu
    # yakalayan ayrı bir eksen. Sadece kusur aramak yeterli değil - özgün
    # cümlenin İŞİ de korunmalı. C (kayboldu) tek başına ret sebebidir.
    fp = data.get("function_preservation")
    fp = fp if fp in ("A", "B", "C") else "A"
    fp_note = (data.get("function_note") or "")[:300]
    if fp == "C":
        verdict = "red"
        ai_issues.insert(0, f"İŞLEV KAYBI: özgün cümlenin işlevi yeni metinde yok. {fp_note}")
    elif fp == "B" and verdict == "kabul":
        verdict = "duzelt"
        ai_issues.insert(0, f"İŞLEV DAĞILDI: işlev bu cümlede yok, komşulara yayılmış. {fp_note}")

    # Deterministik bulgu varsa karar en az "duzelt" olur - AI kabul dese bile
    if hard_issues and verdict == "kabul":
        verdict = "duzelt"
    return {
        "verdict": verdict,
        "hard_issues": hard_issues,
        "issues": ai_issues,
        "note": (data.get("note") or "")[:300],
        "function_preservation": fp,
        "function_note": fp_note,
    }


# ---------------------------------------------------------------------------
# TEK PARAGRAF YENİDEN TESTİ: bir paragraf düzeltildikten SONRA, giderilmesi
# istenen bulguların gerçekten giderilip giderilmediğini ölçer. Kabul kontrolü
# "detay düştü mü, çelişti mi" diye bakıyordu; bu ise "klişe kalktı mı,
# alt metin oluştu mu" diye bakar - döngüyü asıl kapatan denetim budur.
# ---------------------------------------------------------------------------


def retest_paragraph(db: Session, old_text: str, new_text: str, findings: list,
                    proposal_goal: str = "", expected_effect: str = "") -> dict:
    """Düzeltilmiş paragrafı, giderilmesi istenen bulgulara karşı sınar."""
    if not findings:
        return {"results": [], "new_issues": [], "verdict": "iyilesti"}
    liste = "\n".join(f"- {f}" for f in findings[:8])
    user = (
        (f"UYGULANAN ÖNERİ: {proposal_goal}\n" if proposal_goal.strip() else "")
        + (f"BEKLENEN ETKİ: {expected_effect}\n" if expected_effect.strip() else "")
        + f"\nBULGULAR:\n{liste}\n\nESKİ HÂLİ:\n{old_text}\n\nYENİ HÂLİ:\n{new_text}"
    )
    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[{"role": "system", "content": RETEST_PROMPT}, {"role": "user", "content": user}],
    )
    data = _parse_json_lenient(response.choices[0].message.content) or {}
    gecerli = {"giderildi", "kismen", "giderilmedi"}
    return {
        "results": [
            {
                "finding": (r.get("finding") or "")[:120],
                "status": r.get("status") if r.get("status") in gecerli else "kismen",
                "note": (r.get("note") or "")[:200],
            }
            for r in (data.get("results") or []) if isinstance(r, dict)
        ],
        "new_issues": [str(x)[:200] for x in (data.get("new_issues") or [])][:5],
        "verdict": data.get("verdict") if data.get("verdict") in ("iyilesti", "ayni", "kotulesti") else "iyilesti",
    }


# ---------------------------------------------------------------------------
# MOTİF / İMGE HARİTASI: bölümün TÜM paragraflarındaki imgeleri çıkarır ve
# tekrarları bulur. Dilimleme sınırını aşar - metni değil İMGE LİSTESİNİ
# kıyaslar, o yüzden 12. paragrafla 78. paragraf aynı bakışta görülebilir.
# Üslup taraması kelime/yapı kalıplarını yakalar ama "yosun tutmuş su" ile
# "kararmış cam" gibi FARKLI kelimelerle kurulmuş aynı motifi göremez.
# ---------------------------------------------------------------------------


def motif_map(db: Session, chapter, max_chars: int = 12000) -> dict:
    """Bölümün imge haritasını çıkarır ve tekrarları değerlendirir."""
    paragraphs = [p for p in chapter.paragraphs if (p.text or "").strip()]
    if len(paragraphs) < 3:
        return {"items": [], "repeats": [], "unused_senses": [], "summary": "İmge haritası için en az 3 paragraf gerekir."}

    # 1) Çıkarım - dilimlenerek (tüm paragraflar kapsanır)
    dilimler, mevcut, used = [], [], 0
    for p in paragraphs:
        satir = f"[P{p.number}] {p.text.strip()}"
        if mevcut and used + len(satir) > max_chars:
            dilimler.append(mevcut); mevcut, used = [], 0
        mevcut.append(satir); used += len(satir)
    if mevcut:
        dilimler.append(mevcut)

    client = get_client()
    items = []
    for dilim in dilimler:
        try:
            r = client.chat.completions.create(
                model=settings.qwen_model,
                messages=[{"role": "system", "content": MOTIF_EXTRACT_PROMPT},
                          {"role": "user", "content": "\n".join(dilim)}],
            )
            data = _parse_json_lenient(r.choices[0].message.content) or {}
            for it in data.get("items", []):
                if isinstance(it, dict) and (it.get("image") or "").strip():
                    durum = it.get("motif_status")
                    if durum not in ("ilk_gorunum", "tekrar_adayi", "kanitli"):
                        durum = "ilk_gorunum"
                    # Kanıtsız motif anlamı KABUL EDİLMEZ - model kendi
                    # kültürel bilgisinden anlam atamasın diye sert kural
                    motif = (it.get("motif") or "").strip()[:60]
                    if durum != "kanitli" or not (it.get("evidence") or "").strip():
                        motif = ""
                    items.append({
                        "p": it.get("p") if isinstance(it.get("p"), int) else None,
                        "image": it["image"].strip()[:60],
                        "motif": motif,
                        "motif_status": durum,
                        "evidence": (it.get("evidence") or "").strip()[:120],
                    })
        except Exception:
            logger.exception("Motif çıkarımı: dilim başarısız")

    if not items:
        return {"items": [], "repeats": [], "unused_senses": [], "summary": "İmge çıkarılamadı."}

    # 2) Değerlendirme - SADECE liste gönderilir (ucuz, tüm bölüm bir arada)
    liste = "\n".join(
        f"P{i['p']}: {i['image']}"
        + (f" [motif: {i['motif']} - kanıt: {i['evidence']}]" if i.get("motif") else f" [{i.get('motif_status', '')}]")
        for i in items if i["p"]
    )
    try:
        r2 = client.chat.completions.create(
            model=settings.qwen_model,
            messages=[{"role": "system", "content": MOTIF_ANALYZE_PROMPT},
                      {"role": "user", "content": liste}],
        )
        analiz = _parse_json_lenient(r2.choices[0].message.content) or {}
    except Exception:
        logger.exception("Motif analizi başarısız")
        analiz = {}

    return {
        "items": items,
        "repeats": [
            {
                "image": (x.get("image") or "")[:60],
                "paragraphs": [n for n in (x.get("paragraphs") or []) if isinstance(n, int)],
                "kind": x.get("kind") if x.get("kind") in ("leitmotif", "tekrar", "belirsiz") else "belirsiz",
                "confidence": (lambda c: max(0.0, min(1.0, c)))(
                    float(x.get("confidence", 0.5)) if isinstance(x.get("confidence"), (int, float)) else 0.5),
                "reason": (x.get("reason") or "")[:300],
                "fix": (x.get("fix") or "")[:300],
            }
            for x in (analiz.get("repeats") or []) if isinstance(x, dict)
        ],
        "unused_senses": [str(x)[:40] for x in (analiz.get("unused_senses") or [])][:5],
        "summary": (analiz.get("summary") or "")[:400],
    }


# ---------------------------------------------------------------------------
# PARAGRAF İŞLEVLERİ (otomatik): her paragrafın sahnedeki GÖREVİNİ çıkarır -
# "olay mahalli tanıtılıyor", "dijital doğum hazırlığı", "gerilim kuruluyor".
# Neden gerekli: işlev, yeniden yazımın ölçüsüdür ama 100 paragrafa tek tek
# elle yazmak gerçekçi değildi. Bölüm özeti + plan + metin zaten elimizde;
# AI bunu kendisi çıkarabilir. Kullanıcı gerekirse üzerine yazar.
# ---------------------------------------------------------------------------


def paragraph_roles(db: Session, chapter, max_chars: int = 12000) -> list[dict]:
    """Bölümdeki her paragrafın işlevini çıkarır. Uzun bölümler dilimlenir."""
    paragraphs = [p for p in chapter.paragraphs if (p.text or "").strip()]
    if not paragraphs:
        return []
    ozet = (chapter.summary or "").strip()
    plan_hucre = db.query(models.MatrixCell).filter(models.MatrixCell.chapter_id == chapter.id).first()
    plan = (plan_hucre.content or "").strip() if plan_hucre else ""

    dilimler, mevcut, used = [], [], 0
    for p in paragraphs:
        satir = f"[P{p.number}] {p.text.strip()}"
        if mevcut and used + len(satir) > max_chars:
            dilimler.append(mevcut); mevcut, used = [], 0
        mevcut.append(satir); used += len(satir)
    if mevcut:
        dilimler.append(mevcut)

    gecerli_turler = {"betimleme", "diyalog", "eylem", "ic_ses", "gecis", "bilgi"}
    numaralar = {p.number for p in paragraphs}
    client = get_client()
    out = []
    for dilim in dilimler:
        baslik = ""
        if ozet:
            baslik += f"BÖLÜM ÖZETİ:\n{ozet}\n\n"
        if plan:
            baslik += f"BÖLÜM PLANI:\n{plan}\n\n"
        try:
            r = client.chat.completions.create(
                model=settings.qwen_model,
                messages=[{"role": "system", "content": PARAGRAPH_ROLE_PROMPT},
                          {"role": "user", "content": baslik + "\n".join(dilim)}],
            )
            data = _parse_json_lenient(r.choices[0].message.content) or {}
        except Exception:
            logger.exception("Paragraf işlevi çıkarımı: dilim başarısız")
            continue
        for it in data.get("roles", []):
            if not isinstance(it, dict):
                continue
            num = it.get("p")
            rol = (it.get("role") or "").strip()
            if num in numaralar and rol:
                out.append({
                    "p": num,
                    "role": rol[:160],
                    "kind": it.get("kind") if it.get("kind") in gecerli_turler else "betimleme",
                })
    return out


# ---------------------------------------------------------------------------
# TEŞHİS FÜZYONU (Diagnostic Fusion). Üç test aynı soruna üç ayrı isimle
# işaret edebiliyor: "alt metin zayıf" + "bilgi doğrudan veriliyor" +
# "karakterin bunu söylemesi profiliyle uyumsuz" aslında TEK teşhistir.
# Bu katman bulguları birleştirir ve HER teşhisi sınıflandırır:
#   HATA   - gerçek kusur (kanon çelişkisi, mantık hatası)
#   ZAYIF  - tartışılabilir zayıflık (öneri üretilir)
#   TERCİH - yazarın bilinçli tercihi olabilir (ÖNERİ ÜRETİLMEZ, bilgi verilir)
#   BELİRSİZ - kanıt yetersiz (karar verilemez)
# Kritik ilke: bir edebî normdan sapma otomatik olarak hata DEĞİLDİR.
# ---------------------------------------------------------------------------


def fuse_diagnoses(db: Session, paragraph_text: str, findings: list,
                   purpose: str = "", neighbors: str = "") -> list[dict]:
    """Ham bulguları birleştirip sınıflandırır. Kaydetmez."""
    if not findings:
        return []
    ham = "\n".join(f"- [{f.get('source', '?')}] {f.get('title', '')}: {f.get('detail', '')}"
                    for f in findings)
    user = (
        (f"PARAGRAFIN İŞLEVİ: {purpose}\n\n" if purpose.strip() else "")
        + f"PARAGRAF:\n{paragraph_text}\n\n"
        + (f"KOMŞULAR:\n{neighbors}\n\n" if neighbors else "")
        + f"HAM BULGULAR (hipotez - doğru kabul etme):\n{ham}"
    )
    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[{"role": "system", "content": FUSION_PROMPT}, {"role": "user", "content": user}],
    )
    data = _parse_json_lenient(response.choices[0].message.content) or {}
    gecerli = {"hata", "zayif", "tercih", "belirsiz"}
    out = []
    for d in data.get("diagnoses", []):
        if not isinstance(d, dict) or not (d.get("title") or "").strip():
            continue
        sinif = d.get("class") if d.get("class") in gecerli else "belirsiz"
        # Kanıtsız teşhis "belirsiz"e çekilir - halüsinasyona karşı sert kural
        if not (d.get("evidence") or "").strip() and sinif in ("hata", "zayif"):
            sinif = "belirsiz"
        try:
            guven = max(0.0, min(1.0, float(d.get("confidence", 0.5))))
        except (TypeError, ValueError):
            guven = 0.5
        # Ölçülemez ölçüt işe yaramaz - "daha edebi olsun" gibi ifadeler
        # üreticiyi yönlendirmiyor, aynı eşanlamlıları ürettiriyor.
        olcut = (d.get("success_criterion") or "").strip()[:300]
        if sinif in ("tercih", "belirsiz"):
            olcut = ""
        out.append({
            "title": d["title"].strip()[:200],
            "cls": sinif,
            "success_criterion": olcut,
            "evidence": (d.get("evidence") or "").strip()[:120],
            "sources": [str(x)[:20] for x in (d.get("sources") or [])][:5],
            "confidence": guven,
            "why": (d.get("why") or "")[:300],
            "intent_note": (d.get("intent_note") or "")[:300],
        })
    return out[:8]


# ---------------------------------------------------------------------------
# KAZANÇ-KAYIP + KARŞI ARGÜMAN. Bir öneri yalnızca kazandırdığını değil,
# KAYBETTİRDİĞİNİ de hesaplamalı: "tempo +2, atmosfer -3 → net -1" ise öneri
# reddedilmeli. Ayrıca sistem kendi önerisine karşı argüman üretmeli -
# "bu yavaşlık karakterin zihinsel donmasını taşıyor olabilir".
# ---------------------------------------------------------------------------


def evaluate_tradeoff(db: Session, old_text: str, new_text: str, purpose: str = "") -> dict:
    """Öneriyi kazanç-kayıp dengesiyle ölçer ve karşı argüman üretir."""
    user = (
        (f"PARAGRAFIN İŞLEVİ: {purpose}\n\n" if purpose.strip() else "")
        + f"ESKİ HÂLİ:\n{old_text}\n\nÖNERİLEN HÂLİ:\n{new_text}"
    )
    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[{"role": "system", "content": TRADEOFF_PROMPT}, {"role": "user", "content": user}],
    )
    data = _parse_json_lenient(response.choices[0].message.content) or {}
    def _puanlar(anahtar, isaret):
        out = []
        for x in (data.get(anahtar) or []):
            if not isinstance(x, dict):
                continue
            try:
                p = max(-3, min(3, int(x.get("score", 0))))
            except (TypeError, ValueError):
                p = 0
            out.append({"dim": (x.get("dim") or "")[:20], "score": p, "why": (x.get("why") or "")[:200]})
        return out
    gains, losses = _puanlar("gains", 1), _puanlar("losses", -1)
    net = sum(g["score"] for g in gains) + sum(l["score"] for l in losses)
    tavsiye = data.get("recommend") if data.get("recommend") in ("uygula", "tartis", "reddet") else None
    if not tavsiye:
        tavsiye = "uygula" if net > 0 else ("tartis" if net == 0 else "reddet")
    return {
        "gains": gains, "losses": losses, "net": net,
        "counter_argument": (data.get("counter_argument") or "")[:400],
        "recommend": tavsiye,
    }


# ---------------------------------------------------------------------------
# SİLME TESTİ: "Bu paragraf silinirse ne kaybolur?" Cevap "hiçbir şey" ise
# güçlü bir kesme adayıdır; ama karakter değişimi ya da ön sezdirme
# taşıyorsa silme önerisi ENGELLENMELİ. Ayrıca EDEBÎ KALİTE ile ANLATISAL
# GEREKLİLİK ayrı ölçülür: "iyi yazılmış ama gereksiz" ile "zayıf yazılmış
# ama zorunlu" tamamen farklı iki durumdur ve farklı müdahale ister.
# ---------------------------------------------------------------------------


def paragraph_necessity(db: Session, chapter, paragraph_text: str, purpose: str = "") -> dict:
    ozet = (chapter.summary or "").strip()
    user = (
        (f"BÖLÜM ÖZETİ:\n{ozet}\n\n" if ozet else "")
        + (f"PARAGRAFIN İŞLEVİ: {purpose}\n\n" if purpose.strip() else "")
        + f"PARAGRAF:\n{paragraph_text}"
    )
    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[{"role": "system", "content": NECESSITY_PROMPT}, {"role": "user", "content": user}],
    )
    data = _parse_json_lenient(response.choices[0].message.content) or {}
    def _puan(k, vars=5):
        try:
            return max(1, min(10, int(data.get(k, vars))))
        except (TypeError, ValueError):
            return vars
    gecerli_kayip = {"hicbir_sey", "bilgi", "duygu", "karakter_degisimi", "on_sezdirme",
                     "motif", "gecis", "atmosfer", "tema", "odeme"}
    loses = [x for x in (data.get("loses") or []) if x in gecerli_kayip] or ["bilgi"]
    verdict = data.get("verdict") if data.get("verdict") in (
        "korunmali", "kisaltilmali", "guclendirilmeli", "silinebilir") else "korunmali"
    # KORUMA: karakter değişimi / ön sezdirme varsa silme önerisi engellenir
    if verdict == "silinebilir" and ({"karakter_degisimi", "on_sezdirme"} & set(loses)):
        verdict = "korunmali"
    if verdict == "silinebilir" and loses != ["hicbir_sey"]:
        verdict = "kisaltilmali"
    return {
        "literary_quality": _puan("literary_quality", 6),
        "narrative_necessity": _puan("narrative_necessity", 6),
        "loses": loses, "verdict": verdict, "note": (data.get("note") or "")[:300],
    }


# ---------------------------------------------------------------------------
# METİNDEN PLAN ÇIKARIMI: yazılmış bir bölümden geriye dönük plan üretir.
# Önce yazıp sonra planlayan bir yazar için şart - plan yoksa paragrafların
# işlevi tanımsız kalıyor, Talimat Kasası ve işlev mirası çalışmıyor.
# ---------------------------------------------------------------------------


def plan_from_text(db: Session, chapter, max_chars: int = 14000) -> str:
    paragraphs = [p for p in chapter.paragraphs if (p.text or "").strip()]
    if not paragraphs:
        return ""
    metin, used = [], 0
    for p in paragraphs:
        satir = p.text.strip()
        if used + len(satir) > max_chars:
            metin.append("[... kalanı kırpıldı ...]")
            break
        metin.append(satir)
        used += len(satir)
    ozet = (chapter.summary or "").strip()
    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[
            {"role": "system", "content": PLAN_FROM_TEXT_PROMPT},
            {"role": "user", "content": (f"BÖLÜM ÖZETİ:\n{ozet}\n\n" if ozet else "")
             + f"BÖLÜM METNİ:\n" + "\n\n".join(metin)},
        ],
    )
    return (response.choices[0].message.content or "").strip()[:2000]


# ---------------------------------------------------------------------------
# MİKRO DÜZENLEME: tüm paragrafı yeniden yazmadan, TEK NOKTAYA müdahale.
# "Vicdan ile robot palyaço" gibi tek bir ifade takıldığında paragrafı baştan
# yazdırmak hem gereksiz hem riskli (iyi cümleler kayboluyor). Bu motor
# yalnızca hedeflenen parçayı değiştirir, gerisine DOKUNMAZ.
# ---------------------------------------------------------------------------


def micro_edit(db: Session, paragraph_text: str, target: str, request_text: str,
               purpose: str = "") -> list[dict]:
    """Paragrafın yalnızca hedef parçası için üç alternatif üretir."""
    if not target.strip() or target not in paragraph_text:
        return []
    user = (
        (f"PARAGRAFIN İŞLEVİ: {purpose}\n\n" if purpose.strip() else "")
        + f"PARAGRAF:\n{paragraph_text}\n\n"
        + f"HEDEF PARÇA (sadece bunu değiştir):\n{target}\n\n"
        + f"İSTEK:\n{request_text or 'Bu ifadeyi güçlendir; klişeden kaçın.'}"
    )
    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[{"role": "system", "content": MICRO_EDIT_PROMPT}, {"role": "user", "content": user}],
    )
    data = _parse_json_lenient(response.choices[0].message.content) or {}
    out = []
    for o in (data.get("options") or []):
        if not isinstance(o, dict):
            continue
        yeni = (o.get("replacement") or "").strip()
        if not yeni:
            continue
        out.append({
            "replacement": yeni[:400],
            "why": (o.get("why") or "")[:200],
            "preview": paragraph_text.replace(target, yeni, 1),
        })
    return out[:4]


# ---------------------------------------------------------------------------
# BİLGİ HARİTASI OTOMATİK ÇIKARIMI: bölüm özetlerini tarayarak "kim ne
# biliyor" tablosunu önerir ve TUTARSIZLIKLARI bildirir. Elle doldurmak
# gerçekçi değildi; özetler zaten kimin neyi öğrendiğini içeriyor.
# Kritik tutarsızlıklar: bir karakter bilmediği bir bilgiye göre davranıyor,
# okura ifşa edilmemiş bir sır sanki biliniyormuş gibi anlatılıyor,
# ifşa edilen bir bilgi sonradan tekrar sır muamelesi görüyor.
# ---------------------------------------------------------------------------


def extract_knowledge_map(db: Session, novel_id: int, max_chars: int = 24000) -> dict:
    """Bölüm özetlerinden bilgi haritası önerir ve tutarsızlıkları bulur.
    Kaydetmez - kullanıcı onaylayınca kaydedilir."""
    chapters = (
        db.query(models.Chapter)
        .filter(models.Chapter.novel_id == novel_id)
        .order_by(models.Chapter.number)
        .all()
    )
    ozetli = [c for c in chapters if (c.summary or "").strip()]
    if len(ozetli) < 2:
        return {"facts": [], "issues": [], "note": "Bilgi haritası için en az 2 özetli bölüm gerekir."}

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
            {"role": "system", "content": KNOWLEDGE_EXTRACT_PROMPT},
            {"role": "user", "content": "BÖLÜM ÖZETLERİ:\n\n" + "\n\n".join(bloklar)},
        ],
    )
    data = _parse_json_lenient(response.choices[0].message.content) or {}

    # Karakter adlarını kanona bağla (uydurma isim kaydedilmesin)
    kanon = {}
    for ch_kayit in db.query(models.Character).all():
        kanon[_tr_lower(ch_kayit.name)] = ch_kayit.id
        for takma in (ch_kayit.aliases or []):
            kanon[_tr_lower(takma)] = ch_kayit.id

    gecerli_durum = {"hayir", "sezdirildi", "evet"}
    facts = []
    for f in (data.get("facts") or []):
        if not isinstance(f, dict) or not (f.get("information") or "").strip():
            continue
        if not (f.get("evidence") or "").strip():
            continue        # kanıtsız madde alınmaz
        ids = [kanon[_tr_lower(a)] for a in (f.get("characters") or [])
               if isinstance(a, str) and _tr_lower(a) in kanon]
        facts.append({
            "information": f["information"].strip()[:300],
            "introduced_chapter": f.get("introduced_chapter") if isinstance(f.get("introduced_chapter"), int) else None,
            "reveal_chapter": f.get("reveal_chapter") if isinstance(f.get("reveal_chapter"), int) else None,
            "reader_state": f.get("reader_state") if f.get("reader_state") in gecerli_durum else "hayir",
            "known_by_characters": ids,
            "character_names": [a for a in (f.get("characters") or []) if isinstance(a, str)][:8],
            "reveal_method": (f.get("reveal_method") or "")[:200],
            "planned_payoff": (f.get("planned_payoff") or "")[:200],
            "evidence": (f.get("evidence") or "")[:300],
        })

    gecerli_tur = {"bilgi_sizmasi", "erken_ifsa", "odenmemis_kurulum", "celiski"}
    issues = [
        {
            "type": i.get("type") if i.get("type") in gecerli_tur else "celiski",
            "information": (i.get("information") or "")[:300],
            "chapters": [n for n in (i.get("chapters") or []) if isinstance(n, int)],
            "problem": (i.get("problem") or "")[:400],
            "fix": (i.get("fix") or "")[:400],
        }
        for i in (data.get("issues") or []) if isinstance(i, dict) and (i.get("problem") or "").strip()
    ][:8]
    return {"facts": facts[:12], "issues": issues, "note": ""}
# ---------------------------------------------------------------------------
# TUR (ÜST BAŞLIK) DEĞERLENDİRMESİ: bir üst başlık altındaki tüm alt
# girdileri BİR BÜTÜN olarak denetler. Bölüm incelemesi tek girdiye,
# yapısal tarama roman geneline bakıyordu; arada "tur" seviyesi boştu -
# oysa kullanıcının yapısında asıl anlamlı birim bu.
# ---------------------------------------------------------------------------


def review_arc(db: Session, novel_id: int, parent_chapter_id: int, max_chars: int = 18000) -> dict:
    """Bir üst başlık (tur) altındaki alt girdileri bütün olarak denetler."""
    from .outline import build_hierarchy

    chapters = db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id).all()
    items = build_hierarchy(chapters)
    numara = {it["chapter"].id: it["display"] for it in items}
    parent = next((it for it in items if it["chapter"].id == parent_chapter_id), None)
    if not parent:
        return {"summary": "Girdi bulunamadı.", "rhythm": [], "repeats": []}

    # Doğrudan VE dolaylı alt girdiler (sıralı)
    alt = [it for it in items if it["parent_id"] == parent_chapter_id]
    if not alt:
        return {"summary": "Bu girdinin alt sahnesi yok - tur değerlendirmesi için "
                           "altında alt başlıklar olmalı.", "rhythm": [], "repeats": []}

    bloklar, used = [], 0
    for it in alt:
        c = it["chapter"]
        p_sayisi = len([p for p in c.paragraphs if (p.text or "").strip()])
        ozet = (c.summary or "").strip() or "(özet yok - bu sahne körlemesine değerlendiriliyor)"
        parca = f"--- Sahne {numara.get(c.id, '?')} - {c.title or ''} ({p_sayisi} paragraf) ---\n{ozet}"
        if used + len(parca) > max_chars:
            bloklar.append("[... kalan sahneler kırpıldı ...]")
            break
        bloklar.append(parca)
        used += len(parca)

    client = get_client()
    baslik = parent["chapter"].title or f"Bölüm {parent['chapter'].number}"
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[
            {"role": "system", "content": TUR_REVIEW_PROMPT},
            {"role": "user", "content": f"TUR: {baslik}\n\n" + "\n\n".join(bloklar)},
        ],
    )
    data = _parse_json_lenient(response.choices[0].message.content) or {}
    return {
        "arc": data.get("arc") if data.get("arc") in ("yukseliyor", "duz", "dusuyor") else "duz",
        "arc_note": (data.get("arc_note") or "")[:400],
        "rhythm": [
            {"scene": str(r.get("scene", ""))[:20], "issue": (r.get("issue") or "")[:300],
             "fix": (r.get("fix") or "")[:300]}
            for r in (data.get("rhythm") or []) if isinstance(r, dict) and (r.get("issue") or "").strip()
        ][:8],
        "repeats": [str(x)[:300] for x in (data.get("repeats") or [])][:6],
        "closing": (data.get("closing") or "")[:400],
        "volume_note": (data.get("volume_note") or "")[:300],
        "summary": (data.get("summary") or "")[:400],
        "scenes": [{"display": numara.get(it["chapter"].id, "?"),
                    "title": it["chapter"].title or "",
                    "paragraphs": len([p for p in it["chapter"].paragraphs if (p.text or "").strip()])}
                   for it in alt],
    }
def scan_voice(db: Session, chapter, universe_id: int, max_chars: int = 12000) -> dict:
    """Bölümde anlatıcı sözleşmesi ihlallerini arar. Uzun bölüm dilimlenir."""
    paragraphs = [p for p in chapter.paragraphs if (p.text or "").strip()]
    if not paragraphs:
        return {"contract": {}, "violations": []}

    sozlesme = build_voice_layer(db, universe_id) or "(Sözleşme tanımlanmamış - metinden çıkar.)"
    dilimler, mevcut, used = [], [], 0
    for p in paragraphs:
        satir = f"[P{p.number}] {p.text.strip()}"
        if mevcut and used + len(satir) > max_chars:
            dilimler.append(mevcut); mevcut, used = [], 0
        mevcut.append(satir); used += len(satir)
    if mevcut:
        dilimler.append(mevcut)

    gecerli = {"bakis_kaymasi", "bilgi_asimi", "mesafe_kaymasi", "yorum_sizmasi", "zaman_kaymasi"}
    numaralar = {p.number for p in paragraphs}
    client = get_client()
    contract, violations = {}, []
    for i, dilim in enumerate(dilimler, start=1):
        try:
            r = client.chat.completions.create(
                model=settings.qwen_model,
                messages=[
                    {"role": "system", "content": VOICE_SCAN_PROMPT},
                    {"role": "user", "content": f"{sozlesme}\n\nBÖLÜM {chapter.number} - PARÇA {i}/{len(dilimler)}:\n"
                     + "\n".join(dilim)},
                ],
            )
            data = _parse_json_lenient(r.choices[0].message.content) or {}
        except Exception:
            logger.exception("Anlatıcı taraması: parça %s başarısız", i)
            continue
        if not contract and isinstance(data.get("contract"), dict):
            c = data["contract"]
            contract = {
                "narrator": (c.get("narrator") or "")[:40],
                "focal": (c.get("focal") or "")[:60],
                "distance": (c.get("distance") or "")[:20],
                "tense": (c.get("tense") or "")[:20],
                "note": (c.get("note") or "")[:200],
            }
        for v in (data.get("violations") or []):
            if not isinstance(v, dict):
                continue
            # KANIT ZORUNLU - kanıtsız ihlal alınmaz (halüsinasyon koruması)
            if not (v.get("evidence") or "").strip():
                continue
            num = v.get("paragraph")
            violations.append({
                "paragraph": num if num in numaralar else None,
                "type": v.get("type") if v.get("type") in gecerli else "mesafe_kaymasi",
                "evidence": (v.get("evidence") or "")[:150],
                "problem": (v.get("problem") or "")[:300],
                "fix": (v.get("fix") or "")[:300],
                "certainty": v.get("certainty") if v.get("certainty") in ("kesin", "belirsiz") else "belirsiz",
            })
    violations.sort(key=lambda x: (x["paragraph"] is None, x["paragraph"] or 0))
    return {"contract": contract, "violations": violations[:15]}



# ---------------------------------------------------------------------------
# ADAYLARI BİRLİKTE DEĞERLENDİRME. Eskiden her seçenek TEK TEK denetleniyordu
# (üç ayrı istek) ve hiçbiri "bu üçünden hangisi bulguları en iyi gideriyor"
# sorusunu cevaplamıyordu. Birlikte değerlendirme hem TEK istek hem daha
# isabetli - model adayları kıyaslayabiliyor.
#
# Otomatik yeniden üretim BİLEREK YOK: kontrol sık sık fazla katı davranıyor
# ve otomatik ret, kullanıcıyı sistemin katılığına hapseden bir döngü kurar.
# Sistem "üçü de yetersiz, sebebi bu" der; kararı kullanıcı verir.
# ---------------------------------------------------------------------------

def review_options(db: Session, original: str, options: list[str], findings: list[str],
                   purpose: str = "") -> dict:
    adaylar = [o for o in options if (o or "").strip()][:4]
    if not adaylar:
        return {"options": [], "best_index": None, "all_insufficient": True,
                "best_reason": "", "retry_hint": "Aday üretilemedi."}

    user = (
        (f"PARAGRAFIN İŞLEVİ: {purpose}\n\n" if purpose.strip() else "")
        + (f"GİDERİLMESİ İSTENEN BULGULAR:\n- " + "\n- ".join(findings[:8]) + "\n\n" if findings else "")
        + f"ORİJİNAL:\n{original}\n\n"
        + "\n\n".join(f"ADAY {i}:\n{t}" for i, t in enumerate(adaylar))
    )
    client = get_client()
    response = client.chat.completions.create(
        model=settings.qwen_model,
        messages=[{"role": "system", "content": REVIEW_OPTIONS_PROMPT},
                  {"role": "user", "content": user}],
    )
    data = _parse_json_lenient(response.choices[0].message.content) or {}

    gecerli = {"iyi", "kismi", "kotu"}
    out = []
    for i in range(len(adaylar)):
        ham = next((o for o in (data.get("options") or [])
                    if isinstance(o, dict) and o.get("index") == i), {})
        out.append({
            "index": i,
            "verdict": ham.get("verdict") if ham.get("verdict") in gecerli else "kismi",
            "resolved": [str(x)[:200] for x in (ham.get("resolved") or [])][:6],
            "remaining": [str(x)[:200] for x in (ham.get("remaining") or [])][:6],
            "new_issues": [str(x)[:200] for x in (ham.get("new_issues") or [])][:4],
            "note": (ham.get("note") or "")[:300],
        })

    en_iyi = data.get("best_index")
    if not isinstance(en_iyi, int) or not (0 <= en_iyi < len(out)):
        # Model seçmediyse kendimiz seçelim: "iyi" olan ilk aday
        en_iyi = next((o["index"] for o in out if o["verdict"] == "iyi"), None)
    hepsi_yetersiz = bool(data.get("all_insufficient")) or all(o["verdict"] == "kotu" for o in out)
    return {
        "options": out,
        "best_index": en_iyi,
        "best_reason": (data.get("best_reason") or "")[:300],
        "all_insufficient": hepsi_yetersiz,
        "retry_hint": (data.get("retry_hint") or "")[:300],
    }
