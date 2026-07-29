"""Gelişim çizelgesi (Progressions): bir varlığın (karakter/mekan/nesne/
olay/ipucu) zaman içinde DEĞİŞEN bilgisini kronolojik olarak tutar - ör.
'Bölüm 12'de yaralandı', 'Bölüm 18'den itibaren limanda çalışıyor'.

Ana menü kaydındaki description/notes statik kalır (roman boyunca geçerli
genel bilgi); progression'lar ise bu bilginin bölüm bölüm nasıl değiştiğini
tutar. Bir varlık AI isteğinde seçildiğinde, tüm progression'ları kronolojik
sırayla context'e otomatik eklenir (bkz. qwen_client.build_dynamic_layer)."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from .. import models, schemas
from ..entities import ENTITY_MODELS
from ..novel_context import get_novel_id

router = APIRouter(prefix="/progressions", tags=["Gelişim Çizelgesi"])


@router.get("/", response_model=List[schemas.ProgressionOut])
def list_progressions(
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    query = db.query(models.Progression).filter(models.Progression.novel_id == novel_id)
    if entity_type:
        query = query.filter(models.Progression.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(models.Progression.entity_id == entity_id)
    items = query.all()
    # Kronolojik sırala: chapter_number'ı olmayanlar (henüz bölüme
    # bağlanmamış notlar) en sona düşer.
    items.sort(key=lambda p: (p.chapter_number is None, p.chapter_number or 0, p.id))
    return items


@router.post("/", response_model=schemas.ProgressionOut, status_code=201)
def create_progression(
    payload: schemas.ProgressionCreate,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    if payload.entity_type not in ENTITY_MODELS:
        raise HTTPException(400, "Geçersiz entity_type")
    model = ENTITY_MODELS[payload.entity_type]
    if not db.query(model).filter(model.id == payload.entity_id, model.novel_id == novel_id).first():
        raise HTTPException(404, "İlgili kayıt bulunamadı")

    item = models.Progression(
        novel_id=novel_id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        chapter_number=payload.chapter_number,
        note=payload.note,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{progression_id}", status_code=204)
def delete_progression(
    progression_id: int,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    item = db.query(models.Progression).filter(models.Progression.id == progression_id, models.Progression.novel_id == novel_id).first()
    if not item:
        raise HTTPException(404, "Kayıt bulunamadı")
    db.delete(item)
    db.commit()
    return None
