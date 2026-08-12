"""BİLGİ / İFŞA HARİTASI uçları.

Duruşma-gerilim romanında gerilimi olay değil, "kim ne biliyor" farkı
üretir. Bu modül her önemli bilgi için üç ekseni ayrı tutar: karakterler,
OKUR ve (türetilmiş olarak) dramatik ironi durumu.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from .. import models, schemas
from ..novel_context import get_universe_id

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


def _to_out(db: Session, f: models.KnowledgeFact) -> schemas.KnowledgeFactOut:
    ids = f.known_by_characters or []
    isimler = []
    if ids:
        for c in db.query(models.Character).filter(models.Character.id.in_(ids)).all():
            isimler.append(c.name)
    # Dramatik ironi: OKUR biliyor ama hiçbir karakter bilmiyor
    ironi = (f.reader_state == "evet") and not ids
    return schemas.KnowledgeFactOut(
        id=f.id, information=f.information, notes=f.notes or "",
        introduced_chapter=f.introduced_chapter, reveal_chapter=f.reveal_chapter,
        known_by_characters=ids, character_names=isimler,
        reader_state=f.reader_state or "hayir", reveal_method=f.reveal_method or "",
        planned_payoff=f.planned_payoff or "", dramatic_irony=ironi,
    )


@router.get("/", response_model=List[schemas.KnowledgeFactOut])
def list_facts(db: Session = Depends(get_db), _user=Depends(get_current_user),
               universe_id: int = Depends(get_universe_id)):
    """Bilgi haritası - ifşa sırasına göre (planlanmamışlar sona)."""
    facts = db.query(models.KnowledgeFact).filter(
        models.KnowledgeFact.universe_id == universe_id).all()
    out = [_to_out(db, f) for f in facts]
    return sorted(out, key=lambda x: (x.reveal_chapter is None, x.reveal_chapter or 0, x.information.lower()))


@router.post("/", response_model=schemas.KnowledgeFactOut, status_code=201)
def create_fact(payload: schemas.KnowledgeFactCreate, db: Session = Depends(get_db),
                _user=Depends(get_current_user), universe_id: int = Depends(get_universe_id)):
    f = models.KnowledgeFact(universe_id=universe_id, **payload.model_dump())
    db.add(f)
    db.commit()
    db.refresh(f)
    return _to_out(db, f)


@router.put("/{fact_id}", response_model=schemas.KnowledgeFactOut)
def update_fact(fact_id: int, payload: schemas.KnowledgeFactUpdate, db: Session = Depends(get_db),
                _user=Depends(get_current_user), universe_id: int = Depends(get_universe_id)):
    f = db.query(models.KnowledgeFact).filter(
        models.KnowledgeFact.id == fact_id,
        models.KnowledgeFact.universe_id == universe_id).first()
    if not f:
        raise HTTPException(404, "Bilgi kaydı bulunamadı")
    for alan, deger in payload.model_dump(exclude_unset=True).items():
        setattr(f, alan, deger)
    db.commit()
    db.refresh(f)
    return _to_out(db, f)


@router.delete("/{fact_id}", status_code=204)
def delete_fact(fact_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user),
                universe_id: int = Depends(get_universe_id)):
    f = db.query(models.KnowledgeFact).filter(
        models.KnowledgeFact.id == fact_id,
        models.KnowledgeFact.universe_id == universe_id).first()
    if not f:
        raise HTTPException(404, "Bilgi kaydı bulunamadı")
    db.delete(f)
    db.commit()
