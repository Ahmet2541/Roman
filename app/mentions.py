import re

from sqlalchemy.orm import Session

from . import models
from .entities import ENTITY_MODELS


def detect_and_save_mentions(db: Session, paragraph: models.Paragraph):
    """Paragraf metninde geçen menü isimlerini basit kelime eşleştirmesiyle
    bulur ve Mention tablosuna işler. Var olan eski eşleşmeleri temizleyip
    yeniden oluşturur (paragraf düzenlendiğinde eski isim silinmiş olabilir).

    ÖNEMLİ: eşleşme SADECE bu paragrafın ait olduğu romandaki kayıtlara
    bakılarak yapılır - yoksa "Ahmet" adlı bir karakter başka bir romanda
    da varsa, o romanın verisi bu paragrafa yanlışlıkla bağlanabilirdi."""

    db.query(models.Mention).filter(models.Mention.paragraph_id == paragraph.id).delete()

    novel_id = paragraph.chapter.novel_id
    text_lower = paragraph.text.lower()

    for entity_type, model in ENTITY_MODELS.items():
        records = db.query(model).filter(model.novel_id == novel_id).all()
        for record in records:
            # Kelime sınırlarına göre ara (örn. "Ahmet" tek başına, "Ahmete" de yakalar)
            pattern = r"\b" + re.escape(record.name.lower()) + r"\b"
            if re.search(pattern, text_lower):
                db.add(models.Mention(
                    paragraph_id=paragraph.id,
                    entity_type=entity_type,
                    entity_id=record.id,
                    entity_name=record.name,
                ))
    db.commit()
