"""Kullanıcının elinde zaten yazılmış bir metni (ör. Word'den kopyalanmış)
yükleyip otomatik olarak Bölüm/Paragraf yapısına dönüştüren ayrıştırıcı.

Not: Bu, karakter/mekan/olay isimlerini TAHMİN ETMEZ - sadece mevcut menülerde
zaten kayıtlı isimleri arar (bkz. mentions.py). Rastgele büyük harfle başlayan
kelimeleri "yeni karakter" sanan bir tahmin motoru kasıtlı olarak eklenmedi;
Türkçede her cümle başı da büyük harfle başladığından bu çok fazla yanlış
pozitif üretir. Yeni karakterleri sen menüden eklersin, sonra /chapters/
reindex-mentions ile geçmişe dönük tüm metin yeniden taranır."""

import re

CHAPTER_HEADING = re.compile(
    r"(?im)^\s*(?:bölüm|bolum|chapter|kısım|kisim|fasıl|fasil)\s*(\d+)?\s*[:\-–—]?\s*(.*)$"
)


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
