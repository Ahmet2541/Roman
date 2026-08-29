"""Gelişim çizelgesi (Progressions): bir varlığın (karakter/mekan/nesne/
olay/ipucu/faksiyon) zaman içinde DEĞİŞEN bilgisini kronolojik olarak tutar
- ör. 'Bölüm 12'de yaralandı', 'Bölüm 18'den itibaren limanda çalışıyor'.

Ana menü kaydındaki description/notes statik kalır (evren boyunca geçerli
genel bilgi); progression'lar ise bu bilginin bölüm bölüm nasıl değiştiğini
tutar. EVREN düzeyinde tutulur - bir karakterin gelişimi kitap sınırını
aşabilir. Her not, oluşturulduğu anda aktif olan kitaba (source_novel_id)
etiketlenir - sadece 'Kitap 2, Bölüm 12' gibi göstermek için, filtreleme
universe_id üzerinden yapılır."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from .. import models, schemas
from ..entities import ENTITY_MODELS
from ..novel_context import get_universe_id, get_novel_id

router = APIRouter(prefix="/progressions", tags=["Gelişim Çizelgesi"])


def _to_out(db: Session, item: models.Progression) -> schemas.ProgressionOut:
    novel = db.query(models.Novel).filter(models.Novel.id == item.source_novel_id).first() if item.source_novel_id else None
    return schemas.ProgressionOut(
        id=item.id, entity_type=item.entity_type, entity_id=item.entity_id,
        chapter_number=item.chapter_number, note=item.note, created_at=item.created_at,
        # story_date BURADA UNUTULMUŞTU: kayıt doğru yapılıyordu ama yanıt
        # onu taşımadığı için arayüzde hep boş görünüyor, sıralama ve
        # süzme çalışmıyordu.
        story_date=item.story_date or "",
        source_novel_id=item.source_novel_id, source_novel_name=novel.name if novel else None,
    )


@router.get("/", response_model=List[schemas.ProgressionOut])
def list_progressions(
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    universe_id: int = Depends(get_universe_id),
):
    query = db.query(models.Progression).filter(models.Progression.universe_id == universe_id)
    if entity_type:
        query = query.filter(models.Progression.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(models.Progression.entity_id == entity_id)
    items = query.all()
    # KRONOLOJİK SIRA: ölçü TARİHTİR. Bölüm numarası hikâye sırası değil -
    # geriye giden bir romanda Bölüm 21, Bölüm 2'den önce geçebilir.
    # Tarihi olmayanlar sona düşer (zamansız notlar).
    from .. import story_time as _st

    def _sira(p):
        z = _st.parse_tarih(getattr(p, "story_date", "") or "")
        return (0, z, p.id) if z is not None else (1, 0, p.id)

    items.sort(key=_sira)

    return [_to_out(db, p) for p in items]


@router.post("/", response_model=schemas.ProgressionOut, status_code=201)
def create_progression(
    payload: schemas.ProgressionCreate,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    universe_id: int = Depends(get_universe_id),
    novel_id: int = Depends(get_novel_id),
):
    if payload.entity_type not in ENTITY_MODELS:
        raise HTTPException(400, "Geçersiz entity_type")
    model = ENTITY_MODELS[payload.entity_type]
    if not db.query(model).filter(model.id == payload.entity_id, model.universe_id == universe_id).first():
        raise HTTPException(404, "İlgili kayıt bulunamadı")

    item = models.Progression(
        universe_id=universe_id,
        source_novel_id=novel_id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        chapter_number=payload.chapter_number,
        # HİKÂYE TARİHİ: kronolojik süzmenin ölçüsü. Bölüm numarasından
        # önce gelir - geriye giden bir romanda numara yanıltır.
        story_date=(payload.story_date or "").strip(),
        note=payload.note,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_out(db, item)


@router.put("/{progression_id}", response_model=schemas.ProgressionOut)
def update_progression(
    progression_id: int, payload: schemas.ProgressionUpdate,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    universe_id: int = Depends(get_universe_id),
):
    """Var olan bir gelişim notunu düzenler.

    Bu uç YOKTU: bir notun tarihini ya da metnini düzeltmek için silip
    yeniden yazmak gerekiyordu. Tarih yanlış girildiğinde bütün kronoloji
    kayıyor, düzeltmesi de zahmetli oluyordu.
    """
    item = (db.query(models.Progression)
            .filter(models.Progression.id == progression_id,
                    models.Progression.universe_id == universe_id).first())
    if not item:
        raise HTTPException(404, "Gelişim notu bulunamadı")
    if payload.note is not None:
        yeni = payload.note.strip()
        if not yeni:
            raise HTTPException(400, "Not boş olamaz")
        item.note = yeni
    if payload.story_date is not None:
        item.story_date = payload.story_date.strip()
    if payload.chapter_number is not None:
        item.chapter_number = payload.chapter_number
    db.commit()
    db.refresh(item)
    return _to_out(db, item)


@router.delete("/{progression_id}", status_code=204)
def delete_progression(
    progression_id: int,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    universe_id: int = Depends(get_universe_id),
):
    item = db.query(models.Progression).filter(models.Progression.id == progression_id, models.Progression.universe_id == universe_id).first()
    if not item:
        raise HTTPException(404, "Kayıt bulunamadı")
    db.delete(item)
    db.commit()
    return None
