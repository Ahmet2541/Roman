"""KOPUK UÇ TEMİZLİĞİ: silinen bir kayda işaret eden matris bağları.

Plan Matrisi beş yere bağlanır: bölümlere (cell.chapter_id), kişilere
(column.character_id), varlıklara (hücre içindeki mekan_id / kişi / nesne
ID'leri), diğer hücrelere (MP kodları) ve kendi kolon/satırlarına.

Kolon/satır/matris silmesi ORM ilişkileriyle zaten temizleniyor. Ama
karşı taraf BAŞKA bir tablodan silindiğinde (bir bölüm, bir kişi, bir
mekan) matristeki bağ ölü bir ID'ye işaret ederek kalıyordu. Bunun
sessiz olması en kötü tarafı: hücre "bağlı" görünüyor, denetim onu
"bağsız plan" diye işaretlemiyor, ama plan yazım anında hiçbir bölüme
gitmiyor.

Silme anında temizlemek okuma anında doğrulamaya yeğdir: her matris
okumasında varlık sorgulamak yerine, seyrek olan silme işleminde bir
kez düzeltilir.

MP kodlarına yapılan referanslar BİLEREK temizlenmez - onlar hücrenin
içeriğinin parçası, yazarın kararı. Denetim promptu bunları "KAYIP
REFERANS" olarak raporlar, karar yazarın olur.
"""
from sqlalchemy.orm import Session

from . import models


def chapter_silindi(db: Session, chapter_id: int) -> int:
    """Bölüme bağlı hücrelerin bağını çözer. Hücre ve planı DURUR -
    sadece ölü bölüme işaret eden bağ kalkar; plan yeniden başka bir
    bölüme bağlanabilsin diye."""
    hucreler = db.query(models.MatrixCell).filter(
        models.MatrixCell.chapter_id == chapter_id).all()
    for h in hucreler:
        h.chapter_id = None
    return len(hucreler)


def character_silindi(db: Session, character_id: int) -> int:
    """Kişiye bağlanmış kolonların bağını çözer (kolon başlığı durur)."""
    kolonlar = db.query(models.MatrixColumn).filter(
        models.MatrixColumn.character_id == character_id).all()
    for k in kolonlar:
        k.character_id = None
    return len(kolonlar)


def varlik_silindi(db: Session, universe_id: int, entity_id: int, alan: str) -> int:
    """Hücre içindeki varlık ID'lerini temizler. ADI KORUR, ID'yi düşürür:
    plan metni bozulmamalı ("VIP Salonu" yazılı kalsın) ama ölü ID
    taşınmamalı - yoksa ileride o ID'yi başka bir varlık alırsa hücre
    yanlış kayda bağlanır.

    alan: "mekan" | "kisiler" | "nesneler"
    """
    hucreler = (
        db.query(models.MatrixCell)
        .join(models.PlanMatrix, models.MatrixCell.matrix_id == models.PlanMatrix.id)
        .join(models.Novel, models.PlanMatrix.novel_id == models.Novel.id)
        .filter(models.Novel.universe_id == universe_id)
        .all()
    )
    degisen = 0
    for h in hucreler:
        veri = h.data if isinstance(h.data, dict) else None
        if not veri:
            continue
        yeni = dict(veri)
        dokunuldu = False
        if alan == "mekan":
            if yeni.get("mekan_id") == entity_id:
                yeni["mekan_id"] = None
                dokunuldu = True
        else:
            liste = yeni.get(alan)
            if isinstance(liste, list):
                temiz = []
                for it in liste:
                    if isinstance(it, dict) and it.get("id") == entity_id:
                        temiz.append({"id": None, "ad": it.get("ad", "")})
                        dokunuldu = True
                    else:
                        temiz.append(it)
                if dokunuldu:
                    yeni[alan] = temiz
        if dokunuldu:
            h.data = yeni
            degisen += 1
    return degisen
