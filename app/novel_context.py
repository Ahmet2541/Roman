"""Çoklu roman/evren desteği.

Hiyerarşi: Universe (evren/seri) -> Novel (kitap) -> Chapter -> Paragraph.
Karakter/Mekan/Olay/Nesne/İpucu/Terim/Kural/Faksiyon/İlişki/Progression
artık bir EVRENE bağlı (universe_id) - aynı serinin tüm kitapları bunları
paylaşır. Bölüm/Paragraf hâlâ bir KİTABA bağlı (novel_id) - roman metninin
kendisi paylaşılmaz.

Her istek hangi KİTABA ait olduğunu X-Novel-Id header'ıyla bildirir
(frontend bunu her API çağrısına otomatik ekler - bkz. frontend/js/api.js).
Bundan iki farklı dependency türetilir:
  - get_novel_id: bölüm/paragraf gibi kitaba özel işlemler için.
  - get_universe_id: karakter/mekan/kural gibi evrene özel (paylaşılan)
    işlemler için - X-Novel-Id'den o kitabın hangi evrene ait olduğunu
    bulur. Frontend'in AYRICA bir "evren" header'ı göndermesine gerek
    yok - hangi kitaptaysan, o kitabın evreni otomatik kullanılır."""
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


def get_universe_id(
    x_novel_id: int | None = Header(default=None, alias="X-Novel-Id"),
    db: Session = Depends(get_db),
) -> int:
    """X-Novel-Id header'ından, o kitabın ait olduğu evrenin id'sini
    bulur. Karakter/Mekan/Kural/Terim/Nesne/İpucu/Faksiyon/İlişki/
    Progression/Olay router'ları bunu kullanır - novel_id DEĞİL, çünkü bu
    kayıtlar artık evren düzeyinde paylaşılıyor."""
    if x_novel_id is None:
        raise HTTPException(
            status_code=400,
            detail="X-Novel-Id header gerekli - önce bir roman seç ya da oluştur.",
        )
    novel = db.query(models.Novel).filter(models.Novel.id == x_novel_id).first()
    if not novel:
        raise HTTPException(status_code=404, detail="Roman bulunamadı")
    if novel.universe_id is None:
        raise HTTPException(
            status_code=500,
            detail="Bu roman henüz bir evrene bağlanmamış - sunucuyu yeniden başlatıp göçün (migration) tamamlanmasını bekle.",
        )
    return novel.universe_id


def get_universe_id_for_novel(db: Session, novel_id: int) -> int | None:
    """novel_context dışından (ör. mentions.py) çağrılabilen, Depends()
    olmayan düz fonksiyon hali - bir Chapter/Paragraph kaydedildiğinde
    hangi evrene bakılacağını bulmak için kullanılır."""
    novel = db.query(models.Novel).filter(models.Novel.id == novel_id).first()
    return novel.universe_id if novel else None
