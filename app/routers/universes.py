"""Evren (seri) yönetimi. Bir Universe, aynı karakter/mekan/kural/...
havuzunu paylaşan bir ya da daha fazla Roman'ı (kitabı) gruplar - bkz.
models.py Universe/Novel yorumu."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from .. import models

router = APIRouter(prefix="/universes", tags=["Evrenler"])


class UniverseCreate(BaseModel):
    name: str


class UniverseOut(BaseModel):
    id: int
    name: str
    novel_count: int
    created_at: str

    class Config:
        from_attributes = True


def _to_out(db: Session, universe: models.Universe) -> UniverseOut:
    count = db.query(models.Novel).filter(models.Novel.universe_id == universe.id).count()
    return UniverseOut(id=universe.id, name=universe.name, novel_count=count, created_at=universe.created_at.isoformat())


@router.get("/", response_model=List[UniverseOut])
def list_universes(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    universes = db.query(models.Universe).order_by(models.Universe.id).all()
    return [_to_out(db, u) for u in universes]


@router.post("/", response_model=UniverseOut, status_code=201)
def create_universe(payload: UniverseCreate, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Evren adı boş olamaz")
    universe = models.Universe(name=name)
    db.add(universe)
    db.commit()
    db.refresh(universe)
    return _to_out(db, universe)


@router.put("/{universe_id}", response_model=UniverseOut)
def rename_universe(universe_id: int, payload: UniverseCreate, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    universe = db.query(models.Universe).filter(models.Universe.id == universe_id).first()
    if not universe:
        raise HTTPException(404, "Evren bulunamadı")
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Evren adı boş olamaz")
    universe.name = name
    db.commit()
    db.refresh(universe)
    return _to_out(db, universe)


@router.delete("/{universe_id}", status_code=204)
def delete_universe(universe_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    """NÜKLEER SEÇENEK: evrendeki TÜM kitapları (bölüm/paragraf dahil) VE
    TÜM paylaşılan verisini (karakter/mekan/kural/ilişki/gelişim/olay/
    faksiyon) geri alınamaz şekilde siler. Sadece TEK bir kitabı silmek
    için bunun yerine DELETE /novels/{id} kullan - o, evren verisine
    dokunmaz."""
    universe = db.query(models.Universe).filter(models.Universe.id == universe_id).first()
    if not universe:
        raise HTTPException(404, "Evren bulunamadı")

    novel_ids = [n.id for n in db.query(models.Novel.id).filter(models.Novel.universe_id == universe_id)]
    for novel_id in novel_ids:
        chapter_ids = [c.id for c in db.query(models.Chapter.id).filter(models.Chapter.novel_id == novel_id)]
        if chapter_ids:
            paragraph_ids = [p.id for p in db.query(models.Paragraph.id).filter(models.Paragraph.chapter_id.in_(chapter_ids))]
            if paragraph_ids:
                db.query(models.ParagraphVersion).filter(models.ParagraphVersion.paragraph_id.in_(paragraph_ids)).delete(synchronize_session=False)
                db.query(models.Mention).filter(models.Mention.paragraph_id.in_(paragraph_ids)).delete(synchronize_session=False)
            db.query(models.Paragraph).filter(models.Paragraph.chapter_id.in_(chapter_ids)).delete(synchronize_session=False)
        db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id).delete(synchronize_session=False)

    db.query(models.FactionMembership).filter(models.FactionMembership.universe_id == universe_id).delete(synchronize_session=False)
    db.query(models.Faction).filter(models.Faction.universe_id == universe_id).delete(synchronize_session=False)
    db.query(models.Progression).filter(models.Progression.universe_id == universe_id).delete(synchronize_session=False)
    db.query(models.Event).filter(models.Event.universe_id == universe_id).delete(synchronize_session=False)
    db.query(models.CharacterRelationship).filter(models.CharacterRelationship.universe_id == universe_id).delete(synchronize_session=False)
    db.query(models.Character).filter(models.Character.universe_id == universe_id).delete(synchronize_session=False)
    db.query(models.Place).filter(models.Place.universe_id == universe_id).delete(synchronize_session=False)
    db.query(models.Object).filter(models.Object.universe_id == universe_id).delete(synchronize_session=False)
    db.query(models.Foreshadowing).filter(models.Foreshadowing.universe_id == universe_id).delete(synchronize_session=False)
    db.query(models.GlossaryTerm).filter(models.GlossaryTerm.universe_id == universe_id).delete(synchronize_session=False)
    db.query(models.Rule).filter(models.Rule.universe_id == universe_id).delete(synchronize_session=False)
    db.query(models.Novel).filter(models.Novel.universe_id == universe_id).delete(synchronize_session=False)
    db.delete(universe)
    db.commit()
    return None
