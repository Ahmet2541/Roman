"""TASLAK DENETİMİ: plandan üretilen metni ONAY ÖNCESİ kontrol eder.

Dört denetim, hepsi DETERMİNİSTİK - hiçbiri AI çağrısı yapmaz. Sebep:
onay anında bekletmemek ve 128 sahnelik bir üretimde maliyeti üçe
katlamamak. AI gerektiren denetimler (okur testi, edebî değerlendirme,
yapısal akış) elle çalıştırılmaya devam eder.

Hiçbiri kaydı ENGELLEMEZ. Uygulamanın her yerindeki çizgi aynı: denetle,
göster, kararı yazara bırak.

    1. PLANA SADAKAT   planda olmayan kayıtlı varlık metne girmiş mi
    2. ZAMAN ÇİZGİSİ   sahne saatiyle çelişen ifade, gelecek sızdıran kalıp
    3. BEAT KAPSAMA    planın beat'leri metinde karşılık bulmuş mu
    4. TEKRAR          aynı cümle kalıbı / aynı kelime aşırı tekrarlanmış mı
"""
import re
from collections import Counter

from . import models, plan_schema, story_time

# Günün saatiyle çelişebilecek ifadeler: (kelimeler, geçerli saat aralığı)
_GUN_ISARETLERI = [
    (("şafak", "safak", "gün doğ", "gun dog", "sabahın ilk", "sabahin ilk"), (4, 8)),
    (("sabah", "kuşluk", "kusluk"), (5, 11)),
    (("öğle", "ogle", "öğlen", "oglen"), (11, 15)),
    (("ikindi",), (14, 18)),
    (("akşam", "aksam", "gün batı", "gun bati", "alacakaranlık",
      "alacakaranlik", "güneşin son", "gunesin son"), (17, 21)),
    (("gece", "gece yarısı", "gece yarisi", "karanlık çök", "karanlik cok"), (21, 4)),
]

# Geleceği söylemenin kılık değiştirmiş hâlleri. Sistem yönergesinde
# yasaklı ama model yine de kaçamak yol buluyordu ("adı henüz yoktu").
_GELECEK_KALIPLARI = (
    "henüz bilmiyordu", "henuz bilmiyordu", "bilmiyordu ki", "olacaktı",
    "olacakti", "bir daha asla", "ileride anlayacak", "son kez",
    "bilseydi", "fark etmedi ama", "farketmedi ama", "henüz adını",
    "henuz adini", "adını almamış", "adini almamis", "henüz adı yok",
    "henuz adi yok",
)


def _tr_lower(metin: str) -> str:
    return (metin or "").replace("İ", "i").replace("I", "ı").lower()


def _kelime_var(metin_kucuk: str, ad: str) -> bool:
    """Kelime sınırıyla arar - 'usta' kelimesi 'ustalık' içinde saymasın."""
    if len(ad.strip()) < 3:
        return False
    kalip = r"(?<!\w)" + re.escape(_tr_lower(ad)) + r"(?!\w)"
    return bool(re.search(kalip, metin_kucuk))


def _plana_sadakat(db, metin_kucuk, plan, universe_id, sahne_zamani) -> list:
    """Planda olmayan kayıtlı varlık metne girmiş mi?

    Sadece KAYITLI varlıklara bakar: metinde geçen her ismi denetlemek
    yanlış alarm üretir (yan karakterler, geçici adlar). Kayıtlı olup
    planda olmayan bir varlık ise gerçek bir sapmadır.
    """
    from .entities import ENTITY_MODELS

    bulgular = []
    plandaki = {_tr_lower(k["ad"]) for k in plan["kisiler"]}
    plandaki |= {_tr_lower(n["ad"]) for n in plan["nesneler"]}
    if plan["mekan"]:
        plandaki.add(_tr_lower(plan["mekan"]))

    for tip, etiket in (("character", "kişi"), ("place", "mekan"), ("object", "nesne")):
        model = ENTITY_MODELS.get(tip)
        if model is None:
            continue
        for kayit in db.query(model).filter(model.universe_id == universe_id).all():
            adlar = [kayit.name] + [a for a in (kayit.aliases or []) if str(a).strip()]
            gecen = next((a for a in adlar if _kelime_var(metin_kucuk, str(a))), None)
            if not gecen:
                continue
            if any(_tr_lower(str(a)) in plandaki for a in adlar):
                continue

            # Sahne anında var olmayan varlık: bu sapma değil HATA.
            var = story_time.parse_tarih(getattr(kayit, "var_olus", "") or "")
            if var is not None and sahne_zamani is not None and sahne_zamani < var:
                bulgular.append({
                    "tur": "hata", "denetim": "Plana sadakat",
                    "mesaj": f"\"{kayit.name}\" bu sahnede HENÜZ YOK "
                             f"({kayit.var_olus}) ama metinde geçiyor.",
                })
            else:
                bulgular.append({
                    "tur": "uyari", "denetim": "Plana sadakat",
                    "mesaj": f"\"{kayit.name}\" ({etiket}) planda yok ama metinde "
                             f"geçiyor — sahneye plan dışı varlık girmiş olabilir.",
                })
    return bulgular


def _zaman_cizgisi(metin_kucuk, plan) -> list:
    """Sahne saatiyle çelişen ifade ve gelecek sızdıran kalıplar."""
    bulgular = []

    saat_ham = (plan["zaman"].get("saat") or "").strip()
    m = re.match(r"(\d{1,2})[:.](\d{2})", saat_ham)
    if m:
        saat = int(m.group(1))
        for kelimeler, (bas, son) in _GUN_ISARETLERI:
            gecen = next((k for k in kelimeler if k in metin_kucuk), None)
            if not gecen:
                continue
            uygun = (bas <= saat < son) if bas < son else (saat >= bas or saat < son)
            if not uygun:
                bulgular.append({
                    "tur": "hata", "denetim": "Zaman çizgisi",
                    "mesaj": f"Sahne saat {saat_ham} ama metinde \"{gecen}\" geçiyor "
                             f"— günün saatiyle çelişiyor.",
                })

    for kalip in _GELECEK_KALIPLARI:
        if kalip in metin_kucuk:
            bulgular.append({
                "tur": "hata", "denetim": "Zaman çizgisi",
                "mesaj": f"\"{kalip}\" — geleceği sızdıran kalıp. Bu sahnede "
                         f"yalnızca bu ana kadar olmuş şeyler bilinir.",
            })
            break   # bir tanesi yeter, liste şişmesin
    return bulgular


def _beat_kapsama(metin_kucuk, plan) -> list:
    """Planın beat'leri metinde karşılık bulmuş mu?

    Beat'in ayırt edici kelimelerinden hiçbiri metinde geçmiyorsa o beat
    atlanmış olabilir. Kesin değil (model başka kelimelerle yazmış
    olabilir) - o yüzden 'uyarı', 'hata' değil.
    """
    bulgular = []
    for anahtar, etiket, _ in plan_schema.YAY_ALANLARI:
        for i, beat in enumerate(plan[anahtar], start=1):
            kelimeler = [
                k for k in re.findall(r"[\wçğıöşüÇĞİÖŞÜ]{5,}", _tr_lower(beat))
            ][:8]
            if not kelimeler:
                continue
            if not any(k[:5] in metin_kucuk for k in kelimeler):
                sira = f" {i}" if len(plan[anahtar]) > 1 else ""
                bulgular.append({
                    "tur": "uyari", "denetim": "Beat kapsama",
                    "mesaj": f"{etiket}{sira} metinde karşılık bulmamış olabilir: "
                             f"\"{beat[:60]}\"",
                })
    return bulgular


def _tekrar(metin) -> list:
    """Aynı kelimenin ya da cümle başlangıcının aşırı tekrarı."""
    bulgular = []
    kelimeler = re.findall(r"[\wçğıöşüÇĞİÖŞÜ]{6,}", _tr_lower(metin))
    if kelimeler:
        for kelime, adet in Counter(kelimeler).most_common(3):
            # 6+ harfli bir kelime 4+ kez geçiyorsa göze batar
            if adet >= 4:
                bulgular.append({
                    "tur": "uyari", "denetim": "Tekrar",
                    "mesaj": f"\"{kelime}\" {adet} kez geçiyor.",
                })

    cumleler = [c.strip() for c in re.split(r"[.!?]\s+", metin) if c.strip()]
    baslangiclar = Counter(_tr_lower(" ".join(c.split()[:2])) for c in cumleler if c.split())
    for bas, adet in baslangiclar.most_common(2):
        if adet >= 3 and len(bas) > 3:
            bulgular.append({
                "tur": "uyari", "denetim": "Tekrar",
                "mesaj": f"{adet} cümle \"{bas}...\" ile başlıyor.",
            })
    return bulgular


def denetle(db, universe_id: int, novel_id: int, chapter_id: int, metin: str) -> dict:
    """Dört denetimi çalıştırır. Plan yoksa yalnızca tekrar denetimi koşar."""
    metin = (metin or "").strip()
    if not metin:
        return {"bulgular": [], "denetim_sayisi": 0}

    metin_kucuk = _tr_lower(metin)
    bulgular = list(_tekrar(metin))

    hucreler = (db.query(models.MatrixCell)
                .filter(models.MatrixCell.chapter_id == chapter_id).all())
    if not hucreler:
        return {"bulgular": bulgular, "denetim_sayisi": 1}

    # Bölüme birden çok hücre bağlıysa hepsinin varlıkları meşrudur;
    # beat kapsaması ise hücre hücre bakılır.
    birlesik = plan_schema.bos_hucre()
    sahne_zamani = None
    for h in hucreler:
        d = plan_schema.normalize_cell(h.data)
        birlesik["kisiler"] += d["kisiler"]
        birlesik["nesneler"] += d["nesneler"]
        if d["mekan"] and not birlesik["mekan"]:
            birlesik["mekan"] = d["mekan"]
        if not birlesik["zaman"]["saat"]:
            birlesik["zaman"] = d["zaman"]
        for anahtar, _, _ in plan_schema.YAY_ALANLARI:
            birlesik[anahtar] += d[anahtar]
        z = story_time.hucreden_zaman(h.data)
        if z is not None and (sahne_zamani is None or z < sahne_zamani):
            sahne_zamani = z

    bulgular += _plana_sadakat(db, metin_kucuk, birlesik, universe_id, sahne_zamani)
    bulgular += _zaman_cizgisi(metin_kucuk, birlesik)
    bulgular += _beat_kapsama(metin_kucuk, birlesik)

    # Aynı mesaj iki denetimden gelirse bir kez göster.
    gorulen, temiz = set(), []
    for b in bulgular:
        if b["mesaj"] in gorulen:
            continue
        gorulen.add(b["mesaj"])
        temiz.append(b)
    return {"bulgular": temiz[:20], "denetim_sayisi": 4}
