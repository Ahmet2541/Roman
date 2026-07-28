"""Kullanıcının elinde zaten yazılmış bir metni (ör. Word'den kopyalanmış)
yükleyip otomatik olarak Bölüm/Paragraf yapısına dönüştüren ayrıştırıcı.

Not: Bu, karakter/mekan/olay isimlerini TAHMİN ETMEZ - sadece mevcut menülerde
zaten kayıtlı isimleri arar (bkz. mentions.py). Rastgele büyük harfle başlayan
kelimeleri "yeni karakter" sanan bir tahmin motoru kasıtlı olarak eklenmedi;
Türkçede her cümle başı da büyük harfle başladığından bu çok fazla yanlış
pozitif üretir. Yeni karakterleri sen menüden eklersin, sonra /chapters/
reindex-mentions ile geçmişe dönük tüm metin yeniden taranır."""

import re
from io import BytesIO

from docx import Document

CHAPTER_HEADING = re.compile(
    r"(?im)^\s*(?:bölüm|bolum|chapter|kısım|kisim|fasıl|fasil)\s*(\d+)?\s*[:\-–—]?\s*(.*)$"
)


def decode_text_bytes(raw: bytes) -> str:
    """.txt dosyalarını doğru karakter kodlamasıyla çözer.

    Word "Düz Metin" olarak kaydederken çoğu zaman UTF-8 değil, Windows-1254
    (Türkçe ANSI) ya da UTF-16 kullanır. Doğrudan UTF-8 varsaymak Türkçe
    karakterleri (ç, ğ, ı, ö, ş, ü) bozar. Burada sırayla dener, ilk hatasız
    çözülen kodlamayı kullanır.
    """
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        return raw.decode("utf-16")
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw.decode("utf-8-sig")
    for enc in ("utf-8", "cp1254", "utf-16"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _heading_level(style_name: str) -> int | None:
    """Bir Word paragraf stilinin başlık seviyesini döner (1, 2, ...) ya da
    başlık değilse None. Hem İngilizce ('Heading 1') hem Türkçe Word
    ('Başlık 1') stil adlarını tanır."""
    m = re.match(r"(?i)^(?:heading|başlık|baslik)\s*(\d+)$", style_name.strip())
    return int(m.group(1)) if m else None


def parse_docx(raw: bytes) -> list[dict]:
    """.docx dosyasını Word'ün 'Başlık 1' / 'Başlık 2' (Heading 1/2) stillerine
    göre böler: Başlık 1 -> yeni bölüm + başlık, Başlık 2 -> alt başlık
    (kendi paragrafı olarak eklenir), diğer her şey normal paragraf.

    Hiç Başlık 1 yoksa tüm belge tek bölüm (numara 1) olarak alınır."""
    doc = Document(BytesIO(raw))

    chapters: list[dict] = []
    current: dict | None = None
    auto_number = 1

    def ensure_chapter(title: str = "") -> dict:
        nonlocal current, auto_number
        number = auto_number
        m = CHAPTER_HEADING.match(title) if title else None
        if m:
            number = int(m.group(1)) if m.group(1) else auto_number
            title = (m.group(2) or "").strip()
        current = {"number": number, "title": title, "paragraphs": []}
        chapters.append(current)
        auto_number = number + 1
        return current

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        level = _heading_level(para.style.name if para.style else "")
        if level == 1:
            ensure_chapter(text)
            continue
        if current is None:
            ensure_chapter("")
        current["paragraphs"].append(text)

    return chapters


def parse_manuscript(raw_text: str) -> list[dict]:
    """Metni 'Bölüm N' başlıklarına göre böler. Hiç başlık yoksa tamamını
    tek bölüm olarak döner."""
    matches = list(CHAPTER_HEADING.finditer(raw_text))
    if not matches:
        return [{"number": 1, "title": "", "text": raw_text.strip()}]

    chapters = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(raw_text)
        number = int(m.group(1)) if m.group(1) else i + 1
        title = (m.group(2) or "").strip()
        text = raw_text[start:end].strip()
        if text:
            chapters.append({"number": number, "title": title, "text": text})
    return chapters


def split_paragraphs(chapter_text: str) -> list[str]:
    """Boş satırlarla ayrılmış paragrafları çıkarır."""
    return [p.strip() for p in re.split(r"\n\s*\n", chapter_text) if p.strip()]
