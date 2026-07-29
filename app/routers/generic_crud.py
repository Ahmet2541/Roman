from typing import Type, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from ..novel_context import get_novel_id


def make_crud_router(
    model, create_schema: Type, update_schema: Type, out_schema: Type,
    prefix: str, tag: str,
) -> APIRouter:
    """Kişiler, Mekanlar, Olaylar, Nesneler, İpuçları, Terimler ve Kurallar
    menülerinin hepsi aynı basit CRUD şekline sahip - tek fabrika fonksiyonu
    yedisi için de router üretir, kod tekrarını önler.

    Her satır artık bir romana bağlı (novel_id) - X-Novel-Id header'ı
    (get_novel_id) olmadan hiçbir istek geçmez, ve her sorgu/oluşturma o
    romanla filtrelenir/etiketlenir - böylece romanlar arasında hiçbir
    isim/kayıt sızmaz."""

    router = APIRouter(prefix=prefix, tags=[tag])

    @router.get("/", response_model=List[out_schema])
    def list_all(
        response: Response,
        limit: Optional[int] = Query(None, ge=1, le=1000, description="Verilmezse tümü döner (mevcut davranış)"),
        offset: int = Query(0, ge=0),
        q: Optional[str] = None,
        db: Session = Depends(get_db), _user=Depends(get_current_user),
        novel_id: int = Depends(get_novel_id),
    ):
        # Sıralama ve arama Python tarafında yapılıyor: name/title alanı
        # şifreli olduğundan SQL ORDER BY / LIKE şifreli metne göre anlamsız
        # sonuç verirdi. Roman ölçeğinde (yüzlerce kayıt) bu fark edilmez.
        items = db.query(model).filter(model.novel_id == novel_id).all()
        sort_key = lambda item: (getattr(item, "name", None) or getattr(item, "title", None) or "").lower()
        items = sorted(items, key=sort_key)
        if q:
            q_lower = q.lower()
            items = [i for i in items if q_lower in sort_key(i)]
        response.headers["X-Total-Count"] = str(len(items))
        if limit is not None:
            items = items[offset:offset + limit]
        return items

    @router.get("/{item_id}", response_model=out_schema)
    def get_one(
        item_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user),
        novel_id: int = Depends(get_novel_id),
    ):
        item = db.query(model).filter(model.id == item_id, model.novel_id == novel_id).first()
        if not item:
            raise HTTPException(404, f"{tag} bulunamadı")
        return item

    @router.post("/", response_model=out_schema, status_code=201)
    def create(
        payload: create_schema, db: Session = Depends(get_db), _user=Depends(get_current_user),
        novel_id: int = Depends(get_novel_id),
    ):
        item = model(**payload.model_dump(), novel_id=novel_id)
        db.add(item)
        db.commit()
        db.refresh(item)
        return item

    @router.put("/{item_id}", response_model=out_schema)
    def update(
        item_id: int, payload: update_schema, db: Session = Depends(get_db), _user=Depends(get_current_user),
        novel_id: int = Depends(get_novel_id),
    ):
        item = db.query(model).filter(model.id == item_id, model.novel_id == novel_id).first()
        if not item:
            raise HTTPException(404, f"{tag} bulunamadı")
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(item, field, value)
        db.commit()
        db.refresh(item)
        return item

    @router.delete("/{item_id}", status_code=204)
    def delete(
        item_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user),
        novel_id: int = Depends(get_novel_id),
    ):
        item = db.query(model).filter(model.id == item_id, model.novel_id == novel_id).first()
        if not item:
            raise HTTPException(404, f"{tag} bulunamadı")
        db.delete(item)
        db.commit()
        return None

    return router
