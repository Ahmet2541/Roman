"""Üslup taraması (yazım tiki dedektörü) testleri.

Kapsam: varsayılan tohumlama, regex doğrulama, sayım doğruluğu (Türkçe
ekli haller dahil), ÇİFT eşik kuralı (yoğunluk VE mutlak sayı), önbellek,
en yoğun bölüm sıralaması, disabled kalıbın atlanması ve uyarıların AI
context'ine gerçekten enjekte edilmesi (context-preview üzerinden uçtan uca).
"""
import pytest
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.style_scan import build_style_warning_layer


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """/style/scan dakikada 4 ile sınırlı (kasıtlı) - ama bu test dosyası
    tek pytest koşusunda 4'ten fazla tarama tetikliyor ve aynı kullanıcıyla
    429'a takılıyor. Üretim davranışını değiştirmek yerine testler arasında
    bellek-içi sayacı sıfırlıyoruz."""
    from app import ratelimit
    ratelimit._calls.clear()
    yield


def _db():
    Session = sessionmaker(bind=engine)
    return Session()


# Dolgu metin: hiçbir varsayılan kalıbı içermeyen nötr kelimeler. Yoğunluk
# hesabının payda tarafını (kelime sayısı) gerçekçi tutmak için kullanılır.
_FILLER = ("kule uzaktan görünüyordu ve rüzgar taş duvarları dövüyordu "
           "kapılar ağırdı pencereler karanlıktı yol upuzundu ") * 5  # ~50 kelime


def _make_chapter(client, headers, number: int, text: str, title: str = "B"):
    r = client.post("/chapters/", json={"number": number, "title": f"{title}{number}", "kind": "chapter"}, headers=headers)
    assert r.status_code == 201, r.text
    ch = r.json()
    r = client.put(f"/chapters/{ch['id']}/paragraphs/1", json={"number": 1, "text": text}, headers=headers)
    assert r.status_code in (200, 201), r.text
    return ch


def test_defaults_seeded_on_first_list(client, headers):
    r = client.get("/style/patterns", headers=headers)
    assert r.status_code == 200, r.text
    names = [p["name"] for p in r.json()]
    assert len(names) == 11
    assert any("gibi" in n for n in names)
    assert any("sanki" in n for n in names)
    assert any("üçleme" in n for n in names)  # yapısal kalıplar da tohumlanır
    # İkinci çağrı tekrar tohumlamamalı (idempotent)
    r = client.get("/style/patterns", headers=headers)
    assert len(r.json()) == 11


def test_invalid_regex_rejected(client, headers):
    r = client.post("/style/patterns", json={"name": "bozuk", "pattern": "([açık parantez"}, headers=headers)
    assert r.status_code == 400
    assert "Geçersiz regex" in r.json()["detail"]
    # Güncellemede de aynı koruma
    r = client.post("/style/patterns", json={"name": "sağlam", "pattern": r"\btest\b"}, headers=headers)
    pid = r.json()["id"]
    r = client.put(f"/style/patterns/{pid}", json={"pattern": "(yine bozuk"}, headers=headers)
    assert r.status_code == 400


def test_scan_counts_suffixed_forms_and_caches(client, headers):
    # 8 "gibi" (ekli haller dahil) + ~250 kelime dolgu -> binde ~30, eşik 3.0
    # ve min_count 5'in ikisini de aşar -> exceeded=True beklenir.
    tik = ("Bina bir dev gibi duruyordu. Cam bir ayna gibiydi. Rüzgar bir çığlık "
           "gibi esiyordu. Kapı bir ağız gibiydi. Işık bir bıçak gibi kesiyordu. "
           "Gece bir örtü gibiydi. Ses bir fısıltı gibi geliyordu. Sabah bir vaat gibiydi. ")
    _make_chapter(client, headers, 1, tik + _FILLER)

    r = client.post("/style/scan", headers=headers)
    assert r.status_code == 200, r.text
    report = r.json()
    assert report["scanned"] is True
    assert report["chapter_count"] == 1
    gibi = next(p for p in report["patterns"] if "gibi" in p["name"])
    # 4 yalın "gibi" + 4 "gibiydi" -> ekli haller de sayılmalı
    assert gibi["count"] == 8
    assert gibi["exceeded"] is True
    assert gibi["worst_chapters"][0]["label"] == "Bölüm 1"
    assert gibi["worst_chapters"][0]["count"] == 8

    # GET /report önbellekten AYNI sonucu vermeli (yeniden tarama yapmadan)
    r = client.get("/style/report", headers=headers)
    cached = r.json()
    assert cached["scanned"] is True
    cached_gibi = next(p for p in cached["patterns"] if "gibi" in p["name"])
    assert cached_gibi["count"] == 8


def test_min_count_guards_short_text_false_alarm(client, headers):
    # ~55 kelimede TEK "sanki": binde ~18 (eşik 1.5'in çok üstünde) ama
    # mutlak sayı 1 < min_count 4 -> exceeded OLMAMALI. Bu, kısa metinde
    # yoğunluğun patlaması hatasının kalıcı regresyon testi.
    _make_chapter(client, headers, 1, "Sanki her şey yolundaydı. " + _FILLER)
    report = client.post("/style/scan", headers=headers).json()
    sanki = next(p for p in report["patterns"] if "sanki" in p["name"])
    assert sanki["count"] == 1
    assert sanki["per_1000"] > sanki["threshold_per_1000"]  # yoğunluk aşıyor...
    assert sanki["exceeded"] is False                        # ...ama min_count kurtarıyor


def test_report_before_any_scan(client, headers):
    r = client.get("/style/report", headers=headers)
    assert r.status_code == 200
    assert r.json()["scanned"] is False


def test_clean_text_no_warning_dirty_text_injects_into_context(client, headers, novel):
    """Uçtan uca: temiz metinde context'e uyarı GİRMEZ; tikli metin taranınca
    context-preview'da ÜSLUP UYARILARI katmanı belirir."""
    _make_chapter(client, headers, 1, _FILLER)
    client.post("/style/scan", headers=headers)

    db = _db()
    assert build_style_warning_layer(db, novel["universe_id"]) == ""
    r = client.post("/ai/context-preview", json={"selected_entities": []}, headers=headers)
    assert "ÜSLUP UYARILARI" not in r.json()["context"]

    # Şimdi tikli bir bölüm ekle ve yeniden tara
    tik = ("O bir kahraman gibiydi. Gökyüzü deniz gibiydi. Sessizlik taş gibiydi. "
           "Zaman su gibi akıyordu. Korku gölge gibi yayılıyordu. Umut ışık gibiydi. ")
    _make_chapter(client, headers, 2, tik + _FILLER)
    client.post("/style/scan", headers=headers)

    db = _db()
    warning = build_style_warning_layer(db, novel["universe_id"])
    assert "ÜSLUP UYARILARI" in warning
    assert "gibi" in warning
    assert "Bölüm 2" in warning  # en yoğun bölüm işaret edilmeli

    r = client.post("/ai/context-preview", json={"selected_entities": []}, headers=headers)
    assert "ÜSLUP UYARILARI" in r.json()["context"]


def test_worst_chapters_ordered_by_count(client, headers):
    # Bölüm 2'de 6, Bölüm 1'de 3 "sanki" -> en yoğun listesi 2'yi önce vermeli
    _make_chapter(client, headers, 1, ("sanki rüzgar durdu. " * 3) + _FILLER)
    _make_chapter(client, headers, 2, ("sanki zaman durdu. " * 6) + _FILLER)
    report = client.post("/style/scan", headers=headers).json()
    sanki = next(p for p in report["patterns"] if "sanki" in p["name"])
    assert sanki["count"] == 9
    labels = [w["label"] for w in sanki["worst_chapters"]]
    assert labels == ["Bölüm 2", "Bölüm 1"]
    assert sanki["worst_chapters"][0]["count"] == 6
    assert sanki["exceeded"] is True  # 9 tekrar, min_count 4'ün üstünde


def test_disabled_pattern_skipped(client, headers):
    patterns = client.get("/style/patterns", headers=headers).json()
    sanki = next(p for p in patterns if "sanki" in p["name"])
    client.put(f"/style/patterns/{sanki['id']}", json={"enabled": False}, headers=headers)

    _make_chapter(client, headers, 1, ("sanki her şey bitti. " * 6) + _FILLER)
    report = client.post("/style/scan", headers=headers).json()
    assert not any("sanki" in p["name"] for p in report["patterns"])


def test_custom_pattern_and_threshold_update(client, headers):
    # Kullanıcının kendi tikini eklemesi: "bir an için"
    r = client.post("/style/patterns", json={
        "name": "'bir an için'", "pattern": r"\bbir an için\b",
        "threshold_per_1000": 1.0, "min_count": 3,
    }, headers=headers)
    assert r.status_code == 201
    pid = r.json()["id"]

    _make_chapter(client, headers, 1, ("Bir an için durdu. " * 4) + _FILLER)
    report = client.post("/style/scan", headers=headers).json()
    custom = next(p for p in report["patterns"] if p["pattern_id"] == pid)
    assert custom["count"] == 4
    assert custom["exceeded"] is True

    # min_count yükseltilince aynı metin artık eşiği aşmamalı
    client.put(f"/style/patterns/{pid}", json={"min_count": 10}, headers=headers)
    report = client.post("/style/scan", headers=headers).json()
    custom = next(p for p in report["patterns"] if p["pattern_id"] == pid)
    assert custom["exceeded"] is False


def test_turkish_case_insensitivity(client, headers):
    # Cümle başı "Sanki" ve TAMAMEN BÜYÜK "SANKİ" (Türkçe İ!) de sayılmalı -
    # _tr_lower'ın varlık sebebi. Ayrıca min_count'u geçecek kadar tekrar var.
    text = "Sanki bitti. SANKİ RÜYAYDI. sanki gerçekti. Sanki dündü. sanki hiç olmamıştı. " + _FILLER
    _make_chapter(client, headers, 1, text)
    report = client.post("/style/scan", headers=headers).json()
    sanki = next(p for p in report["patterns"] if "sanki" in p["name"])
    assert sanki["count"] == 5


def test_structural_patterns_catch_real_tics(client, headers):
    """Gerçek yazımda yakalanan yapısal tikler (üçleme, jest tekrarı) -
    kelime değil SÖZDİZİMİ kalıpları. Bunlar sahneler ARASINDA oluştuğu
    için tek bölümde göze çarpmaz; seri geneli tarama bu yüzden şart."""
    metin = (
        "Ses aynı tonda, aynı hızda, aynı sakinlikle devam etti. "
        "Cihaza baktı. Meydana baktı. Ekrana baktı. "
        "Eli, kumaşın üzerinde bir kez gezindi. "
        "Parmağı, halkanın altında bir kez gezindi. "
        "Bir an. Sadece bir an. "
        "Ses yine aynı tonda, aynı hızda, aynı soğuklukla sürdü. "
        "Bir an. Sadece bir an. "
    ) + _FILLER
    _make_chapter(client, headers, 1, metin)
    report = client.post("/style/scan", headers=headers).json()
    by_name = {p["name"]: p for p in report["patterns"]}

    ucleme = next(p for n, p in by_name.items() if "aynı X" in n)
    assert ucleme["count"] == 2 and ucleme["exceeded"] is True
    jest = next(p for n, p in by_name.items() if "gezindi" in n)
    assert jest["count"] == 2 and jest["exceeded"] is True
    fragman = next(p for n, p in by_name.items() if "Bir an" in n)
    assert fragman["count"] == 2 and fragman["exceeded"] is True
    # Uyarı metni "asla kullanma" değil BÜTÇE dili kullanmalı
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app.style_scan import build_style_warning_layer
    novel_id = int(headers["X-Novel-Id"])
    from app import models
    db = sessionmaker(bind=engine)()
    uid = db.query(models.Novel).filter(models.Novel.id == novel_id).first().universe_id
    warning = build_style_warning_layer(db, uid)
    assert "EN FAZLA BİR KEZ" in warning
    assert "kötü araçlar DEĞİL" in warning
