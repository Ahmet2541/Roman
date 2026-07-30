from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from .. import models, schemas
from ..novel_context import get_novel_id

router = APIRouter(prefix="/relationships", tags=["İlişkiler"])


def _to_out(db: Session, rel: models.CharacterRelationship) -> schemas.RelationshipOut:
    char_a = db.query(models.Character).filter(models.Character.id == rel.character_a_id, models.Character.novel_id == rel.novel_id).first()
    char_b = db.query(models.Character).filter(models.Character.id == rel.character_b_id, models.Character.novel_id == rel.novel_id).first()
    return schemas.RelationshipOut(
        id=rel.id,
        character_a_id=rel.character_a_id, character_a_name=char_a.name if char_a else "?",
        character_b_id=rel.character_b_id, character_b_name=char_b.name if char_b else "?",
        label=rel.label, notes=rel.notes, created_at=rel.created_at,
    )


@router.get("/", response_model=List[schemas.RelationshipOut])
def list_relationships(db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    rels = db.query(models.CharacterRelationship).filter(models.CharacterRelationship.novel_id == novel_id).all()
    return [_to_out(db, r) for r in rels]


@router.post("/", response_model=schemas.RelationshipOut, status_code=201)
def create_relationship(payload: schemas.RelationshipCreate, db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    if payload.character_a_id == payload.character_b_id:
        raise HTTPException(400, "Bir karakter kendisiyle ilişkilendirilemez")
    for cid in (payload.character_a_id, payload.character_b_id):
        if not db.query(models.Character).filter(models.Character.id == cid, models.Character.novel_id == novel_id).first():
            raise HTTPException(404, f"Karakter bulunamadı: {cid}")

    rel = models.CharacterRelationship(
        novel_id=novel_id,
        character_a_id=payload.character_a_id, character_b_id=payload.character_b_id,
        label=payload.label, notes=payload.notes,
    )
    db.add(rel)
    db.commit()
    db.refresh(rel)
    return _to_out(db, rel)


@router.delete("/{relationship_id}", status_code=204)
def delete_relationship(relationship_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    rel = db.query(models.CharacterRelationship).filter(models.CharacterRelationship.id == relationship_id, models.CharacterRelationship.novel_id == novel_id).first()
    if not rel:
        raise HTTPException(404, "İlişki bulunamadı")
    db.delete(rel)
    db.commit()
    return None
