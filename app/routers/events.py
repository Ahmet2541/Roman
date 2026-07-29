from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from .. import models, schemas
from ..novel_context import get_novel_id

router = APIRouter(prefix="/events", tags=["Olaylar"])


def _ids_to_str(ids: list) -> str:
    return ",".join(str(i) for i in ids) if ids else ""


def _str_to_ids(s: str) -> list:
    return [int(x) for x in s.split(",") if x.strip()] if s else []


def _to_out(db: Session, event: models.Event) -> schemas.EventOut:
    place = db.query(models.Place).filter(models.Place.id == event.place_id).first() if event.place_id else None
    char_ids = _str_to_ids(event.character_ids)
    chars = db.query(models.Character).filter(models.Character.id.in_(char_ids)).all() if char_ids else []
    return schemas.EventOut(
        id=event.id, name=event.name, description=event.description, notes=event.notes,
        created_at=event.created_at, updated_at=event.updated_at,
        place_id=event.place_id, place_name=place.name if place else None,
        story_date=event.story_date, story_order=event.story_order,
        character_ids=char_ids, character_names=[c.name for c in chars],
    )


@router.get("/", response_model=List[schemas.EventOut])
def list_events(db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    events = db.query(models.Event).filter(models.Event.novel_id == novel_id).all()
    events_out = [_to_out(db, e) for e in events]
    # story_order olanlar önce (sıralı), sonra isme göre
    return sorted(events_out, key=lambda e: (e.story_order is None, e.story_order or 0, e.name.lower()))


@router.post("/", response_model=schemas.EventOut, status_code=201)
def create_event(payload: schemas.EventCreate, db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    event = models.Event(
        novel_id=novel_id,
        name=payload.name, description=payload.description, notes=payload.notes,
        place_id=payload.place_id, story_date=payload.story_date, story_order=payload.story_order,
        character_ids=_ids_to_str(payload.character_ids),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return _to_out(db, event)


@router.get("/conflicts", response_model=List[schemas.EventConflict])
def check_conflicts(db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    """Aynı hikaye içi zamanda (story_order varsa o, yoksa story_date),
    aynı karakterin farklı mekanlarda göründüğü olay çiftlerini bulur."""
    events = db.query(models.Event).filter(models.Event.novel_id == novel_id).all()
    by_key = {}
    for e in events:
        key = e.story_order if e.story_order is not None else (e.story_date or None)
        if key is None:
            continue
        by_key.setdefault(key, []).append(e)

    conflicts = []
    for key, group in by_key.items():
        if len(group) < 2:
            continue
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                e1, e2 = group[i], group[j]
                if e1.place_id and e2.place_id and e1.place_id != e2.place_id:
                    shared_ids = set(_str_to_ids(e1.character_ids)) & set(_str_to_ids(e2.character_ids))
                    if shared_ids:
                        shared_chars = db.query(models.Character).filter(models.Character.id.in_(shared_ids)).all()
                        conflicts.append(schemas.EventConflict(
                            story_key=str(key), event_a=e1.name, event_b=e2.name,
                            shared_characters=[c.name for c in shared_chars],
                        ))
    return conflicts


@router.get("/{event_id}", response_model=schemas.EventOut)
def get_event(event_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    event = db.query(models.Event).filter(models.Event.id == event_id, models.Event.novel_id == novel_id).first()
    if not event:
        raise HTTPException(404, "Olay bulunamadı")
    return _to_out(db, event)


@router.put("/{event_id}", response_model=schemas.EventOut)
def update_event(event_id: int, payload: schemas.EventUpdate, db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    event = db.query(models.Event).filter(models.Event.id == event_id, models.Event.novel_id == novel_id).first()
    if not event:
        raise HTTPException(404, "Olay bulunamadı")
    data = payload.model_dump(exclude_unset=True)
    if "character_ids" in data:
        event.character_ids = _ids_to_str(data.pop("character_ids"))
    for field, value in data.items():
        setattr(event, field, value)
    db.commit()
    db.refresh(event)
    return _to_out(db, event)


@router.delete("/{event_id}", status_code=204)
def delete_event(event_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    event = db.query(models.Event).filter(models.Event.id == event_id, models.Event.novel_id == novel_id).first()
    if not event:
        raise HTTPException(404, "Olay bulunamadı")
    db.delete(event)
    db.commit()
    return None
