"""Plan Matrisi testleri.

Kapsam: matris kurulumu (kolonlar+satırlar tek istekte), hücre upsert,
fihrist üretimi (kolon=KISIM, kolon×satır=BÖLÜM, hücreler otomatik bağlı,
mevcut fihriste dokunmadan SONA ekleme, ikinci basışta 400), ve asıl
mesele: bağlı hücrenin planının SADECE o bölüm yazılırken context'e
girmesi (başka bölümde girmemesi).
"""
import pytest


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """/matrix/{id}/ai-fill 5 dakikada 3 ile sınırlı (kasıtlı - kolon başına
    gerçek AI isteği atar). Bu dosya sınırı tek koşuda aşıyor; üretim
    davranışını değiştirmek yerine sayaç testler arasında sıfırlanır
    (test_style_scan.py ile aynı yaklaşım)."""
    from app import ratelimit
    ratelimit._calls.clear()
    yield



def _make_matrix(client, headers, cols=("TUR 1: BAŞKAN", "TUR 2: JEOLOG"), rows=("1. Hologram", "2. Kamera+Soru", "3. Dışarıda")):
    r = client.post("/matrix/", json={
        "name": "Tur Yapısı",
        "columns": [{"label": c} for c in cols],
        "rows": [{"label": x} for x in rows],
    }, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def test_create_matrix_with_columns_and_rows(client, headers):
    m = _make_matrix(client, headers)
    assert [c["label"] for c in m["columns"]] == ["TUR 1: BAŞKAN", "TUR 2: JEOLOG"]
    assert [r["position"] for r in m["rows"]] == [1, 2, 3]
    assert m["cells"] == []
    # Listede özet sayılar
    lst = client.get("/matrix/", headers=headers).json()
    assert lst[0]["column_count"] == 2 and lst[0]["row_count"] == 3


def test_cell_upsert_creates_then_updates(client, headers):
    m = _make_matrix(client, headers)
    col, row = m["columns"][0], m["rows"][0]
    r = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": col["id"], "row_id": row["id"],
        "content": "5 görüntü: Mahalle → Makam. Anahtar: ÇÖZÜN.",
    }, headers=headers)
    assert r.status_code == 200
    r = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": col["id"], "row_id": row["id"],
        "content": "GÜNCELLENDİ: 5 görüntü + tarih damgaları.",
    }, headers=headers)
    assert r.json()["content"].startswith("GÜNCELLENDİ")
    # Aynı hücreye ikinci kayıt AÇILMADI (upsert)
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    assert len(full["cells"]) == 1


def test_generate_chapters_builds_outline_and_links(client, headers):
    # Mevcut fihristte 1 bölüm olsun - üretim SONA eklemeli, kaydırmamalı
    client.post("/chapters/", json={"number": 1, "title": "Prolog", "kind": "chapter"}, headers=headers)
    m = _make_matrix(client, headers)
    # Bir hücreye önceden içerik koy - üretim bağlamalı ama içeriği korumalı
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "content": "Başkanın hologram planı.",
    }, headers=headers)

    r = client.post(f"/matrix/{m['id']}/generate-chapters", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"created_parts": 2, "created_chapters": 6, "linked_cells": 6}

    chapters = client.get("/chapters/", headers=headers).json()
    # 1 prolog + 2 kısım + 6 bölüm = 9 girdi; numara 1'den 9'a kesintisiz
    assert len(chapters) == 9
    assert [c["number"] for c in chapters] == list(range(1, 10))
    assert chapters[0]["title"] == "Prolog"          # dokunulmadı
    assert chapters[1]["kind"] == "part" and chapters[1]["title"] == "TUR 1: BAŞKAN"
    assert chapters[2]["kind"] == "chapter" and chapters[2]["title"] == "1. Hologram"

    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    assert len(full["cells"]) == 6
    assert all(c["chapter_id"] for c in full["cells"])
    pre = next(c for c in full["cells"] if c["content"])
    assert pre["content"] == "Başkanın hologram planı."  # içerik korunmuş

    # İkinci basış fihristi ÇİFTLEMEMELİ
    r = client.post(f"/matrix/{m['id']}/generate-chapters", headers=headers)
    assert r.status_code == 400


def test_plan_layer_injected_only_for_linked_chapter(client, headers):
    """Asıl özellik: hücre planı SADECE kendi bölümü yazılırken gider."""
    m = _make_matrix(client, headers, cols=("TUR 1",), rows=("Hologram", "Sorgu"))
    client.post(f"/matrix/{m['id']}/generate-chapters", headers=headers)
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    sorgu_row = next(r for r in full["rows"] if r["label"] == "Sorgu")
    sorgu_cell = next(c for c in full["cells"] if c["row_id"] == sorgu_row["id"])
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": sorgu_cell["column_id"], "row_id": sorgu_cell["row_id"],
        "content": "7 soru sorulacak. Kanıt: şantiye defteri. Anahtar: MÜCBİR SEBEP.",
        "chapter_id": sorgu_cell["chapter_id"],
    }, headers=headers)

    sorgu_no = sorgu_cell["chapter_number"]
    r = client.post("/ai/context-preview", json={
        "selected_entities": [], "chapter_number": sorgu_no,
    }, headers=headers)
    ctx = r.json()["context"]
    assert "BÖLÜM PLANI" in ctx
    assert "MÜCBİR SEBEP" in ctx
    assert "TUR 1 × Sorgu" in ctx  # kolon×satır etiketi başlıkta

    # Başka bir bölümde plan GİRMEMELİ
    other_no = next(c["chapter_number"] for c in full["cells"] if c["row_id"] != sorgu_row["id"])
    r = client.post("/ai/context-preview", json={
        "selected_entities": [], "chapter_number": other_no,
    }, headers=headers)
    assert "MÜCBİR SEBEP" not in r.json()["context"]
    assert "BÖLÜM PLANI" not in r.json()["context"]  # boş hücre maliyet ödemez


def test_delete_matrix_keeps_chapters(client, headers):
    m = _make_matrix(client, headers, cols=("TUR 1",), rows=("Hologram",))
    client.post(f"/matrix/{m['id']}/generate-chapters", headers=headers)
    before = len(client.get("/chapters/", headers=headers).json())
    r = client.delete(f"/matrix/{m['id']}", headers=headers)
    assert r.status_code == 204
    assert len(client.get("/chapters/", headers=headers).json()) == before  # fihrist duruyor


def test_cell_rejects_foreign_chapter(client, headers, client_second_novel=None):
    m = _make_matrix(client, headers, cols=("A",), rows=("B",))
    r = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "content": "x", "chapter_id": 999999,
    }, headers=headers)
    assert r.status_code == 404


# ---- Araya ekleme, ara başlıklar ve MP referans kodları --------------------

def test_insert_row_between_and_sub_kind(client, headers):
    m = _make_matrix(client, headers, cols=("TUR 1",), rows=("1. Hologram", "2. Kamera"))
    holo = next(r for r in m["rows"] if r["label"] == "1. Hologram")
    # Hologram'ın ALTINA bir ara başlık sok
    r = client.post(f"/matrix/{m['id']}/rows", json={
        "label": "1a. Nabız kaydı", "kind": "sub", "after_row_id": holo["id"],
    }, headers=headers)
    assert r.status_code == 201
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    assert [x["label"] for x in full["rows"]] == ["1. Hologram", "1a. Nabız kaydı", "2. Kamera"]
    assert [x["kind"] for x in full["rows"]] == ["main", "sub", "main"]
    assert [x["position"] for x in full["rows"]] == [1, 2, 3]  # kaydırma tutarlı
    # Geçersiz kind reddedilir
    r = client.post(f"/matrix/{m['id']}/rows", json={"label": "x", "kind": "başka"}, headers=headers)
    assert r.status_code == 422


def test_cells_get_stable_mp_codes(client, headers):
    m = _make_matrix(client, headers, cols=("TUR 1",), rows=("A", "B"))
    rowA, rowB = m["rows"][0], m["rows"][1]
    col = m["columns"][0]
    c1 = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": col["id"], "row_id": rowA["id"], "content": "ilk plan",
    }, headers=headers).json()
    c2 = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": col["id"], "row_id": rowB["id"], "content": "ikinci plan",
    }, headers=headers).json()
    assert c1["code"] == "MP1" and c2["code"] == "MP2"
    # Güncelleme kodu DEĞİŞTİRMEZ (sabitlik sözü)
    c1b = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": col["id"], "row_id": rowA["id"], "content": "güncellendi",
    }, headers=headers).json()
    assert c1b["code"] == "MP1"
    # Araya satır eklemek de mevcut kodları oynatmaz
    client.post(f"/matrix/{m['id']}/rows", json={"label": "ara", "kind": "sub", "after_row_id": rowA["id"]}, headers=headers)
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    codes = {c["content"]: c["code"] for c in full["cells"]}
    assert codes["güncellendi"] == "MP1" and codes["ikinci plan"] == "MP2"


def test_mp_code_reference_injected_for_comparison(client, headers):
    """Asıl istek: başka bir bölüm yazarken talimatta 'MP1' geçince o
    hücrenin planı REFERANS olarak context'e girer - kıyas yapılabilsin."""
    m = _make_matrix(client, headers, cols=("TUR 1", "TUR 2"), rows=("Sorgu",))
    client.post(f"/matrix/{m['id']}/generate-chapters", headers=headers)
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    tur1_cell = next(c for c in full["cells"] if c["column_id"] == full["columns"][0]["id"])
    tur2_cell = next(c for c in full["cells"] if c["column_id"] == full["columns"][1]["id"])
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": tur1_cell["column_id"], "row_id": tur1_cell["row_id"],
        "content": "Başkan sorgusu: 7 soru, kanıt ihale dosyası.",
        "chapter_id": tur1_cell["chapter_id"],
    }, headers=headers)

    # TUR 2'nin bölümünü yazarken TUR 1'in koduna atıf yap
    r = client.post("/ai/context-preview", json={
        "selected_entities": [],
        "chapter_number": tur2_cell["chapter_number"],
        "instruction": f"Bu sorguyu {tur1_cell['code']}'deki ritimle kıyaslayarak yaz",
    }, headers=headers)
    ctx = r.json()["context"]
    assert "REFERANS PLANLAR" in ctx
    assert "ihale dosyası" in ctx
    # Küçük harfle yazılsa da çalışır
    r = client.post("/ai/context-preview", json={
        "selected_entities": [],
        "chapter_number": tur2_cell["chapter_number"],
        "instruction": f"{tur1_cell['code'].lower()} ile aynı yapıda kur",
    }, headers=headers)
    assert "ihale dosyası" in r.json()["context"]
    # Kod anılmayınca referans GİRMEZ
    r = client.post("/ai/context-preview", json={
        "selected_entities": [], "chapter_number": tur2_cell["chapter_number"],
        "instruction": "Bu sorguyu yaz",
    }, headers=headers)
    assert "REFERANS PLANLAR" not in r.json()["context"]


def test_own_cell_not_duplicated_as_reference(client, headers):
    """Bölümün kendi planı zaten BÖLÜM PLANI olarak giriyor - talimatta
    kendi kodu anılsa bile REFERANS bloğunda İKİNCİ kez gitmemeli."""
    m = _make_matrix(client, headers, cols=("TUR 1",), rows=("Sorgu",))
    client.post(f"/matrix/{m['id']}/generate-chapters", headers=headers)
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    cell = full["cells"][0]
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": cell["column_id"], "row_id": cell["row_id"],
        "content": "Tek plan içeriği.", "chapter_id": cell["chapter_id"],
    }, headers=headers)
    r = client.post("/ai/context-preview", json={
        "selected_entities": [], "chapter_number": cell["chapter_number"],
        "instruction": f"{cell['code']} planına sadık kal",
    }, headers=headers)
    ctx = r.json()["context"]
    assert ctx.count("Tek plan içeriği.") == 1
    assert "BÖLÜM PLANI" in ctx and "REFERANS PLANLAR" not in ctx


# ---- AI doldurma (Qwen mock'lu) --------------------------------------------

import json as _json
from unittest.mock import patch, MagicMock


def _fake_qwen(payload):
    resp = MagicMock()
    resp.choices = [MagicMock(message=MagicMock(content=_json.dumps(payload)))]
    return resp


def test_ai_fill_targets_only_empty_cells_of_selected_columns(client, headers):
    m = _make_matrix(client, headers, cols=("TUR 1", "TUR 2"), rows=("Hologram", "Sorgu"))
    t1, t2 = m["columns"]
    holo, sorgu = m["rows"]
    # TUR 1 tamamen dolu (örnek/şablon), TUR 2'de sadece Hologram dolu
    for row, text in ((holo, "Başkan hologramı: 5 görüntü."), (sorgu, "Başkan sorgusu: 7 soru.")):
        client.put(f"/matrix/{m['id']}/cells", json={"column_id": t1["id"], "row_id": row["id"], "content": text}, headers=headers)
    client.put(f"/matrix/{m['id']}/cells", json={"column_id": t2["id"], "row_id": holo["id"], "content": "Jeolog hologramı."}, headers=headers)

    captured = {}
    def fake_create(**kwargs):
        captured["user_msg"] = kwargs["messages"][1]["content"]
        return _fake_qwen({"cells": [
            {"row_id": sorgu["id"], "content": "Jeolog sorgusu: 47. sayfa, villa tapusu."},
            {"row_id": holo["id"], "content": "FAZLADAN - dolu hücreye öneri (ayıklanmalı)"},
        ]})

    with patch("app.qwen_client.get_client") as mock_client:
        mock_client.return_value.chat.completions.create.side_effect = fake_create
        r = client.post(f"/matrix/{m['id']}/ai-fill", json={"column_ids": [t2["id"]]}, headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()
    # SADECE boş hücre (TUR 2 × Sorgu) önerildi; dolu hücreye gelen fazlalık ayıklandı
    assert len(data["proposals"]) == 1
    p = data["proposals"][0]
    assert p["column_id"] == t2["id"] and p["row_id"] == sorgu["id"]
    assert "47. sayfa" in p["content"]
    # Prompt'ta aynı satırın dolu örneği (TUR 1'in sorgusu) ŞABLON olarak verilmiş
    assert "Başkan sorgusu: 7 soru." in captured["user_msg"]
    # Kolonun kendi dolu hücresi de "turun sesi" olarak verilmiş
    assert "Jeolog hologramı." in captured["user_msg"]
    # HİÇBİR ŞEY kaydedilmedi - onay kullanıcının
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    t2_sorgu = [c for c in full["cells"] if c["column_id"] == t2["id"] and c["row_id"] == sorgu["id"]]
    assert not t2_sorgu or not t2_sorgu[0]["content"].strip()


def test_ai_fill_skips_fully_filled_columns_without_qwen_call(client, headers):
    m = _make_matrix(client, headers, cols=("TUR 1",), rows=("Hologram",))
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"], "content": "dolu",
    }, headers=headers)
    with patch("app.qwen_client.get_client") as mock_client:
        r = client.post(f"/matrix/{m['id']}/ai-fill", json={"column_ids": [m["columns"][0]["id"]]}, headers=headers)
        mock_client.assert_not_called()  # boş hücre yok -> Qwen'e hiç gidilmez (maliyet sıfır)
    assert r.json() == {"proposals": [], "skipped_columns": ["TUR 1"]}


def test_ai_fill_requires_column_selection(client, headers):
    m = _make_matrix(client, headers)
    r = client.post(f"/matrix/{m['id']}/ai-fill", json={"column_ids": []}, headers=headers)
    assert r.status_code == 400
    r = client.post(f"/matrix/{m['id']}/ai-fill", json={"column_ids": [999999]}, headers=headers)
    assert r.status_code == 404


# ---- Kolon araya ekleme + Roman menüsü plan kutusu -------------------------

def test_insert_column_between(client, headers):
    m = _make_matrix(client, headers, cols=("TUR 1", "TUR 3"), rows=("A",))
    tur1 = next(c for c in m["columns"] if c["label"] == "TUR 1")
    r = client.post(f"/matrix/{m['id']}/columns", json={
        "label": "TUR 2", "after_column_id": tur1["id"],
    }, headers=headers)
    assert r.status_code == 201
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    assert [c["label"] for c in full["columns"]] == ["TUR 1", "TUR 2", "TUR 3"]
    assert [c["position"] for c in full["columns"]] == [1, 2, 3]
    # Geçersiz çapa 404
    r = client.post(f"/matrix/{m['id']}/columns", json={"label": "x", "after_column_id": 999999}, headers=headers)
    assert r.status_code == 404


def test_plan_for_chapter_endpoint(client, headers):
    m = _make_matrix(client, headers, cols=("TUR 1",), rows=("Sorgu",))
    client.post(f"/matrix/{m['id']}/generate-chapters", headers=headers)
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    cell = full["cells"][0]
    # İçerik boşken kutu boş dönmeli (Roman menüsünde kutu hiç çıkmaz)
    r = client.get(f"/matrix/plan-for-chapter/{cell['chapter_id']}", headers=headers)
    assert r.json() == []
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": cell["column_id"], "row_id": cell["row_id"],
        "content": "7 soru. Kanıt: ihale dosyası.", "chapter_id": cell["chapter_id"],
    }, headers=headers)
    r = client.get(f"/matrix/plan-for-chapter/{cell['chapter_id']}", headers=headers)
    data = r.json()
    assert len(data) == 1
    assert data[0]["code"] == cell["code"]
    assert data[0]["column_label"] == "TUR 1" and data[0]["row_label"] == "Sorgu"
    assert "ihale dosyası" in data[0]["content"]
    # Başka romanın bölümü / olmayan bölüm -> 404
    r = client.get("/matrix/plan-for-chapter/999999", headers=headers)
    assert r.status_code == 404


# ---- Hızlı plan (bölümün içinden, matrise girmeden) ------------------------

def test_quick_plan_creates_quick_matrix_and_flows_to_context(client, headers):
    ch = client.post("/chapters/", json={"number": 1, "title": "Açılış", "kind": "chapter"}, headers=headers).json()
    r = client.post("/matrix/quick-plan", json={
        "chapter_id": ch["id"], "content": "Vicdan salonu tanıtır. İlk hologram: yaşlı çift.",
    }, headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["matrix_name"] == "Hızlı Planlar" and data["code"] == "MP1"
    # Plan kutusu ucu görüyor
    plan = client.get(f"/matrix/plan-for-chapter/{ch['id']}", headers=headers).json()
    assert len(plan) == 1 and "yaşlı çift" in plan[0]["content"]
    # Context'e giriyor
    ctx = client.post("/ai/context-preview", json={"selected_entities": [], "chapter_number": 1}, headers=headers).json()["context"]
    assert "BÖLÜM PLANI" in ctx and "yaşlı çift" in ctx


def test_quick_plan_updates_in_place_no_duplicates(client, headers):
    ch = client.post("/chapters/", json={"number": 1, "title": "B", "kind": "chapter"}, headers=headers).json()
    client.post("/matrix/quick-plan", json={"chapter_id": ch["id"], "content": "ilk"}, headers=headers)
    r = client.post("/matrix/quick-plan", json={"chapter_id": ch["id"], "content": "güncel"}, headers=headers)
    assert r.json()["content"] == "güncel" and r.json()["code"] == "MP1"  # kod sabit kaldı
    matrices = client.get("/matrix/", headers=headers).json()
    assert len(matrices) == 1                       # ikinci matris açılmadı
    full = client.get(f"/matrix/{matrices[0]['id']}", headers=headers).json()
    assert len(full["rows"]) == 1 and len(full["cells"]) == 1  # satır/hücre çiftlenmedi


def test_quick_plan_edits_existing_matrix_cell(client, headers):
    """Bölüm normal bir matristen bağlıysa hızlı plan O hücreyi günceller -
    'Hızlı Planlar'a kopya açmaz."""
    m = _make_matrix(client, headers, cols=("TUR 1",), rows=("Sorgu",))
    client.post(f"/matrix/{m['id']}/generate-chapters", headers=headers)
    cell = client.get(f"/matrix/{m['id']}", headers=headers).json()["cells"][0]
    r = client.post("/matrix/quick-plan", json={
        "chapter_id": cell["chapter_id"], "content": "7 soru sorulacak.",
    }, headers=headers)
    assert r.json()["matrix_name"] == "Tur Yapısı"  # kendi matrisinde güncellendi
    assert len(client.get("/matrix/", headers=headers).json()) == 1
