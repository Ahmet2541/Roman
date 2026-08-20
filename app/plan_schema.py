"""YAPI KİLİDİ v1.0 - Plan Matrisi hücrelerinin sabit sahne şeması.

Serbest metin bir hücre, yazarken her seferinde "neyi yazmıştım, neyi
unuttum" sorusunu doğuruyordu. Bu modül şemayı TEK KAYNAKTAN tanımlar:
router, arayüz ve AI bağlamı hep buradaki alan listesini kullanır.

ÜÇ KATMAN - hangi bilginin nerede durduğu şemanın özüdür:

  MİRAS   : hücrede YAZILMAZ, bir kez tanımlanır.
            TUR mirası   -> MatrixColumn.tur_data (konu, suç, damga…)
            PARÇA mirası -> MatrixRow.parca_data  (no, süre) +
                            MatrixRow.instructions (stil kuralları -
                            Talimat Kasası olarak zaten vardı)
  SAHNE   : hücrenin kendisi -> MatrixCell.data
            ÜST (sahne kimliği): olay, zaman, mekan, duygu
            ALT (yay)          : giriş, gelişme, sonuç
            BAĞLANTI           : MP kodları + tür (ayna/ileri/geri)
  VARLIK  : hiç kopyalanmaz. Kişi/Mekan/Nesne kayıtlarına ID ile
            bağlanır (kisiler/nesneler/mekan_id) - "aynı varlık = aynı
            ID" kuralı böylece veri düzeyinde kilitlenir, isim
            benzerliğine bırakılmaz.

İçerik ayrıca DÜZ METNE dökülür (render_cell) ve MatrixCell.content'e
yazılır: bağlam katmanı, MP referansları, "Plandan Taslak" ve tutarlılık
taraması hiçbir değişiklik olmadan çalışmaya devam etsin diye. Yani
şema yeni bir yol açmaz, mevcut yolun girişine bir form koyar.
"""
import re
from typing import Any

def _tr_lower(metin: str) -> str:
    """Türkçeye uygun küçültme. str.casefold() 'İ' harfini birleşik noktalı
    'i̇' yapar ve karşılaştırmayı bozar; İ->i, I->ı elle çevrilir."""
    return (metin or "").replace("İ", "i").replace("I", "ı").lower()


# Bir beat kaç karakteri geçerse "beat değil, olay dizisi" sayılır. Şema
# GİRİŞ/GELİŞME/SONUÇ'u tek bir dönüş anı olarak tanımlar; buraya sahnenin
# tamamı yazıldığında yazan model sahneyi KURMAZ, verilen diziyi doldurur.
BEAT_SINIRI = 160
OLAY_SINIRI = 120


# --- Alan tanımları (arayüz formu da bu listelerden üretilir) ---------------

# ZAMAN TİPİ - sahnenin zamanla ilişkisi:
#   NOKTA  : sahne tek bir anda geçer, süre işlemez
#   ATLAMA : önceki sahneden zaman sıçraması var (kaç sonra?)
#   SAYAÇ  : sahne boyunca işleyen bir süre var (neyin sayacı?)
# Anahtar "SAYAC" (ASCII) olarak SAKLANIR - eski kayıtlar bozulmasın diye -
# ama ekranda ve AI'ya giden metinde "SAYAÇ" yazılır.
ZAMAN_TIPLERI = ["NOKTA", "ATLAMA", "SAYAC"]
ZAMAN_TIPI_GORUNEN = {"NOKTA": "NOKTA", "ATLAMA": "ATLAMA", "SAYAC": "SAYAÇ"}
ZAMAN_TIPI_ACIKLAMA = {
    "NOKTA": "tek bir an, süre işlemiyor",
    "ATLAMA": "önceki sahneden zaman sıçraması",
    "SAYAC": "sahne boyunca işleyen süre",
}

# HEDEF UZUNLUK: plandan çıkacak metnin ölçüsü. Etiketin tek başına
# ("uzun") bir modele söylediği hiçbir şey yok - somut karşılığı da
# birlikte gider. Anahtar / ekran etiketi / AI'ya giden tarif:
UZUNLUK_SEVIYELERI = [
    ("ozet", "Özet",
     "1-2 paragraf. Olay aktarılır, sahne AÇILMAZ - replikler özetlenir, "
     "betimleme asgari."),
    ("normal", "Normal",
     "4-6 paragraf. Sahne tam açılır: beat'ler yerinde, replikler yazılır, "
     "betimleme sahneyi taşıyacak kadar."),
    ("uzun", "Uzun metin",
     "8+ paragraf. Beat'ler genişletilir, ara sessizlikler ve bakışlar "
     "yazılır, ritim yavaşlatılır."),
]
UZUNLUK_ANAHTARLARI = [k for k, _, _ in UZUNLUK_SEVIYELERI]
BAGLANTI_TURLERI = ["ayna", "ileri", "geri"]

# TUR mirası: kolonda bir kez. (anahtar, ekran etiketi, ipucu)
TUR_ALANLARI = [
    ("konu", "Konu", "Bu turun ekseni"),
    ("suc", "Suç", "Turun suçu / iddiası"),
    ("misafir", "Misafir", "Bu turun misafiri"),
    ("guven_kelimesi", "Güven kelimesi", "Turun güven sözcüğü"),
    ("matematik_cifti", "Matematik çifti", "Sayı/oran çifti"),
    ("damga", "Damga", "SONUÇ beat'inde asılı kalması gereken kelime"),
    ("koltugun_alti", "Koltuğun altı", "Koltuk altındaki şey"),
    ("ovgu", "Övgü", "Turun övgü kalıbı"),
]

# PARÇA mirası: satırda bir kez. Başlık = row.label, stil kuralları =
# row.instructions (Talimat Kasası) - burada tekrarlanmaz.
PARCA_ALANLARI = [
    ("no", "Parça no", "Ör. 3 veya 5a"),
    ("sure", "Süre", "Ör. 20 dk"),
]

# SAHNE - ÜST katman
UST_ALANLARI = [
    ("olay", "OLAY", "Tek cümle: kim kime ne yapar"),
]

# SAHNE - ALT katman (yay). Sıra önemlidir, render de bu sırayı izler.
YAY_ALANLARI = [
    ("giris", "GİRİŞ", "Açılış beat'i (ilk replik / ret)"),
    ("gelisme", "GELİŞME", "Dönme beat'i (baskı / tehdit / tanıma)"),
    ("sonuc", "SONUÇ", "Kapanış beat'i - damga kelime burada asılı kalır"),
]


def _zaman_tipi(deger) -> str:
    """Girişi şemadaki anahtara oturtur. Kullanıcı ya da eski kayıt "SAYAÇ"
    yazmış olabilir; saklanan anahtar her zaman ASCII "SAYAC"tır."""
    ham = str(deger or "").strip().upper().replace("Ç", "C")
    return ham if ham in ZAMAN_TIPLERI else ""


def bos_hucre() -> dict:
    """Yeni bir hücrenin boş iskeleti - arayüz ve testler aynı şekli görsün."""
    return {
        "olay": "",
        "zaman": {"tarih": "", "saat": "", "tip": "", "sayac": ""},
        "mekan_id": None,
        "mekan": "",
        "duygu": {"kim": "", "baslangic": "", "bitis": ""},
        "kisiler": [],   # [{"id": int|None, "ad": str}]
        "nesneler": [],  # [{"id": int|None, "ad": str}]
        "odak": "",      # nesneler içinden dramatik ağırlığı taşıyan tek nesne
        "uzunluk": "normal",  # ozet | normal | uzun - plandan çıkacak metnin ölçüsü
        "giris": "",
        "gelisme": "",
        "sonuc": "",
        "baglantilar": [],  # [{"kod": "MP7", "tur": "ayna", "not": ""}]
    }


def normalize_cell(data: Any) -> dict:
    """Gelen veriyi şemaya oturtur: eksik anahtarları tamamlar, fazlasını
    atar, tipleri düzeltir. Arayüzden ya da eski kayıttan ne gelirse
    gelsin sonrası tek bir şekle güvenebilsin diye."""
    out = bos_hucre()
    if not isinstance(data, dict):
        return out

    for key in ("olay", "giris", "gelisme", "sonuc", "mekan", "odak"):
        val = data.get(key)
        if isinstance(val, str):
            out[key] = val.strip()

    # Bilinmeyen ya da boş değer "normal"e düşer: uzunluksuz plan, modelin
    # her sahnede kendi ölçüsünü seçmesi demek - bölümler arası tutarsızlığın
    # sessiz kaynağı buydu.
    uz = str(data.get("uzunluk") or "").strip().lower()
    out["uzunluk"] = uz if uz in UZUNLUK_ANAHTARLARI else "normal"

    mekan_id = data.get("mekan_id")
    out["mekan_id"] = mekan_id if isinstance(mekan_id, int) else None

    zaman = data.get("zaman")
    if isinstance(zaman, dict):
        out["zaman"] = {
            "tarih": str(zaman.get("tarih") or "").strip(),
            "saat": str(zaman.get("saat") or "").strip(),
            # "SAYAÇ" yazılırsa da kabul et - anahtar ASCII "SAYAC" kalır.
            "tip": _zaman_tipi(zaman.get("tip")),
            # SAYAÇ/ATLAMA tek başına boşlukta duruyordu: neyin sayacı,
            # neyin atlaması olduğu yazılmadan sahne zamanı belirsiz kalıyor.
            "sayac": str(zaman.get("sayac") or "").strip(),
        }

    duygu = data.get("duygu")
    if isinstance(duygu, dict):
        out["duygu"] = {
            # Duygu kime ait: sahipsiz duygu atmosfer olur, karakter olmaz.
            "kim": str(duygu.get("kim") or "").strip(),
            "baslangic": str(duygu.get("baslangic") or "").strip(),
            "bitis": str(duygu.get("bitis") or "").strip(),
        }

    for key in ("kisiler", "nesneler"):
        items = data.get(key)
        if isinstance(items, list):
            temiz = []
            for it in items:
                if isinstance(it, dict):
                    ad = str(it.get("ad") or "").strip()
                    if not ad:
                        continue
                    eid = it.get("id")
                    temiz.append({"id": eid if isinstance(eid, int) else None, "ad": ad})
                elif isinstance(it, str) and it.strip():
                    temiz.append({"id": None, "ad": it.strip()})
            out[key] = temiz

    baglar = data.get("baglantilar")
    if isinstance(baglar, list):
        temiz = []
        for b in baglar:
            if not isinstance(b, dict):
                continue
            kod = str(b.get("kod") or "").strip().upper()
            if not kod:
                continue
            tur = str(b.get("tur") or "").strip().lower()
            temiz.append({
                "kod": kod,
                "tur": tur if tur in BAGLANTI_TURLERI else "",
                # "not" artık TARİF değil EYLEM taşır ("MP7'deki ayna imgesini
                # mendille yansıt"), yoksa referans etiket olarak kalıyor.
                "not": str(b.get("not") or "").strip(),
            })
        out["baglantilar"] = temiz

    return out


def normalize_meta(data: Any, alanlar: list) -> dict:
    """TUR/PARÇA mirası için: sadece tanımlı anahtarlar, hepsi düz metin."""
    out = {key: "" for key, _, _ in alanlar}
    if isinstance(data, dict):
        for key, _, _ in alanlar:
            val = data.get(key)
            if isinstance(val, (str, int, float)):
                out[key] = str(val).strip()
    return out


def hucre_bos_mu(data: dict) -> bool:
    """Hiç doldurulmamış hücre - render ve uyarı üretilmez."""
    d = normalize_cell(data)
    if any(d[k] for k in ("olay", "giris", "gelisme", "sonuc", "mekan", "odak")):
        return False
    if d["kisiler"] or d["nesneler"] or d["baglantilar"]:
        return False
    if any(d["zaman"].values()) or any(d["duygu"].values()):
        return False
    return True


# --- Metne dökme -----------------------------------------------------------

def render_cell(data: Any) -> str:
    """Yapılandırılmış hücreyi AI'nın ve yazarın okuyacağı düz metne çevirir.
    MatrixCell.content'e bu yazılır - böylece bağlam katmanı, MP referansı,
    "Plandan Taslak" gibi mevcut mekanizmaların hiçbiri değişmez.

    MİRAS alanları BİLEREK buraya girmez: onlar kolon/satır kaydında durur
    ve bağlam katmanında canlı okunur (ai_context.build_plan_layer). Aksi
    hâlde damga kelimesini değiştirdiğinde 56 hücrenin metni bayatlardı."""
    d = normalize_cell(data)
    if hucre_bos_mu(d):
        return ""
    satirlar = []

    if d["olay"]:
        satirlar.append(f"OLAY: {d['olay']}")

    z = d["zaman"]
    zaman_parca = " ".join(x for x in (z["tarih"], z["saat"]) if x)
    if zaman_parca or z["tip"]:
        tip = ""
        if z["tip"]:
            gorunen = ZAMAN_TIPI_GORUNEN[z["tip"]]
            tip = f" ({gorunen}: {z['sayac']})" if z["sayac"] else f" ({gorunen})"
        satirlar.append(f"ZAMAN: {zaman_parca or '—'}{tip}")

    if d["mekan"]:
        satirlar.append(f"MEKAN: {d['mekan']}")

    duy = d["duygu"]
    if duy["baslangic"] or duy["bitis"]:
        yay = (f"{duy['baslangic']} → {duy['bitis']}"
               if duy["baslangic"] and duy["bitis"]
               else (duy["baslangic"] or duy["bitis"]))
        sahip = f"{duy['kim']}: " if duy["kim"] else ""
        satirlar.append(f"DUYGU: {sahip}{yay}")

    if d["kisiler"]:
        satirlar.append("KİŞİLER: " + ", ".join(k["ad"] for k in d["kisiler"]))
    if d["nesneler"]:
        satirlar.append("NESNELER: " + ", ".join(n["ad"] for n in d["nesneler"]))
    if d["odak"]:
        satirlar.append(f"ODAK: {d['odak']} (dikkat bu nesnede toplanır)")

    for key, etiket, _ in YAY_ALANLARI:
        if d[key]:
            satirlar.append(f"{etiket}: {d[key]}")

    tarif = dict((k, t) for k, _, t in UZUNLUK_SEVIYELERI).get(d["uzunluk"])
    if tarif:
        # Etiket ELDE büyütülür: Python'un upper()'ı Türkçe 'i' harfini 'I'
        # yapıp "UZUN METIN" üretiyor, doğrusu "UZUN METİN".
        etiket = {"ozet": "ÖZET", "normal": "NORMAL", "uzun": "UZUN METİN"}[d["uzunluk"]]
        satirlar.append(f"HEDEF UZUNLUK: {etiket} — {tarif}")

    if d["baglantilar"]:
        parcalar = []
        for b in d["baglantilar"]:
            tur = f" ({b['tur']})" if b["tur"] else ""
            # Eylem varsa ok ile: referans değil, yapılacak iş olduğu belli olsun.
            aciklama = f" → {b['not']}" if b["not"] else ""
            parcalar.append(f"{b['kod']}{tur}{aciklama}")
        satirlar.append("BAĞLANTI: " + " · ".join(parcalar))

    return "\n".join(satirlar)


def render_miras(tur_data: Any, parca_data: Any, row_instructions: str = "") -> str:
    """TUR + PARÇA mirasını bağlam bloğuna çevirir. build_plan_layer bunu
    hücrenin planının ÜSTÜNE koyar: AI her sahnede turun damgasını ve
    parçanın süresini görsün, yazar bunu her hücreye kopyalamasın."""
    tur = normalize_meta(tur_data, TUR_ALANLARI)
    parca = normalize_meta(parca_data, PARCA_ALANLARI)
    satirlar = []

    tur_dolu = [(etiket, tur[key]) for key, etiket, _ in TUR_ALANLARI if tur[key]]
    if tur_dolu:
        satirlar.append("TUR MİRASI (bu turun tamamında geçerli): "
                        + " · ".join(f"{e}: {v}" for e, v in tur_dolu))

    parca_dolu = [(etiket, parca[key]) for key, etiket, _ in PARCA_ALANLARI if parca[key]]
    if parca_dolu:
        satirlar.append("PARÇA MİRASI: " + " · ".join(f"{e}: {v}" for e, v in parca_dolu))

    kurallar = (row_instructions or "").strip()
    if kurallar:
        satirlar.append(f"BU AŞAMANIN YAZIM KISITLARI (uy):\n{kurallar}")

    return "\n".join(satirlar)


# --- Denetim ---------------------------------------------------------------

def cell_warnings(data: Any, tur_data: Any = None) -> list[str]:
    """Eksik/tutarsız alanları listeler. KAYDI ENGELLEMEZ - uygulamanın her
    yerindeki çizgi bu: denetle, göster, karar yazarın olsun. Boş hücre hiç
    uyarı üretmez (henüz yazılmamış olmak bir hata değil)."""
    d = normalize_cell(data)
    if hucre_bos_mu(d):
        return []

    uyarilar = []
    if not d["olay"]:
        uyarilar.append("OLAY boş - sahnenin tek cümlelik kimliği yok")
    for key, etiket, _ in YAY_ALANLARI:
        if not d[key]:
            uyarilar.append(f"{etiket} beat'i boş")
    if not d["mekan"]:
        uyarilar.append("MEKAN seçilmemiş")
    if not d["zaman"]["tip"]:
        uyarilar.append("ZAMAN tipi seçilmemiş (NOKTA / ATLAMA / SAYAÇ)")
    elif d["zaman"]["tip"] in ("SAYAC", "ATLAMA") and not d["zaman"]["sayac"]:
        uyarilar.append(
            f"{ZAMAN_TIPI_GORUNEN[d['zaman']['tip']]} seçilmiş ama "
            + ("neyin sayacı" if d["zaman"]["tip"] == "SAYAC" else "neyden atlandığı")
            + " yazılmamış")
    if not (d["duygu"]["baslangic"] or d["duygu"]["bitis"]):
        uyarilar.append("DUYGU boş")
    elif not d["duygu"]["kim"]:
        uyarilar.append("DUYGU kime ait belirtilmemiş")
    # Birden çok nesne varken odak seçilmezse dikkat dağılır - tek nesnede
    # odak zaten bellidir, uyarmaya gerek yok.
    if len(d["nesneler"]) > 1 and not d["odak"]:
        uyarilar.append(f"ODAK nesnesi seçilmemiş ({len(d['nesneler'])} nesne var)")
    for b in d["baglantilar"]:
        if not b["not"]:
            uyarilar.append(f"{b['kod']} bağlantısı ne yapılacağını söylemiyor")

    # BEAT ŞİŞMESİ: şemada GİRİŞ/GELİŞME/SONUÇ birer ANDIR - açılış,
    # dönme, kapanış. Buraya olay dizisi yazıldığında sahne planlanmış
    # olmaz, yazılmış olur; yazan model sahneyi kurmak yerine verilen
    # diziyi doldurur ve tek yaratıcı alanı doku örmeye iner.
    if len(d["olay"]) > OLAY_SINIRI:
        uyarilar.append("OLAY tek cümleyi aşmış - sahne kimliği özet değil")
    for key, etiket, _ in YAY_ALANLARI:
        if len(d[key]) > BEAT_SINIRI:
            uyarilar.append(f"{etiket} bir beat değil olay dizisi olmuş "
                            f"({len(d[key])} karakter) - yazana kuracak yer bırakmıyor")

    # Damga kilidi: turun damga kelimesi SONUÇ beat'inde asılı kalmalı.
    # KELİME SINIRI şart: alt dize araması damgayı başka bir kelimenin
    # içinde bulup uyarıyı yutuyordu ("ÇÖZÜN" damgası "çözünürlüğü"
    # kelimesinde eşleşiyor, oysa damga hiç düşmemiş oluyor).
    damga = normalize_meta(tur_data, TUR_ALANLARI).get("damga", "")
    if damga and d["sonuc"]:
        kalip = r"(?<!\w)" + re.escape(_tr_lower(damga)) + r"(?!\w)"
        if not re.search(kalip, _tr_lower(d["sonuc"])):
            uyarilar.append(f"Damga kelimesi (\"{damga}\") SONUÇ'ta geçmiyor")

    return uyarilar
