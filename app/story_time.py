"""HİKÂYE ZAMANI: bölümleri numaraya göre değil, GEÇTİKLERİ ANA göre sıralar.

Sorun neydi: sistem sıralama için tek şey biliyordu - bölüm numarası.
"Numarası küçük olan geçmiştir" varsayımı, kronolojik olarak geriye giden
bir romanda yanlış sonuç veriyor. 28 Haziran'da geçen bir sahne Bölüm
21'deyse, model "önceki" yirmi bölümü geçmiş sanıyor - oysa hepsi o
sahneden SONRA geçiyor. Sonuç: fihristten gelen gelecek bilgisi metne
sızıyor ("henüz bilmiyordu ki Vicdan bu akşam doğacaktı").

Çözüm: her bölümün hikâye zamanını VERİ olarak bil, fihristi ona göre süz.
Zaman zaten matris hücresinde yazılı (ZAMAN alanı) - oradan okunur, ayrıca
bir şey girmen gerekmez.

Sıralanabilirlik için tarih tek bir sayıya çevrilir (YYYYMMDDHHMM). Tarih
çözülemezse None döner ve o bölüm kronolojik süzmenin DIŞINDA kalır -
eldeki en iyi bilgiyle çalışılır, tahmin edilmez.
"""
import re
from typing import Optional

AYLAR = {
    "ocak": 1, "şubat": 2, "subat": 2, "mart": 3, "nisan": 4,
    "mayıs": 5, "mayis": 5, "haziran": 6, "temmuz": 7, "ağustos": 8,
    "agustos": 8, "eylül": 9, "eylul": 9, "ekim": 10, "kasım": 11,
    "kasim": 11, "aralık": 12, "aralik": 12,
}


def _tr_lower(metin: str) -> str:
    return (metin or "").replace("İ", "i").replace("I", "ı").lower()


def parse_tarih(tarih: str, saat: str = "") -> Optional[int]:
    """'28 Haziran 2030' + '13:30' -> 203006281330 (sıralanabilir sayı).

    Yalnızca AY ADI olan ya da sayısal (28.06.2030) biçimler çözülür.
    "üçüncü gün", "kapanıştan iki hafta sonra" gibi göreli ifadeler
    ÇÖZÜLMEZ - None döner. Bu bilinçli: uydurma bir tarih üretip yanlış
    sıralamak, sıralamamaktan kötüdür.
    """
    if not tarih:
        return None
    ham = _tr_lower(str(tarih).strip())

    yil = ay = gun = None

    # "28 haziran 2030" / "28 haziran"
    m = re.search(r"(\d{1,2})\s+([a-zçğıöşü]+)\s*(\d{4})?", ham)
    if m and _tr_lower(m.group(2)) in AYLAR:
        gun = int(m.group(1))
        ay = AYLAR[_tr_lower(m.group(2))]
        yil = int(m.group(3)) if m.group(3) else None
    else:
        # "28.06.2030" / "28/06/2030" / "28-06-30"
        m = re.search(r"(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})", ham)
        if m:
            gun, ay = int(m.group(1)), int(m.group(2))
            yil = int(m.group(3))
            if yil < 100:
                yil += 2000

    if gun is None or ay is None or not (1 <= gun <= 31 and 1 <= ay <= 12):
        return None
    if yil is None:
        # Yıl yoksa sıralama yine mümkün ama kitap içi; sabit bir taban
        # kullanmak yerine yılı 0 sayıyoruz - aynı romanın tamamı yılsızsa
        # gün/ay sıralaması doğru çalışır, karışık olursa yıllı olanlar
        # sonra gelir ki bu da doğrudur.
        yil = 0

    # Saat AYRI verilmediyse tarih metninin İÇİNDE ara: varlık kayıtlarında
    # (doğum/ölüm) tek bir alan var, "28 Haziran 2030 21:00" diye yazılıyor.
    # Saati okumazsak gün 00:00 sayılır ve aynı günün 13:30'undaki sahnede
    # varlık "çoktan var" görünür - Vicdan tam bu yüzden denetimden kaçtı.
    saat_kaynak = str(saat or "")
    if not re.search(r"\d{1,2}[:.]\d{2}", saat_kaynak):
        # Tarihin gün/ay/yıl kısmını atla, kalanda saat ara.
        kalan = ham[m.end():] if m else ham
        saat_kaynak = kalan
    saat_dk = 0
    m = re.search(r"(\d{1,2})[:.](\d{2})", saat_kaynak)
    if m:
        sa, dk = int(m.group(1)), int(m.group(2))
        if 0 <= sa <= 23 and 0 <= dk <= 59:
            saat_dk = sa * 100 + dk

    return ((yil * 100 + ay) * 100 + gun) * 10000 + saat_dk


def hucreden_zaman(data) -> Optional[int]:
    """Plan hücresinin ZAMAN alanından sıralanabilir zamanı çıkarır."""
    from . import plan_schema
    d = plan_schema.normalize_cell(data)
    return parse_tarih(d["zaman"].get("tarih", ""), d["zaman"].get("saat", ""))


def bolum_zamanlari(db, novel_id: int) -> dict:
    """{chapter_id: sıralanabilir_zaman} - plan hücrelerinden okunur.

    Bir bölüme birden çok hücre bağlıysa (alt sahneler) EN ERKEN zaman
    alınır: bölüm o anda başlıyor demektir.
    """
    from . import models

    sonuc = {}
    hucreler = (
        db.query(models.MatrixCell)
        .join(models.PlanMatrix, models.MatrixCell.matrix_id == models.PlanMatrix.id)
        .filter(models.PlanMatrix.novel_id == novel_id,
                models.MatrixCell.chapter_id.isnot(None))
        .all()
    )
    for h in hucreler:
        z = hucreden_zaman(h.data)
        if z is None:
            continue
        mevcut = sonuc.get(h.chapter_id)
        if mevcut is None or z < mevcut:
            sonuc[h.chapter_id] = z
    return sonuc
