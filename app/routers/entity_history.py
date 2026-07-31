"""Menü verisi (Karakter/Mekan/Nesne/Olay/İpucu/Terim/Kural/Faksiyon) için
değişiklik geçmişi. Paragraf metninde zaten var olan ParagraphVersion
mekanizmasının karşılığı - şu ana kadar description/notes/sections gibi
alanlar üzerine yazıldığında HİÇBİR geri dönüş yolu yoktu, AI ya da yazar
yanlışlıkla önemli bir notu silip üzerine yazarsa kalıcı olarak kaybolurdu.

Kaydetme generic_crud.py'nin update() fonksiyonunda otomatik olur (bkz. o
dosyadaki _SNAPSHOT_FIELDS). Bu router sadece OKUMA ve GERİ YÜKLEME sağlar."""
from typing import List
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from .. import models, schemas
from ..entities import ENTITY_MODELS
from ..novel_context import get_universe_id

router = APIRouter(prefix="/entity-history", tags=["Değişiklik Geçmişi"])


def _to_out(row: models.EntitySnapshot) -> schemas.EntitySnapshotOut:
    try:
        old_value = json.loads(row.old_value_json)
    except (json.JSONDecodeError, TypeError):
        old_value = row.old_value_json  # bozuk/eski veri olsa bile en azından ham haliyle göster
    return schemas.EntitySnapshotOut(
        id=row.id, entity_type=row.entity_type, entity_id=row.entity_id,
        field_name=row.field_name, old_value=old_value, saved_at=row.saved_at,
    )


@router.get("/{entity_type}/{entity_id}", response_model=List[schemas.EntitySnapshotOut])
def list_history(
    entity_type: str, entity_id: int, db: Session = Depends(get_db),
    _user=Depends(get_current_user), universe_id: int = Depends(get_universe_id),
):
    rows = (
        db.query(models.EntitySnapshot)
        .filter(
            models.EntitySnapshot.entity_type == entity_type,
            models.EntitySnapshot.entity_id == entity_id,
            models.EntitySnapshot.universe_id == universe_id,
        )
        .order_by(models.EntitySnapshot.saved_at.desc())
        .all()
    )
    return [_to_out(r) for r in rows]


@router.post("/{snapshot_id}/restore")
def restore_snapshot(
    snapshot_id: int, db: Session = Depends(get_db),
    _user=Depends(get_current_user), universe_id: int = Depends(get_universe_id),
):
    """Bir snapshot'ı geri yükler - o alanı snapshot'taki eski değere
    döndürür. ÖNEMLİ: geri yüklemeden önce alanın O ANKİ hali de ayrıca
    bir snapshot olarak kaydedilir - yani geri yükleme de "geri alınabilir"
    bir işlem, kazara yanlış bir snapshot'ı geri yüklersen onu da geri
    çevirebilirsin (redo gibi)."""
    snap = db.query(models.EntitySnapshot).filter(
        models.EntitySnapshot.id == snapshot_id, models.EntitySnapshot.universe_id == universe_id
    ).first()
    if not snap:
        raise HTTPException(404, "Kayıt bulunamadı")

    model = ENTITY_MODELS.get(snap.entity_type)
    if model is None:
        raise HTTPException(400, f"'{snap.entity_type}' için geri yükleme desteklenmiyor")

    item = db.query(model).filter(model.id == snap.entity_id, model.universe_id == universe_id).first()
    if not item:
        raise HTTPException(404, f"{snap.entity_type} id={snap.entity_id} artık mevcut değil (silinmiş olabilir)")

    try:
        old_value = json.loads(snap.old_value_json)
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(500, "Kayıtlı geçmiş verisi okunamadı")

    current_value = getattr(item, snap.field_name, None)
    if current_value:
        db.add(models.EntitySnapshot(
            universe_id=universe_id, entity_type=snap.entity_type, entity_id=item.id,
            field_name=snap.field_name, old_value_json=json.dumps(current_value, ensure_ascii=False),
        ))

    setattr(item, snap.field_name, old_value)
    db.commit()
    db.refresh(item)
    return {
        "entity_type": snap.entity_type, "id": item.id,
        "field_name": snap.field_name, "restored_value": old_value,
    }
