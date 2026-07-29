"""Roman yönetimi: birden fazla roman oluşturup aralarında geçiş
yapılabilir. Silme, o romana ait TÜM veriyi (karakter/mekan/bölüm/...)
geri alınamaz şekilde siler - admin.py'deki wipe mantığının aynısı, sadece
tek bir novel_id'ye scope edilmiş hali."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from .. import models

router = APIRouter(prefix="/novels", tags=["Romanlar"])


class NovelCreate(BaseModel):
    name: str


class NovelOut(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


@router.get("/", response_model=List[NovelOut])
def list_novels(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    return db.query(models.Novel).order_by(models.Novel.id).all()


@router.post("/", response_model=NovelOut, status_code=201)
def create_novel(payload: NovelCreate, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Roman adı boş olamaz")
    novel = models.Novel(name=name)
    db.add(novel)
    db.commit()
    db.refresh(novel)
    return novel


@router.put("/{novel_id}", response_model=NovelOut)
def rename_novel(novel_id: int, payload: NovelCreate, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    novel = db.query(models.Novel).filter(models.Novel.id == novel_id).first()
    if not novel:
        raise HTTPException(404, "Roman bulunamadı")
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Roman adı boş olamaz")
    novel.name = name
    db.commit()
    db.refresh(novel)
    return novel


@router.delete("/{novel_id}", status_code=204)
def delete_novel(novel_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    novel = db.query(models.Novel).filter(models.Novel.id == novel_id).first()
    if not novel:
        raise HTTPException(404, "Roman bulunamadı")

    chapter_ids = [c.id for c in db.query(models.Chapter.id).filter(models.Chapter.novel_id == novel_id)]
    if chapter_ids:
        paragraph_ids = [p.id for p in db.query(models.Paragraph.id).filter(models.Paragraph.chapter_id.in_(chapter_ids))]
        if paragraph_ids:
            db.query(models.ParagraphVersion).filter(models.ParagraphVersion.paragraph_id.in_(paragraph_ids)).delete(synchronize_session=False)
            db.query(models.Mention).filter(models.Mention.paragraph_id.in_(paragraph_ids)).delete(synchronize_session=False)
        db.query(models.Paragraph).filter(models.Paragraph.chapter_id.in_(chapter_ids)).delete(synchronize_session=False)
    db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id).delete(synchronize_session=False)
    db.query(models.Progression).filter(models.Progression.novel_id == novel_id).delete(synchronize_session=False)
    db.query(models.Event).filter(models.Event.novel_id == novel_id).delete(synchronize_session=False)
    db.query(models.CharacterRelationship).filter(models.CharacterRelationship.novel_id == novel_id).delete(synchronize_session=False)
    db.query(models.Character).filter(models.Character.novel_id == novel_id).delete(synchronize_session=False)
    db.query(models.Place).filter(models.Place.novel_id == novel_id).delete(synchronize_session=False)
    db.query(models.Object).filter(models.Object.novel_id == novel_id).delete(synchronize_session=False)
    db.query(models.Foreshadowing).filter(models.Foreshadowing.novel_id == novel_id).delete(synchronize_session=False)
    db.query(models.GlossaryTerm).filter(models.GlossaryTerm.novel_id == novel_id).delete(synchronize_session=False)
    db.query(models.Rule).filter(models.Rule.novel_id == novel_id).delete(synchronize_session=False)
    db.delete(novel)
    db.commit()
    return None
