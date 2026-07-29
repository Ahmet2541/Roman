import json
import re

from openai import OpenAI
from sqlalchemy.orm import Session

from .config import settings
from . import models
from .entities import ENTITY_MODELS, ENTITY_LABELS_TR
from .mentions import detect_and_save_mentions

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

def build_fixed_layer(db: Session, novel_id: int) -> str:
    rules = db.query(models.Rule).filter(models.Rule.novel_id == novel_id).all()
    if not rules:
        return ""
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

def build_index_layer(db: Session, novel_id: int, exclude_chapter_number: int | None = None) -> str:
    chapters = (
        db.query(models.Chapter)
        .filter(models.Chapter.novel_id == novel_id, models.Chapter.kind == "chapter", models.Chapter.summary != "")
        .order_by(models.Chapter.number)
        .all()
    )
    chapters = [c for c in chapters if c.number != exclude_chapter_number]
    if not chapters:
        return ""
    lines = ["ROMAN FİHRİSTİ (yazılmış bölümlerin özetleri, sırayla):"]
    for c in chapters:
        title_part = f" - {c.title}" if c.title else ""
        lines.append(f"Bölüm {c.number}{title_part}: {c.summary}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# DİNAMİK KATMAN: Seçilen karakter/mekan/olay/nesne/ipucu kayıtları
# + bu varlıkların geçtiği en alakalı geçmiş paragraflar.
# ---------------------------------------------------------------------------

def build_dynamic_layer(db: Session, novel_id: int, selected_entities: list, max_paragraphs_per_entity: int = 3) -> str:
    if not selected_entities:
        return ""

    blocks = ["İLGİLİ GEÇMİŞ BİLGİLER:"]
    for ref in selected_entities:
        model = ENTITY_MODELS.get(ref.entity_type)
        if model is None:
            continue
        record = db.query(model).filter(model.id == ref.entity_id, model.novel_id == novel_id).first()
        if record is None:
            continue

        label = ENTITY_LABELS_TR.get(ref.entity_type, ref.entity_type.upper())
        blocks.append(f"\n[{label}] {record.name} (id: {record.id}, tip: {ref.entity_type})")
        if record.description:
            blocks.append(f"Özet: {record.description}")
        if getattr(record, "notes", ""):
            blocks.append(f"Notlar: {record.notes}")

        progressions = (
            db.query(models.Progression)
            .filter(
                models.Progression.entity_type == ref.entity_type,
                models.Progression.entity_id == ref.entity_id,
            )
            .all()
        )
        if progressions:
            progressions.sort(key=lambda p: (p.chapter_number is None, p.chapter_number or 0, p.id))
            blocks.append("Zaman içindeki gelişimi (kronolojik sırayla, EN GÜNCEL EN ALTTA):")
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

def build_style_layer(db: Session, novel_id: int, max_samples: int = 5) -> str:
    samples = (
        db.query(models.Paragraph)
        .join(models.Chapter, models.Paragraph.chapter_id == models.Chapter.id)
        .filter(models.Paragraph.is_style_sample == True, models.Chapter.novel_id == novel_id)  # noqa: E712
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


def build_context(db: Session, novel_id: int, selected_entities: list, chapter_number: int | None = None) -> str:
    """chapter_number verilirse (o an üzerinde çalışılan bölüm), fihrist
    katmanında o bölüm dışlanır - bir bölümün kendi özetini kendi context'i
    olarak görmesi anlamsız, gerçek metin zaten mevcut_text/dynamic layer'da."""
    fixed = build_fixed_layer(db, novel_id)
    index = build_index_layer(db, novel_id, exclude_chapter_number=chapter_number)
    style = build_style_layer(db, novel_id)
    dynamic = build_dynamic_layer(db, novel_id, selected_entities)
    return "\n\n".join(part for part in [fixed, index, style, dynamic] if part)


# ---------------------------------------------------------------------------
# BÖLÜM ÖZETİ ÜRETİMİ: fihrist katmanının veri kaynağı. Üretilen özet burada
# kaydedilmez, sadece taslak olarak döner - kaydetme kararı kullanıcıya ait
# (bkz. routers/chapters.py generate-summary + mevcut PUT /chapters/{id}).
# ---------------------------------------------------------------------------

CHAPTER_SUMMARY_SYSTEM_PROMPT = """Sen bir roman editörüsün. Sana bir bölümün
tüm paragrafları verilecek. Görevin bu bölümü 3-5 cümlelik, olay örgüsünü
net şekilde anlatan bir ÖZET yazmak. Yorum katma, sadece ne olduğunu anlat.
Bu özet başka bölümler yazılırken bağlam olarak kullanılacağı için isim ve
olayları açık ve net yaz. Yanıtını SADECE düz metin olarak ver, başlık,
tırnak ya da markdown ekleme."""


def summarize_chapter(db: Session, chapter: "models.Chapter") -> str:
    text = "\n".join(f"[Paragraf {p.number}] {p.text}" for p in chapter.paragraphs)
    title_part = f" - {chapter.title}" if chapter.title else ""
    user_message = f"BÖLÜM {chapter.number}{title_part}:\n{text}"

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

Kurallar:
- Zaten kayıtlı listede olan bir isim TEKRAR ÖNERİLMESİN.
- entity_type sadece şunlardan biri olabilir: character, place, event,
  object, foreshadowing, term.
- Her öneri için kısa (1-2 cümlelik), SADECE bu bölümdeki bilgiye dayanan
  bir description yaz - yorum katma, tahmin etme, roman dışı bilgi ekleme.
- Emin olmadığın, sıradan bir kelime ya da genel isim olabilecek adayları
  ÖNERME (Türkçede her cümle başı da büyük harfle başladığından yanlış
  pozitif riski yüksektir - şüpheliyse önerme).
- Önemsiz, tek seferlik geçen, hikâye için gereksiz varlıkları atla.

Yanıtını SADECE aşağıdaki JSON formatında ver:
{
  "suggestions": [
    {"entity_type": "character", "name": "...", "description": "..."}
  ]
}
Yeni bir şey bulamazsan suggestions boş liste olsun."""


def suggest_entities_for_chapter(db: Session, chapter: "models.Chapter") -> list[dict]:
    existing_lines = []
    for entity_type, model in ENTITY_MODELS.items():
        label = ENTITY_LABELS_TR.get(entity_type, entity_type)
        for record in db.query(model).filter(model.novel_id == chapter.novel_id).all():
            existing_lines.append(f"{label}: {record.name}")

    chapter_text = "\n".join(f"[Paragraf {p.number}] {p.text}" for p in chapter.paragraphs)
    title_part = f" - {chapter.title}" if chapter.title else ""
    user_message = (
        "ZATEN KAYITLI OLANLAR:\n"
        + ("\n".join(existing_lines) if existing_lines else "(henüz hiç kayıt yok)")
        + f"\n\nBÖLÜM {chapter.number}{title_part} METNİ:\n{chapter_text}"
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

    existing_names_lower = {line.split(": ", 1)[1].lower() for line in existing_lines if ": " in line}
    filtered = []
    for s in data.get("suggestions", []):
        if not isinstance(s, dict):
            continue
        if s.get("entity_type") not in ENTITY_MODELS:
            continue
        name = (s.get("name") or "").strip()
        if not name or name.lower() in existing_names_lower:
            continue
        filtered.append({"entity_type": s["entity_type"], "name": name, "description": s.get("description", "")})
    return filtered


# ---------------------------------------------------------------------------
# SOHBET MODU: /ai/assist'in aksine tek seferlik "talimat -> yapılandırılmış
# JSON sonuç" değil, kullanıcıyla ileri-geri mesajlaşan bir yazı arkadaşı.
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

ELİNDE İKİ ARAÇ VAR: create_chapter (yeni bölüm açar) ve write_paragraph
(bir bölümde paragraf yazar/GÜNCELLER - var olan paragraf numarası
verirsen üzerine yazılır, eski hali otomatik geçmişe kaydedilir, kaybolmaz).
Kullanıcı "şu bölümü yaz", "yeni bölüm aç", "şu paragrafı değiştir/
güncelle" gibi somut bir istekte bulunduğunda bu araçları DOĞRUDAN kullan -
"yazayım mı?" diye sormana gerek yok, iste ve yaz. Ama kullanıcı sadece
fikir soruyorsa ya da sohbet ediyorsa araç çağırma, normal cevap ver.

Aşağıda sana romanın bağlamı (kurallar, fihrist özetleri, seçili
karakter/mekan/olay bilgileri, gelişim çizelgeleri) verilecek. Roman
gerçekleriyle (kim kim, ne olmuş, kurallar) ÇELİŞME - ama üslup, ton ve
öneri konusunda özgürsün, robotik bir onay makinesi gibi davranma.

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
]


def _execute_chat_tool(db: Session, novel_id: int, name: str, args: dict) -> dict:
    """Qwen'in çağırdığı aracı gerçekten çalıştırır (DB'ye yazar). Sonuç
    hem Qwen'e (tool sonucu olarak, bir sonraki adımı planlaması için) hem
    de kullanıcıya (actions_taken listesi, bkz. chat_with_qwen) gider."""
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

    return {"error": f"Bilinmeyen araç: {name}", "action_summary": None}


def chat_with_qwen(db: Session, novel_id: int, context: str, messages: list, max_tool_rounds: int = 5) -> tuple[str, list[str]]:
    """Sohbet modu artık sadece metin üretmiyor - Qwen bölüm oluşturma ve
    paragraf yazma/güncelleme araçlarını DOĞRUDAN çağırabiliyor. Döngü: Qwen
    bir araç çağırırsa çalıştırılır, sonucu tekrar Qwen'e verilir, Qwen ya
    başka bir araç çağırır ya da sohbete devam eder - max_tool_rounds bu
    döngünün sonsuza gitmemesi için bir güvenlik sınırı.

    Dönüş: (metin_cevabı, yapılan_işlemlerin_özet_listesi)"""
    system_content = CHAT_SYSTEM_PROMPT
    if context:
        system_content += f"\n\nROMANIN BAĞLAMI:\n{context}"

    chat_messages = [{"role": "system", "content": system_content}]
    for m in messages:
        role = getattr(m, "role", None) or m["role"]
        content = getattr(m, "content", None) or m["content"]
        chat_messages.append({"role": role, "content": content})

    client = get_client()
    actions_taken: list[str] = []

    for _ in range(max_tool_rounds):
        response = client.chat.completions.create(
            model=settings.qwen_model,
            messages=chat_messages,
            tools=CHAT_TOOLS,
        )
        msg = response.choices[0].message
        tool_calls = getattr(msg, "tool_calls", None)

        if not tool_calls:
            return (msg.content or "").strip(), actions_taken

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
            result = _execute_chat_tool(db, novel_id, tc.function.name, args)
            if result.get("action_summary"):
                actions_taken.append(result["action_summary"])
            chat_messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, ensure_ascii=False)})

    return "Bir dizi işlem yaptım ama son mesajımı tamamlayamadım - üstte hangi bölüm/paragrafların değiştiğini görebilirsin.", actions_taken


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


def full_scan(db: Session, novel_id: int, full_text_last_n: int = 3) -> dict:
    """Fihrist katmanı burada da merkezde: context penceresini aşmamak için
    sadece son full_text_last_n bölüm tam metniyle gönderilir, daha eski
    bölümler (özeti varsa) sadece özetiyle temsil edilir. Özeti olmayan eski
    bölümler yine de tam metinle gönderilir - hiçbir içerik sessizce
    atlanmaz, sadece 'önce özet yaz' teşvik edilmiş olur.

    kind='part'/'subtitle' girdilerinin paragrafı yok, sadece yapısal bir
    ayraç - bunlar içerik olarak taranmaz, sadece bir başlık satırı olarak
    metne eklenir (Qwen'in roman yapısını - kısımları - görmesi için)."""
    all_entries = db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id).order_by(models.Chapter.number).all()
    chapters = [c for c in all_entries if c.kind == "chapter"]
    if not chapters:
        return {"summary": "Henüz taranacak bölüm yok.", "issues": []}

    cutoff_number = chapters[max(0, len(chapters) - full_text_last_n)].number

    parts = [build_fixed_layer(db, novel_id)]
    for entry in all_entries:
        if entry.kind != "chapter":
            parts.append(f"\n### {entry.title or ('Ayraç ' + str(entry.number))} ###")
            continue
        header = f"\n=== BÖLÜM {entry.number}{' - ' + entry.title if entry.title else ''} ==="
        if entry.number < cutoff_number and entry.summary:
            parts.append(header + f"\n[ÖZET] {entry.summary}")
        else:
            parts.append(header)
            for p in entry.paragraphs:
                parts.append(f"[Paragraf {p.number}] {p.text}")
    manuscript_text = "\n".join(part for part in parts if part)

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
