"""Roman (kitap) yönetimi. Her Roman bir Universe'e (evrene) bağlıdır -
aynı evrende birden fazla kitap (bir serinin ciltleri) olabilir, hepsi
aynı karakter/mekan/kural/... havuzunu paylaşır (bkz. models.py).

ÖNEMLİ DAVRANIŞ DEĞİŞİKLİĞİ: Bir Roman'ı (kitabı) silmek artık SADECE o
kitabın kendi bölüm/paragraf/versiyon/mention verisini siler - evren
düzeyindeki karakterleri/mekanları/kuralları/ilişkileri/gelişim
çizelgesini/olayları SİLMEZ, çünkü bunlar serideki BAŞKA kitaplar
tarafından da kullanılıyor olabilir. Evrenin TAMAMINI (tüm kitapları +
tüm paylaşılan verisiyle) silmek istiyorsan bkz. DELETE /universes/{id}."""
from typing import List, Optional

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from .. import manuscript, models

router = APIRouter(prefix="/novels", tags=["Romanlar"])


class NovelCreate(BaseModel):
    name: str
    # Belirtilmezse: bu isimle YENİ bir evren de oluşturulur (yepyeni bir
    # seri başlatıyorsun demektir). Belirtilirse: bu kitap VAR OLAN bir
    # evrene eklenir (serinin 2., 3., ... kitabı) - o evrenin tüm
    # karakter/mekan/kuralları bu kitapta da otomatik kullanılabilir olur.
    universe_id: Optional[int] = None
    book_number: Optional[int] = None


class NovelUpdate(BaseModel):
    name: Optional[str] = None
    book_number: Optional[int] = None


class NovelOut(BaseModel):
    id: int
    name: str
    universe_id: Optional[int] = None
    universe_name: Optional[str] = None
    book_number: Optional[int] = None

    class Config:
        from_attributes = True


def _to_out(db: Session, novel: models.Novel) -> NovelOut:
    universe = db.query(models.Universe).filter(models.Universe.id == novel.universe_id).first() if novel.universe_id else None
    return NovelOut(
        id=novel.id, name=novel.name, universe_id=novel.universe_id,
        universe_name=universe.name if universe else None, book_number=novel.book_number,
    )


@router.get("/{novel_id}/manuscript-stats")
def manuscript_stats(
    novel_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user),
):
    """İndirmeden önce kaç bölüm/paragraf/kelime olduğunu gösterir."""
    novel = db.query(models.Novel).filter(models.Novel.id == novel_id).first()
    if not novel:
        raise HTTPException(404, "Kitap bulunamadı")
    return manuscript.istatistik(db, novel_id)


@router.get("/{novel_id}/manuscript")
def export_manuscript(
    novel_id: int, format: str = "docx",
    db: Session = Depends(get_db), _user=Depends(get_current_user),
):
    """ROMANI OKUNUR BİÇİMDE indirir.

    Mevcut JSON yedeği bir VERİ yedeğidir - geri yüklemek için, okumak
    için değil. Bu uç el yazmasını basılabilir/paylaşılabilir hâlde verir:
    fihrist hiyerarşisi korunur, paragraflar okunacak gibi dizilir.
    """
    if format not in ("docx", "md", "txt"):
        raise HTTPException(400, "format 'docx', 'md' veya 'txt' olmalı")
    novel = db.query(models.Novel).filter(models.Novel.id == novel_id).first()
    if not novel:
        raise HTTPException(404, "Kitap bulunamadı")

    damga = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M")
    ad = "".join(ch for ch in (novel.name or "roman") if ch.isalnum() or ch in " -_").strip()
    ad = (ad or "roman").replace(" ", "-")

    if format == "docx":
        govde = manuscript.export_docx(db, novel)
        tur = ("application/vnd.openxmlformats-officedocument"
               ".wordprocessingml.document")
    elif format == "md":
        govde = manuscript.export_markdown(db, novel)
        tur = "text/markdown; charset=utf-8"
    else:
        govde = manuscript.export_txt(db, novel)
        tur = "text/plain; charset=utf-8"

    return Response(
        content=govde, media_type=tur,
        headers={"Content-Disposition":
                 f'attachment; filename="{ad}-{damga}.{format}"'},
    )


@router.get("/", response_model=List[NovelOut])
def list_novels(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    novels = db.query(models.Novel).order_by(models.Novel.id).all()
    return [_to_out(db, n) for n in novels]


@router.post("/", response_model=NovelOut, status_code=201)
def create_novel(payload: NovelCreate, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Roman adı boş olamaz")

    universe_id = payload.universe_id
    if universe_id is not None:
        if not db.query(models.Universe).filter(models.Universe.id == universe_id).first():
            raise HTTPException(404, "Evren bulunamadı")
    else:
        # universe_id verilmedi -> bu isimle yepyeni bir evren aç (yeni bir seri).
        universe = models.Universe(name=name)
        db.add(universe)
        db.commit()
        db.refresh(universe)
        universe_id = universe.id

    novel = models.Novel(name=name, universe_id=universe_id, book_number=payload.book_number)
    db.add(novel)
    db.commit()
    db.refresh(novel)
    return _to_out(db, novel)


@router.put("/{novel_id}", response_model=NovelOut)
def update_novel(novel_id: int, payload: NovelUpdate, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    novel = db.query(models.Novel).filter(models.Novel.id == novel_id).first()
    if not novel:
        raise HTTPException(404, "Roman bulunamadı")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            raise HTTPException(400, "Roman adı boş olamaz")
        novel.name = name
    if "book_number" in data:
        novel.book_number = data["book_number"]
    db.commit()
    db.refresh(novel)
    return _to_out(db, novel)


@router.delete("/{novel_id}", status_code=204)
def delete_novel(novel_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    """SADECE bu kitabın bölüm/paragraf/versiyon/mention verisini siler.
    Karakterler/mekanlar/kurallar/ilişkiler/gelişim çizelgesi/olaylar
    evren düzeyinde kaldığı için BURADAN SİLİNMEZ (serideki başka
    kitaplar hâlâ onlara ihtiyaç duyabilir). source_novel_id ile bu kitabı
    işaret eden progression/event kayıtları varsa, referans sadece NULL'a
    çekilir - kayıtların kendisi (evren geçmişi olarak) silinmez."""
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

    db.query(models.Progression).filter(models.Progression.source_novel_id == novel_id).update(
        {models.Progression.source_novel_id: None}, synchronize_session=False
    )
    db.query(models.Event).filter(models.Event.source_novel_id == novel_id).update(
        {models.Event.source_novel_id: None}, synchronize_session=False
    )

    db.delete(novel)
    db.commit()
    return None
