import re

from sqlalchemy.orm import Session

from . import models
from .entities import ENTITY_MODELS
from .novel_context import get_universe_id_for_novel


def turkish_lower(s: str) -> str:
    """Python'un varsayılan (locale'siz) str.lower()'ı Türkçe'ye özgü İ/I
    harflerini YANLIŞ çevirir: 'I'.lower() -> 'i' (Türkçe'de 'ı' olmalı),
    'İ'.lower() -> 'i' + birleşik nokta (tek bir 'i' değil). Bu yüzden
    "YAŞLI TEKNİSYEN" gibi tamamen büyük harfli bir metin, kayıtlı
    "Yaşlı Teknisyen" ismiyle .lower() sonrası EŞLEŞMİYORDU - mention
    tespiti sessizce başarısız oluyordu. Türkçe'ye özgü harfleri ÖNCE elle
    doğru karşılıklarına çevirip SONRA genel .lower()'ı uyguluyoruz -
    ş/ğ/ü/ö/ç gibi diğer Türkçe harfler zaten .lower() ile doğru çalışıyor,
    sadece I/İ çifti özel muamele gerektiriyor."""
    return s.replace("İ", "i").replace("I", "ı").lower()


def detect_and_save_mentions(db: Session, paragraph: models.Paragraph):
    """Paragraf metninde geçen menü isimlerini (VE alias'larını) basit
    kelime eşleştirmesiyle bulur ve Mention tablosuna işler. Var olan eski
    eşleşmeleri temizleyip yeniden oluşturur (paragraf düzenlendiğinde eski
    isim silinmiş olabilir).

    ÖNEMLİ: eşleşme SADECE bu paragrafın ait olduğu EVRENdeki kayıtlara
    bakılarak yapılır (novel_id değil, universe_id - karakterler artık kitap
    değil evren düzeyinde paylaşılıyor) - yoksa "Ahmet" adlı bir karakter
    başka bir evrende de varsa, o evrenin verisi bu paragrafa yanlışlıkla
    bağlanabilirdi.

    ALIAS DESTEĞİ: bir karakter/mekan "Kral", "Majesteleri" gibi unvanlarla
    da anılıyorsa, bunlar Character.aliases / Place.aliases içinde
    tutulur (bkz. models.py) - metinde ismin KENDİSİ ya da alias'larından
    HERHANGİ biri geçerse mention kaydedilir, entity_name olarak yine asıl
    isim (record.name) yazılır."""

    db.query(models.Mention).filter(models.Mention.paragraph_id == paragraph.id).delete()

    universe_id = get_universe_id_for_novel(db, paragraph.chapter.novel_id)
    if universe_id is None:
        db.commit()
        return  # evrene henüz bağlanmamış (migration bekleniyor) - sessizce atla

    text_lower = turkish_lower(paragraph.text)

    for entity_type, model in ENTITY_MODELS.items():
        records = db.query(model).filter(model.universe_id == universe_id).all()
        for record in records:
            names_to_check = [record.name] + list(getattr(record, "aliases", None) or [])
            matched = False
            for name in names_to_check:
                if not name or not name.strip():
                    continue
                # Kelime sınırlarına göre ara (örn. "Ahmet" tek başına, "Ahmete" de yakalar)
                pattern = r"\b" + re.escape(turkish_lower(name)) + r"\b"
                if re.search(pattern, text_lower):
                    matched = True
                    break
            if matched:
                db.add(models.Mention(
                    paragraph_id=paragraph.id,
                    entity_type=entity_type,
                    entity_id=record.id,
                    entity_name=record.name,
                ))
    db.commit()
