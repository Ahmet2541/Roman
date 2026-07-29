"""Çoklu roman desteği: her istek hangi romana ait olduğunu X-Novel-Id
header'ıyla bildirir (frontend bunu her API çağrısına otomatik ekler - bkz.
frontend/js/api.js). Bu dependency o header'ı okuyup doğrular; router'lar
kendi sorgularını bu novel_id ile filtreler/oluşturur."""
from fastapi import Header, HTTPException, Depends
from sqlalchemy.orm import Session

from .database import get_db
from . import models


def get_novel_id(
    x_novel_id: int | None = Header(default=None, alias="X-Novel-Id"),
    db: Session = Depends(get_db),
) -> int:
    if x_novel_id is None:
        raise HTTPException(
            status_code=400,
            detail="X-Novel-Id header gerekli - önce bir roman seç ya da oluştur.",
        )
    novel = db.query(models.Novel).filter(models.Novel.id == x_novel_id).first()
    if not novel:
        raise HTTPException(status_code=404, detail="Roman bulunamadı")
    return x_novel_id
