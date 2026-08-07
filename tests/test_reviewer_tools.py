"""Denetçi katmanı + yardımcı özellik testleri: Okur Testi (mock'lu),
nakarat koruması, başlık kaçağı dönüştürücü."""
import json as _json
from unittest.mock import patch, MagicMock

import pytest


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    from app import ratelimit
    ratelimit._calls.clear()
    yield


def _fake_qwen(payload):
    resp = MagicMock()
    resp.choices = [MagicMock(message=MagicMock(content=_json.dumps(payload, ensure_ascii=False)))]
    return resp


# ---- Okur Testi ------------------------------------------------------------

def _chapter_with_text(client, headers, texts, number=1):
    r = client.post("/chapters/", json={"number": number, "title": "B", "kind": "chapter"}, headers=headers)
    ch = r.json()
    for i, t in enumerate(texts, start=1):
        client.put(f"/chapters/{ch['id']}/paragraphs/{i}", json={"number": i, "text": t}, headers=headers)
    return ch


def test_reader_test_returns_findings_and_sanitizes(client, headers):
    ch = _chapter_with_text(client, headers, [
        "Kapı açıldı ve Vicdan içeri girdi.",
        "Bu şehir 1432 yılında kurulmuş, nüfusu 40 milyon, yedi belediyesi vardır ve vergi sistemi şöyledir...",
    ])
    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.return_value = _fake_qwen({"findings": [
            {"paragraph_number": 2, "quote": "vergi sistemi şöyledir", "type": "bilgi_bocasi",
             "severity": "yuksek", "reason": "Gerilimin ortasında ansiklopedik döküm.", "suggestion": "Bilgiyi diyaloga yay."},
            {"paragraph_number": 99, "quote": "yok", "type": "tempo", "severity": "saçma",
             "reason": "Geçersiz paragraf numarası ve severity testi.", "suggestion": ""},
            {"paragraph_number": 1, "quote": "", "type": "klise", "severity": "orta", "reason": "", "suggestion": "x"},
        ]})
        r = client.post(f"/ai/reader-test/{ch['id']}", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["chapter_number"] == 1
    assert len(data["findings"]) == 2  # reason'sız bulgu atıldı
    f1 = data["findings"][0]
    assert f1["paragraph_number"] == 2 and f1["type"] == "bilgi_bocasi" and f1["severity"] == "yuksek"
    f2 = data["findings"][1]
    assert f2["paragraph_number"] is None   # geçersiz numara None'a çevrildi, bulgu atılmadı
    assert f2["severity"] == "orta"          # geçersiz severity varsayılana çekildi


def test_reader_test_empty_chapter_skips_qwen(client, headers):
    r = client.post("/chapters/", json={"number": 1, "title": "Boş", "kind": "chapter"}, headers=headers)
    ch = r.json()
    with patch("app.qwen_client.get_client") as mc:
        r = client.post(f"/ai/reader-test/{ch['id']}", headers=headers)
        mc.assert_not_called()
    assert r.json()["findings"] == []


def test_reader_test_clean_chapter_empty_findings(client, headers):
    ch = _chapter_with_text(client, headers, ["Gayet iyi bir paragraf."])
    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.return_value = _fake_qwen({"findings": []})
        r = client.post(f"/ai/reader-test/{ch['id']}", headers=headers)
    assert r.json()["findings"] == []


# ---- Nakarat koruması ------------------------------------------------------

def test_refrain_counted_but_never_warns(client, headers, novel):
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app.style_scan import build_style_warning_layer

    r = client.post("/style/patterns", json={
        "name": "nakarat: biz size güvendik", "pattern": r"biz size güvendik",
        "threshold_per_1000": 0.5, "min_count": 2, "is_refrain": True,
    }, headers=headers)
    assert r.status_code == 201 and r.json()["is_refrain"] is True

    filler = "kule taş duvar rüzgar yol kapı pencere " * 20
    ch = client.post("/chapters/", json={"number": 1, "title": "B", "kind": "chapter"}, headers=headers).json()
    client.put(f"/chapters/{ch['id']}/paragraphs/1", json={
        "number": 1, "text": ("Biz size güvendik. " * 5) + filler,
    }, headers=headers)

    report = client.post("/style/scan", headers=headers).json()
    nakarat = next(p for p in report["patterns"] if p["is_refrain"])
    assert nakarat["count"] == 5                 # sayılıyor (kontrol için)
    assert nakarat["per_1000"] > nakarat["threshold_per_1000"]
    assert nakarat["exceeded"] is False          # ama ASLA uyarıya dönüşmüyor

    Session = sessionmaker(bind=engine)
    assert "biz size güvendik" not in build_style_warning_layer(Session(), novel["universe_id"])


# ---- Başlık kaçağı dönüştürücü ---------------------------------------------

def test_promote_paragraph_to_subtitle(client, headers):
    ch1 = _chapter_with_text(client, headers, ["# KOLTUKLAR", "Asıl metin burada.", "Devamı."], number=1)
    _chapter_with_text(client, headers, ["Sonraki bölüm."], number=2)

    r = client.post(f"/chapters/{ch1['id']}/promote-paragraph/1?kind=subtitle", headers=headers)
    assert r.status_code == 201, r.text
    heading = r.json()
    assert heading["kind"] == "subtitle"
    assert heading["title"] == "KOLTUKLAR"       # baştaki # temizlendi

    chapters = client.get("/chapters/", headers=headers).json()
    # Sıra: [1: subtitle KOLTUKLAR] [2: eski bölüm] [3: sonraki bölüm]
    assert [(c["number"], c["kind"]) for c in chapters] == [(1, "subtitle"), (2, "chapter"), (3, "chapter")]
    # Paragraf silindi, kalanlar 1'den başlayarak yeniden numaralandı
    moved = client.get(f"/chapters/{ch1['id']}", headers=headers).json()
    texts = [(p["number"], p["text"]) for p in moved["paragraphs"]]
    assert texts == [(1, "Asıl metin burada."), (2, "Devamı.")]


def test_promote_rejects_empty_or_bad_kind(client, headers):
    ch = _chapter_with_text(client, headers, ["###   "], number=1)
    r = client.post(f"/chapters/{ch['id']}/promote-paragraph/1?kind=subtitle", headers=headers)
    assert r.status_code == 400  # #'ler temizlenince boş kalıyor
    ch2 = _chapter_with_text(client, headers, ["# Başlık"], number=2)
    r = client.post(f"/chapters/{ch2['id']}/promote-paragraph/1?kind=banner", headers=headers)
    assert r.status_code == 400


# ---- Zengin varlık çıkarımı (alias + derin profil) -------------------------

def test_extraction_returns_aliases_and_sections_sanitized(client, headers, novel):
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app import models
    from app.qwen_client import suggest_entities_for_chapters

    # Kayıtlı bir karakter + ALIAS'ı: alias yeniden önerilmemeli
    client.post("/characters/", json={"name": "Vicdan", "aliases": ["sistem"]}, headers=headers)
    ch = _chapter_with_text(client, headers, ["Sistem konuştu. Şahin Göz tepedeydi, gri paltolu, tek gözü kapalı."])

    Session = sessionmaker(bind=engine)
    db = Session()
    chapter = db.query(models.Chapter).filter(models.Chapter.id == ch["id"]).first()

    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.return_value = _fake_qwen({"suggestions": [
            {"entity_type": "character", "name": "Şahin Göz",
             "description": "Tepede bekleyen keskin nişancı.",
             "aliases": ["Nişancı", "şahin göz", "", "Nişancı"],
             "sections": {"fiziksel_yapi": "Gri paltolu, tek gözü kapalı.",
                          "atmosfer": "GEÇERSİZ - mekan anahtarı", "meta": "sızmamalı", "gecmis": "  "}},
            {"entity_type": "character", "name": "sistem",  # kayıtlı ALIAS -> elenmeli
             "description": "x", "aliases": [], "sections": {}},
        ]})
        result = suggest_entities_for_chapters(db, [chapter])

    assert len(result) == 1  # "sistem" alias-tekilleştirmeyle elendi
    s = result[0]
    assert s["aliases"] == ["Nişancı"]  # boş, tekrar ve ismin kendisi ayıklandı
    assert s["sections"] == {"fiziksel_yapi": "Gri paltolu, tek gözü kapalı."}  # geçersiz/boş/meta atıldı


def test_approve_creates_with_aliases_and_sections(client, headers):
    r = client.post("/ai/approve-suggestions", json={"suggestions": [{
        "entity_type": "character", "name": "Şahin Göz",
        "description": "Keskin nişancı.",
        "aliases": ["Nişancı"],
        "sections": {"fiziksel_yapi": "Gri paltolu.", "uydurma_anahtar": "atılmalı"},
    }]}, headers=headers)
    assert r.status_code == 201, r.text
    chars = client.get("/characters/", headers=headers).json()
    sg = next(c for c in chars if c["name"] == "Şahin Göz")
    assert sg["aliases"] == ["Nişancı"]
    assert sg["sections"].get("fiziksel_yapi") == "Gri paltolu."
    assert "uydurma_anahtar" not in sg["sections"]


def test_approve_merges_into_existing_without_data_loss(client, headers):
    r = client.post("/characters/", json={
        "name": "Vicdan", "aliases": ["sistem"],
        "sections": {"fiziksel_yapi": "Sesi metalik."},
    }, headers=headers)
    cid = r.json()["id"]
    r = client.post("/ai/approve-suggestions", json={"suggestions": [{
        "entity_type": "character", "name": "Vicdan",
        "description": "Telsize sızabildiği öğrenildi.",
        "aliases": ["yargıç makinesi", "SİSTEM"],  # SİSTEM zaten var (büyük/küçük) -> eklenmemeli
        "sections": {"fiziksel_yapi": "Ekranda mavi bir çizgi olarak belirir."},
        "existing_entity_id": cid,
    }]}, headers=headers)
    assert r.status_code == 201, r.text
    c = next(x for x in client.get("/characters/", headers=headers).json() if x["id"] == cid)
    assert "Telsize sızabildiği" in c["notes"]                      # notlara eklendi
    assert c["aliases"] == ["sistem", "yargıç makinesi"]            # birleşti, çift yok
    assert "Sesi metalik." in c["sections"]["fiziksel_yapi"]        # eski bilgi DURUYOR
    assert "[Bölümden] Ekranda mavi bir çizgi" in c["sections"]["fiziksel_yapi"]  # yenisi etiketle eklendi


# ---- Paragraf balonları (K/M/N anlık tespit) -------------------------------

def test_paragraph_balloons_new_and_existing_enrichment(client, headers):
    # Kayıtlı: Vicdan (alias: sistem). Paragrafta hem yeni bir kişi hem
    # Vicdan hakkında yeni bilgi var.
    client.post("/characters/", json={"name": "Vicdan", "aliases": ["sistem"]}, headers=headers)
    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.return_value = _fake_qwen({"candidates": [
            {"entity_type": "character", "name": "İhtiyar Teknisyen",
             "description": "Kabloları onaran yaşlı adam.",
             "aliases": ["teknisyen"], "sections": {"fiziksel_yapi": "Kambur, yağlı tulumlu."}},
            {"entity_type": "character", "name": "SİSTEM",  # kayıtlı alias, Türkçe büyük harf
             "description": "", "aliases": ["sistem"],
             "sections": {"konusma_tarzi": "Cümlelerini hep soruyla bitirir."}},
            {"entity_type": "place", "name": "Vicdan",  # tip yanlış dese de kayıt kazanır
             "description": "", "aliases": [], "sections": {}},  # yeni bilgi yok -> balon yok
        ]})
        r = client.post("/ai/paragraph-entities", json={
            "text": "İhtiyar teknisyen kabloları onarırken sistem cümlesini yine bir soruyla bitirdi.",
        }, headers=headers)
    assert r.status_code == 200, r.text
    sugs = r.json()["suggestions"]
    assert len(sugs) == 2
    yeni = next(s for s in sugs if s["existing_entity_id"] is None)
    assert yeni["name"] == "İhtiyar Teknisyen" and yeni["entity_type"] == "character"
    assert yeni["sections"]["fiziksel_yapi"].startswith("Kambur")
    mevcut = next(s for s in sugs if s["existing_entity_id"] is not None)
    assert mevcut["name"] == "Vicdan"                 # kanonik ada çözüldü (SİSTEM -> Vicdan)
    assert mevcut["entity_type"] == "character"
    assert mevcut["aliases"] == []                     # "sistem" zaten kayıtlı - eklenmedi
    assert "soruyla bitirir" in mevcut["sections"]["konusma_tarzi"]


def test_paragraph_balloons_short_text_skips_qwen(client, headers):
    with patch("app.qwen_client.get_client") as mc:
        r = client.post("/ai/paragraph-entities", json={"text": "Kısa."}, headers=headers)
        mc.assert_not_called()
    assert r.json()["suggestions"] == []


def test_paragraph_balloon_approve_roundtrip(client, headers):
    """Balon tıklaması: tespit -> approve-suggestions -> kayıt profiliyle doğar."""
    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.return_value = _fake_qwen({"candidates": [
            {"entity_type": "object", "name": "Kül Şişesi", "description": "Sanığın vicdan şişesi.",
             "aliases": ["şişe"], "sections": {"islev": "Yalanla kararır, itirafla durur."}},
        ]})
        sugs = client.post("/ai/paragraph-entities", json={
            "text": "Masada duran kül şişesi, yalan söylendikçe biraz daha karardı.",
        }, headers=headers).json()["suggestions"]
    r = client.post("/ai/approve-suggestions", json={"suggestions": sugs}, headers=headers)
    assert r.status_code == 201
    obj = next(o for o in client.get("/objects/", headers=headers).json() if o["name"] == "Kül Şişesi")
    assert obj["aliases"] == ["şişe"]
    assert "kararır" in obj["sections"]["islev"]


# ---- Kayda özel kurallar ---------------------------------------------------

def test_scoped_rule_only_travels_with_its_entity(client, headers, novel):
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app.qwen_client import build_fixed_layer, build_dynamic_layer
    from app import schemas as sch

    vicdan = client.post("/characters/", json={"name": "Vicdan"}, headers=headers).json()
    toren = client.post("/characters/", json={"name": "Toren"}, headers=headers).json()
    client.post("/rules/", json={"title": "Şişe mekaniği", "description": "Yalan karartır."}, headers=headers)
    r = client.post("/rules/", json={
        "title": "Vicdan yargıç değil", "description": "Hüküm vermez, tutanak tutar.",
        "entity_type": "character", "entity_id": vicdan["id"],
    }, headers=headers)
    assert r.status_code == 201 and r.json()["entity_id"] == vicdan["id"]

    Session = sessionmaker(bind=engine)
    db = Session()
    uid = novel["universe_id"]
    fixed = build_fixed_layer(db, uid)
    assert "Şişe mekaniği" in fixed                # genel kural sabit katmanda
    assert "Vicdan yargıç değil" not in fixed      # kapsamlı kural sabit katmanda DEĞİL

    ref_v = sch.EntityRef(entity_type="character", entity_id=vicdan["id"])
    ref_t = sch.EntityRef(entity_type="character", entity_id=toren["id"])
    dyn_v = build_dynamic_layer(db, uid, [ref_v])
    assert "Vicdan yargıç değil" in dyn_v and "İHLAL ETME" in dyn_v  # sahnedeyken gider
    dyn_t = build_dynamic_layer(db, uid, [ref_t])
    assert "Vicdan yargıç değil" not in dyn_t      # başka kayıtla GİTMEZ


def test_scoped_rule_rejects_bad_type(client, headers):
    r = client.post("/rules/", json={
        "title": "x", "entity_type": "event", "entity_id": 1,
    }, headers=headers)
    assert r.status_code == 422


# ---- Başlıktan metin taşıma (⚠ ayraç içinde metin) -------------------------

def test_move_paragraphs_out_of_heading(client, headers):
    """Bir Bölüm sonradan Kısım'a çevrilince paragrafları onunla kalıyor;
    bu uç onları tek işlemde başlığın ALTINA açılan yeni bir Bölüm'e taşır."""
    ch = _chapter_with_text(client, headers, ["Birinci paragraf.", "İkinci paragraf."], number=1)
    client.post("/chapters/", json={"number": 2, "kind": "chapter", "title": "Sonraki"}, headers=headers)
    # Bölümü Kısım'a çevir -> paragraflar "yetim" kalır
    client.put(f"/chapters/{ch['id']}", json={"kind": "part"}, headers=headers)

    r = client.post(f"/chapters/{ch['id']}/move-paragraphs-out", headers=headers)
    assert r.status_code == 201, r.text
    new_ch = r.json()
    assert new_ch["kind"] == "chapter" and new_ch["number"] == 2  # başlığın hemen altına

    heading = client.get(f"/chapters/{ch['id']}", headers=headers).json()
    assert heading["paragraphs"] == []                      # başlık temizlendi
    moved = client.get(f"/chapters/{new_ch['id']}", headers=headers).json()
    assert [p["text"] for p in moved["paragraphs"]] == ["Birinci paragraf.", "İkinci paragraf."]
    # Sonraki bölüm kaydırıldı, numaralar kesintisiz
    numbers = [c["number"] for c in client.get("/chapters/", headers=headers).json()]
    assert numbers == [1, 2, 3]


def test_move_paragraphs_out_rejects_chapter_and_empty(client, headers):
    ch = _chapter_with_text(client, headers, ["metin"], number=1)
    r = client.post(f"/chapters/{ch['id']}/move-paragraphs-out", headers=headers)
    assert r.status_code == 400  # zaten Bölüm
    part = client.post("/chapters/", json={"number": 2, "kind": "part", "title": "Boş kısım"}, headers=headers).json()
    r = client.post(f"/chapters/{part['id']}/move-paragraphs-out", headers=headers)
    assert r.status_code == 400  # taşınacak paragraf yok


# ---- Yapılandırılmış özet + devamlılık ------------------------------------

def test_summary_includes_previous_chapter_and_structure(client, headers):
    """Özet promptu: (a) bir önceki bölümün özetini bağlam olarak almalı,
    (b) OLAY/MEKAN/ATMOSFER/DUYGU/DEVAMLILIK/KAPANIŞ TONU başlıklarını
    istemeli. Kısım/Alt Başlık girdileri zincire girmemeli."""
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app import models
    from app.qwen_client import summarize_chapter

    ch1 = _chapter_with_text(client, headers, ["İlk bölüm metni."], number=1)
    client.put(f"/chapters/{ch1['id']}", json={"summary": "OLAY: Vicdan salonu açtı. KAPANIŞ TONU: tedirginlik."}, headers=headers)
    client.post("/chapters/", json={"number": 2, "kind": "part", "title": "ARADAKİ KISIM"}, headers=headers)
    ch2 = _chapter_with_text(client, headers, ["İkinci bölüm metni."], number=3)

    db = sessionmaker(bind=engine)()
    chapter = db.query(models.Chapter).filter(models.Chapter.id == ch2["id"]).first()
    captured = {}
    def fake_create(**kwargs):
        captured["system"] = kwargs["messages"][0]["content"]
        captured["user"] = kwargs["messages"][1]["content"]
        resp = MagicMock()
        resp.choices = [MagicMock(message=MagicMock(content="OLAY: ...\nKAPANIŞ TONU: ..."))]
        return resp
    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.side_effect = fake_create
        summarize_chapter(db, chapter)

    for baslik in ("ZAMAN:", "OLAY:", "MEKAN:", "ATMOSFER:", "DUYGU:", "DEVAMLILIK:", "KAPANIŞ TONU:"):
        assert baslik in captured["system"], baslik
    assert "ÖNCEKİ BÖLÜMÜN ÖZETİ" in captured["user"]
    assert "Vicdan salonu açtı" in captured["user"]      # gerçek önceki özet geldi
    assert "ARADAKİ KISIM" not in captured["user"]        # Kısım zincire girmedi
    assert "İkinci bölüm metni." in captured["user"]


def test_summary_first_chapter_has_no_previous_block(client, headers):
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app import models
    from app.qwen_client import summarize_chapter

    ch = _chapter_with_text(client, headers, ["Açılış."], number=1)
    db = sessionmaker(bind=engine)()
    chapter = db.query(models.Chapter).filter(models.Chapter.id == ch["id"]).first()
    captured = {}
    def fake_create(**kwargs):
        captured["user"] = kwargs["messages"][1]["content"]
        resp = MagicMock()
        resp.choices = [MagicMock(message=MagicMock(content="OLAY: ..."))]
        return resp
    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.side_effect = fake_create
        summarize_chapter(db, chapter)
    assert "ÖNCEKİ BÖLÜMÜN ÖZETİ" not in captured["user"]


# ---- Olay gerçekleşme zamanı (kronoloji) -----------------------------------

def test_event_occurred_at_sorting_and_filter(client, headers):
    """Kronoloji occurred_at'e göre kurulur; tarihi olmayanlar SONA düşer
    ki eksikler göze batsın. Anlatı sırası ayrı bir eksendir."""
    payloads = [
        {"name": "Süper bilgisayar aktif", "occurred_at": "2030-06-28T21:00", "story_order": 3000},
        {"name": "Bina çöküşü", "occurred_at": "2023", "story_order": 3001},
        {"name": "Tarihsiz olay", "story_order": 2000},
        {"name": "Ayna kapatıldı", "occurred_at": "2023-02", "story_order": 3002},
    ]
    for p in payloads:
        r = client.post("/events/", json=p, headers=headers)
        assert r.status_code == 201, r.text

    kronolojik = [e["name"] for e in client.get("/events/?sort=occurred", headers=headers).json()]
    assert kronolojik[:3] == ["Bina çöküşü", "Ayna kapatıldı", "Süper bilgisayar aktif"]
    assert kronolojik[-1] == "Tarihsiz olay"   # tarihi olmayan sona

    anlatı = [e["name"] for e in client.get("/events/?sort=story", headers=headers).json()]
    assert anlatı[0] == "Tarihsiz olay"        # story_order 2000 en küçük

    # Güncelleme ile tarih eklenebilmeli
    ev = next(e for e in client.get("/events/", headers=headers).json() if e["name"] == "Tarihsiz olay")
    r = client.put(f"/events/{ev['id']}", json={"occurred_at": "2029-12-31"}, headers=headers)
    assert r.status_code == 200 and r.json()["occurred_at"] == "2029-12-31"
    kronolojik = [e["name"] for e in client.get("/events/?sort=occurred", headers=headers).json()]
    assert kronolojik[-1] == "Süper bilgisayar aktif"  # artık tarihsiz yok


def test_infer_event_date_uses_chapter_summary(client, headers):
    """AI tarih çıkarımı, olayın anlatıldığı bölümün ÖZETİNİ görmeli."""
    ch = _chapter_with_text(client, headers, ["Metin."], number=2)
    client.put(f"/chapters/{ch['id']}", json={
        "summary": "ZAMAN: 28 Haziran 2030, 21:05. Geri dönüş: 2023 depremi (yedi yıl önce).",
    }, headers=headers)
    ev = client.post("/events/", json={"name": "Bina çöküşü", "story_order": 2000}, headers=headers).json()

    captured = {}
    def fake_create(**kwargs):
        captured["user"] = kwargs["messages"][1]["content"]
        return _fake_qwen({"occurred_at": "2023", "story_date": "yedi yıl önce, 2023 depremi", "reasoning": "Özetteki geri dönüş."})
    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.side_effect = fake_create
        r = client.post(f"/events/{ev['id']}/infer-date", headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert data["occurred_at"] == "2023"
    assert "2023 depremi" in data["story_date"]
    assert "ZAMAN: 28 Haziran 2030" in captured["user"]  # bölüm özeti prompt'a girdi
    # Öneri KAYDEDİLMEZ
    assert client.get("/events/", headers=headers).json()[0]["occurred_at"] == ""


def test_single_chapter_entity_suggestion_endpoint(client, headers):
    """Regresyon: /chapters/{id}/suggest-entities ucu YOKTU ama frontend iki
    yerden çağırıyordu - "AI ile varlık öner" sessizce başarısız oluyordu."""
    ch = _chapter_with_text(client, headers, ["İhtiyar teknisyen kabloları onardı."])
    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.return_value = _fake_qwen({"suggestions": [
            {"entity_type": "character", "name": "İhtiyar Teknisyen", "description": "Kabloları onaran adam."},
        ]})
        r = client.post(f"/chapters/{ch['id']}/suggest-entities", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()[0]["name"] == "İhtiyar Teknisyen"

    # Boş bölümde Qwen'e hiç gitmez
    bos = client.post("/chapters/", json={"number": 9, "kind": "chapter", "title": "Boş"}, headers=headers).json()
    with patch("app.qwen_client.get_client") as mc:
        r = client.post(f"/chapters/{bos['id']}/suggest-entities", headers=headers)
        mc.assert_not_called()
    assert r.json() == []
    # Olmayan bölüm 404
    assert client.post("/chapters/999999/suggest-entities", headers=headers).status_code == 404


# ---- Gruplar & Kurumlar (faksiyonlar) --------------------------------------

def test_faction_membership_reaches_context(client, headers, novel):
    """Karakter seçiliyken bağlı olduğu GRUP, rolü ve diğer üyeler AI'ya
    gitmeli - "LÜMEN'e kimler bağlı" bilgisi karakterlerin notlarına
    dağıldığında ters sorgulanamıyordu."""
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app.qwen_client import build_dynamic_layer
    from app import schemas as sch

    tabip = client.post("/characters/", json={"name": "Baş Tabip"}, headers=headers).json()
    baskan = client.post("/characters/", json={"name": "Başkan"}, headers=headers).json()
    f = client.post("/factions/", json={"name": "LÜMEN Yönetimi", "description": "Kâr için protokol dayatan kanat."}, headers=headers).json()
    r = client.post("/faction-memberships/", json={"faction_id": f["id"], "character_id": tabip["id"], "role": "Baş Hekim"}, headers=headers)
    assert r.status_code == 201, r.text
    client.post("/faction-memberships/", json={"faction_id": f["id"], "character_id": baskan["id"], "role": "Kurul Üyesi"}, headers=headers)

    db = sessionmaker(bind=engine)()
    ref = sch.EntityRef(entity_type="character", entity_id=tabip["id"])
    ctx = build_dynamic_layer(db, novel["universe_id"], [ref])
    assert "LÜMEN Yönetimi" in ctx
    assert "rolü: Baş Hekim" in ctx
    assert "Kâr için protokol dayatan" in ctx      # grubun kendi profili
    assert "Başkan (Kurul Üyesi)" in ctx           # diğer üyeler de görünür

    # Aynı üyelik iki kez eklenemez
    r = client.post("/faction-memberships/", json={"faction_id": f["id"], "character_id": tabip["id"]}, headers=headers)
    assert r.status_code == 400


def test_literary_review_ten_criteria(client, headers):
    """10 ölçütlü değerlendirme: geçersiz anahtarlar ayıklanır, puan 1-5
    aralığına çekilir, ortalama hesaplanır, düzeltmeler sıralanır."""
    ch = _chapter_with_text(client, headers, [
        "Bir çeşme. Tarihi. Taş.",
        "Suyu yeşilimsi, yosun tutmuş.",
    ])
    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.return_value = _fake_qwen({
            "scores": [
                {"key": "betimleme", "score": 4, "reason": "Somut detay var."},
                {"key": "dil_ekonomisi", "score": 5, "reason": "Fazla kelime yok."},
                {"key": "alt_metin", "score": 1, "reason": "Her şey açıkça söyleniyor."},
                {"key": "uydurma_olcut", "score": 5, "reason": "geçersiz"},
                {"key": "ritim", "score": 9, "reason": "aralık dışı"},
            ],
            "strongest": "Telgraf ritmi karakterin sesine uyuyor.",
            "fixes": [
                {"criterion": "Alt metin", "paragraph": 2, "problem": "Yosun doğrudan anlatılmış.", "fix": "Bakan karakterin tepkisiyle göster."},
                {"criterion": "", "paragraph": None, "problem": "", "fix": ""},
            ],
        })
        r = client.post(f"/ai/literary-review/{ch['id']}", headers=headers)
    assert r.status_code == 200, r.text
    d = r.json()
    keys = [s["key"] for s in d["scores"]]
    assert "uydurma_olcut" not in keys           # geçersiz ölçüt ayıklandı
    assert next(s for s in d["scores"] if s["key"] == "ritim")["score"] == 5   # 9 -> 5
    assert next(s for s in d["scores"] if s["key"] == "alt_metin")["label"] == "Alt metin"
    assert d["average"] == round((4 + 5 + 1 + 5) / 4, 2)
    assert len(d["fixes"]) == 1 and d["fixes"][0]["paragraph"] == 2
    assert "Telgraf ritmi" in d["strongest"]


def test_literary_review_empty_chapter(client, headers):
    bos = client.post("/chapters/", json={"number": 7, "kind": "chapter", "title": "Boş"}, headers=headers).json()
    with patch("app.qwen_client.get_client") as mc:
        r = client.post(f"/ai/literary-review/{bos['id']}", headers=headers)
        mc.assert_not_called()
    assert r.json()["scores"] == [] and r.json()["average"] == 0


def test_structure_scan_chain_analysis(client, headers):
    """Bölümler arası yapısal denetim: özetlerle çalışır, özetsiz bölümleri
    kör nokta olarak bildirir, 2'den az özet varsa Qwen'e hiç gitmez."""
    from app.qwen_client import structure_scan
    from sqlalchemy.orm import sessionmaker
    from app.database import engine

    db_maker = sessionmaker(bind=engine)
    novel_id = int(headers["X-Novel-Id"])

    # Tek özet: tarama çalışmaz, Qwen'e gidilmez
    ch1 = _chapter_with_text(client, headers, ["Metin bir."], number=1)
    client.put(f"/chapters/{ch1['id']}", json={"summary": "OLAY: Vicdan uyanır."}, headers=headers)
    with patch("app.qwen_client.get_client") as mc:
        r = client.post("/ai/structure-scan", headers=headers)
        mc.assert_not_called()
    assert "en az 2 özetli bölüm" in r.json()["summary"]

    # İki özet + özetsiz bir bölüm
    ch2 = _chapter_with_text(client, headers, ["Metin iki."], number=2)
    client.put(f"/chapters/{ch2['id']}", json={"summary": "OLAY: Başkan sorgulanır."}, headers=headers)
    _chapter_with_text(client, headers, ["Özetsiz metin."], number=3)

    captured = {}
    def fake_create(**kwargs):
        captured["user"] = kwargs["messages"][1]["content"]
        return _fake_qwen({
            "causality": [{"from": 1, "to": 2, "link": "ve sonra", "problem": "Bağ zayıf.", "fix": "1. bölümün sonucu 2'nin hedefini doğursun."}],
            "repetition": [{"chapters": [1, 2], "problem": "Aynı sorgu tekrarı.", "fix": "İkincide bahsi yükselt."}],
            "stakes": {"trend": "sabit", "comment": "Tehdit artmıyor."},
            "dead_zones": [{"chapter": 2, "reason": "Çıkarılsa fark edilmez.", "fix": "Sonuç ekle."}],
            "endings": [{"chapter": 1, "problem": "Soru bırakmıyor.", "fix": "Eşikte kapat."}],
            "summary": "Zincir zayıf.",
        })
    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.side_effect = fake_create
        r = client.post("/ai/structure-scan", headers=headers)
    d = r.json()
    assert d["causality"][0]["from"] == 1 and d["causality"][0]["link"] == "ve sonra"
    assert d["repetition"][0]["chapters"] == [1, 2]
    assert d["stakes"]["trend"] == "sabit"
    assert d["missing_summaries"] == [3]          # özetsiz bölüm bildirildi
    assert "Vicdan uyanır" in captured["user"]    # özetler prompt'a girdi
    assert "Özetsiz metin" not in captured["user"]  # METİN gönderilmedi (ucuz)


def test_verify_rewrite_catches_lost_facts(client, headers):
    """Kabul kontrolü: somut detay kaybı DETERMİNİSTİK yakalanır (AI'ya
    sorulmaz) ve AI 'kabul' dese bile karar 'duzelt'e çekilir."""
    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.return_value = _fake_qwen(
            {"verdict": "kabul", "issues": [], "note": "Akış korunmuş."})
        r = client.post("/ai/verify-rewrite", json={
            "old_text": "On santimetrelik cam. Vicdan 47. blokta bekliyordu.",
            "new_text": "Kalın bir cam vardı. Sistem blokta bekliyordu.",
            "purpose": "Mekanı tehditkâr göstermek",
        }, headers=headers)
    d = r.json()
    assert d["verdict"] == "duzelt"                      # AI kabul dedi ama sert bulgu var
    metin = " ".join(d["hard_issues"])
    assert "47" in metin                                  # düşen sayı yakalandı
    assert "Vicdan" in metin                              # düşen özel isim yakalandı


def test_verify_rewrite_passes_clean_rewrite(client, headers):
    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.return_value = _fake_qwen(
            {"verdict": "kabul", "issues": [], "note": "İşlevini yerine getiriyor."})
        r = client.post("/ai/verify-rewrite", json={
            "old_text": "On santimetrelik cam. Vicdan bekliyordu.",
            "new_text": "On santimetrelik cam, ışığı kırıyordu. Vicdan bekliyordu.",
        }, headers=headers)
    d = r.json()
    assert d["verdict"] == "kabul" and not d["hard_issues"]


def test_long_chapter_scanned_in_chunks(client, headers):
    """KAPSAMA: uzun bölüm parça parça taranır ve kaç paragrafın
    incelendiği raporlanır. Eskiden metin sessizce kırpılıyor, 100
    paragraflık bölümün ancak ilk üçte biri değerlendiriliyordu."""
    # 30 paragraf x ~1100 karakter = ~33k karakter -> en az 3 dilim
    uzun = ["Bu bir dolgu paragrafıdır. " * 40 for _ in range(30)]
    ch = _chapter_with_text(client, headers, uzun)

    cagri = {"n": 0}
    def fake_create(**kwargs):
        cagri["n"] += 1
        return _fake_qwen({
            "scores": [{"key": "ritim", "score": 3 if cagri["n"] == 1 else 5, "reason": f"parça {cagri['n']}"}],
            "strongest": "Tempo", "fixes": [{"criterion": "Ritim", "paragraph": cagri["n"], "problem": "x", "fix": "y"}],
        })
    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.side_effect = fake_create
        r = client.post(f"/ai/literary-review/{ch['id']}", headers=headers)
    d = r.json()
    assert cagri["n"] > 1, "uzun bölüm tek istekte gönderilmemeli"
    assert d["chunks"] == cagri["n"]
    assert d["scanned"] == 30 and d["total"] == 30      # TAMAMI tarandı
    assert next(s for s in d["scores"] if s["key"] == "ritim")["score"] == 4   # ortalama
    assert len(d["fixes"]) == cagri["n"]                # her parçanın bulgusu korundu
