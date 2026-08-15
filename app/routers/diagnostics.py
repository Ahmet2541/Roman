"""HATA AJANI - tarayıcıda oluşan hataları toplar ve raporlar.

Neden gerekli: bu projedeki arayüz hatalarının hepsini kullanıcı ekran
görüntüsüyle bildirdi. Tarayıcı hatası kullanıcının ekranında bir uyarı
kutusu olarak çıkıp kayboluyor; ne zaman, hangi ekranda, hangi eylemde
oluştuğu kayıt altına alınmıyordu. Bu modül hataları sunucuya taşır,
bağlamıyla saklar ve "Sistem Sağlığı" panelinde gösterir.

Gizlilik: metin İÇERİĞİ gönderilmez - yalnızca hata mesajı, yığın izi ve
hangi ekranda/eylemde olduğu.
"""
import logging
from collections import deque
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import get_current_user

logger = logging.getLogger("roman_api.diagnostics")
router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])

# Son hatalar bellekte tutulur (sunucu yeniden başlayınca sıfırlanır).
# Kalıcı kayıt zaten logs/app.log içinde - burası hızlı bakış içindir.
_RECENT: deque = deque(maxlen=50)


# Kayıt türleri: sadece çökme değil, akışı bozan her şey izlenir.
KINDS = {"hata", "sunucu_hatasi", "istek_hatasi", "ag_hatasi", "yavas_istek", "bos_yanit"}


class ClientError(BaseModel):
    message: str = Field(max_length=500)
    stack: str = Field(default="", max_length=2000)
    kind: str = Field(default="hata", max_length=20)
    view: str = Field(default="", max_length=80)      # hangi ekran
    action: str = Field(default="", max_length=120)   # hangi eylem
    url: str = Field(default="", max_length=300)


class ClientErrorOut(BaseModel):
    at: str
    message: str
    stack: str = ""
    kind: str = "hata"
    view: str = ""
    action: str = ""
    count: int = 1


@router.post("/client-error", status_code=204)
def report_client_error(payload: ClientError, _user=Depends(get_current_user)):
    """Tarayıcıdan gelen hatayı kaydeder. Aynı hata tekrarlanırsa yeni
    kayıt açmaz, sayacı artırır - 50 kez tekrarlayan bir hata listeyi
    doldurup diğerlerini gizlemesin."""
    mesaj = payload.message.strip()
    if not mesaj:
        return
    tur = payload.kind if payload.kind in KINDS else "hata"
    for kayit in _RECENT:
        if kayit["message"] == mesaj and kayit["view"] == payload.view:
            kayit["count"] += 1
            kayit["at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            return
    _RECENT.appendleft({
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "message": mesaj,
        "stack": payload.stack.strip()[:2000],
        "kind": tur,
        "view": payload.view,
        "action": payload.action,
        "count": 1,
    })
    # Yavaş istek bir HATA değil - uyarı seviyesinde loglanır
    kayit_fn = logger.warning if tur == "yavas_istek" else logger.error
    kayit_fn("ARAYÜZ [%s] [%s / %s] %s", tur, payload.view or "?", payload.action or "?", mesaj)


@router.get("/client-errors", response_model=List[ClientErrorOut])
def list_client_errors(_user=Depends(get_current_user)):
    """Son arayüz hataları - en yeniden eskiye."""
    return [ClientErrorOut(**k) for k in _RECENT]


@router.delete("/client-errors", status_code=204)
def clear_client_errors(_user=Depends(get_current_user)):
    _RECENT.clear()
