"""Faksiyon üyelikleri: bir karakterin bir faksiyondaki rolü (bkz.
models.FactionMembership). Faction'ın kendisinin CRUD'u generic_crud
üzerinden menus.py'de (factions_router) hallediliyor - bu router SADECE
üyelik ilişkisini yönetir (relationships.py'nin faksiyon versiyonu gibi)."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from .. import models, schemas
from ..novel_context import get_universe_id

router = APIRouter(prefix="/faction-memberships", tags=["Faksiyon Üyelikleri"])


def _to_out(db: Session, m: models.FactionMembership) -> schemas.FactionMembershipOut:
    faction = db.query(models.Faction).filter(models.Faction.id == m.faction_id, models.Faction.universe_id == m.universe_id).first()
    char = db.query(models.Character).filter(models.Character.id == m.character_id, models.Character.universe_id == m.universe_id).first()
    return schemas.FactionMembershipOut(
        id=m.id, faction_id=m.faction_id, faction_name=faction.name if faction else "?",
        character_id=m.character_id, character_name=char.name if char else "?",
        role=m.role, notes=m.notes, created_at=m.created_at,
    )


@router.get("/", response_model=List[schemas.FactionMembershipOut])
def list_memberships(
    faction_id: int | None = None, character_id: int | None = None,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    universe_id: int = Depends(get_universe_id),
):
    query = db.query(models.FactionMembership).filter(models.FactionMembership.universe_id == universe_id)
    if faction_id is not None:
        query = query.filter(models.FactionMembership.faction_id == faction_id)
    if character_id is not None:
        query = query.filter(models.FactionMembership.character_id == character_id)
    return [_to_out(db, m) for m in query.all()]


@router.post("/", response_model=schemas.FactionMembershipOut, status_code=201)
def create_membership(
    payload: schemas.FactionMembershipCreate, db: Session = Depends(get_db),
    _user=Depends(get_current_user), universe_id: int = Depends(get_universe_id),
):
    if not db.query(models.Faction).filter(models.Faction.id == payload.faction_id, models.Faction.universe_id == universe_id).first():
        raise HTTPException(404, "Faksiyon bulunamadı")
    if not db.query(models.Character).filter(models.Character.id == payload.character_id, models.Character.universe_id == universe_id).first():
        raise HTTPException(404, "Karakter bulunamadı")
    existing = db.query(models.FactionMembership).filter(
        models.FactionMembership.faction_id == payload.faction_id,
        models.FactionMembership.character_id == payload.character_id,
    ).first()
    if existing:
        raise HTTPException(400, "Bu karakter zaten bu faksiyona üye")
    m = models.FactionMembership(
        universe_id=universe_id, faction_id=payload.faction_id, character_id=payload.character_id,
        role=payload.role, notes=payload.notes,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return _to_out(db, m)


@router.delete("/{membership_id}", status_code=204)
def delete_membership(
    membership_id: int, db: Session = Depends(get_db),
    _user=Depends(get_current_user), universe_id: int = Depends(get_universe_id),
):
    m = db.query(models.FactionMembership).filter(
        models.FactionMembership.id == membership_id, models.FactionMembership.universe_id == universe_id
    ).first()
    if not m:
        raise HTTPException(404, "Üyelik bulunamadı")
    db.delete(m)
    db.commit()
    return None
