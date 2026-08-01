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

    for baslik in ("OLAY:", "MEKAN:", "ATMOSFER:", "DUYGU:", "DEVAMLILIK:", "KAPANIŞ TONU:"):
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
