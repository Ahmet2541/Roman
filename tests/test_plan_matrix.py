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
    ctx_other = r.json()["context"]
    # Plan, BAŞKA bölümün KENDİ planı olarak gitmez. İleri bakış katmanında
    # "SONRAKİ BÖLÜMÜN PLANI" etiketiyle görünebilir - bu bilinçli: sahne,
    # sonrakine bağlanacak şekilde yazılmalı (bkz. build_forward_layer).
    if "MÜCBİR SEBEP" in ctx_other:
        assert "İLERİ BAKIŞ" in ctx_other and "SONRAKİ BÖLÜMÜN PLANI" in ctx_other
    assert "BÖLÜM PLANI (plana sadık kal)" not in ctx_other  # kendi planı yok


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


# ---- Talimat Kasası (satır bazlı kalıcı yazım kısıtları) -------------------

def test_row_instructions_reach_context(client, headers):
    """Bir aşamaya kaydedilen yazım kısıtları, o satıra bağlı HER bölümün
    context'ine plan katmanıyla birlikte gitmeli - iyi talimat bir kez
    yazılıp kalıcı olsun diye."""
    m = _make_matrix(client, headers, cols=("TUR 1", "TUR 2"), rows=("Karar",))
    row = m["rows"][0]
    r = client.put(f"/matrix/{m['id']}/rows/{row['id']}", json={
        "label": "Karar", "kind": "main",
        "instructions": "- Duyguyu ADLANDIRMA\n- Sanık tek cümle konuşur",
    }, headers=headers)
    assert r.status_code == 200 and "ADLANDIRMA" in r.json()["instructions"]

    client.post(f"/matrix/{m['id']}/generate-chapters", headers=headers)
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    for cell in full["cells"]:
        client.put(f"/matrix/{m['id']}/cells", json={
            "column_id": cell["column_id"], "row_id": cell["row_id"],
            "content": "Kurban veda eder.", "chapter_id": cell["chapter_id"],
        }, headers=headers)

    # HER İKİ turun bölümünde de kısıtlar görünmeli (satır bazlı olduğu için)
    for cell in client.get(f"/matrix/{m['id']}", headers=headers).json()["cells"]:
        ctx = client.post("/ai/context-preview", json={
            "selected_entities": [], "chapter_number": cell["chapter_number"],
        }, headers=headers).json()["context"]
        assert "BU AŞAMANIN YAZIM KISITLARI" in ctx
        assert "Duyguyu ADLANDIRMA" in ctx
        assert "Kurban veda eder." in ctx


def test_row_without_instructions_adds_nothing(client, headers):
    m = _make_matrix(client, headers, cols=("TUR 1",), rows=("Hologram",))
    client.post(f"/matrix/{m['id']}/generate-chapters", headers=headers)
    cell = client.get(f"/matrix/{m['id']}", headers=headers).json()["cells"][0]
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": cell["column_id"], "row_id": cell["row_id"],
        "content": "5 görüntü.", "chapter_id": cell["chapter_id"],
    }, headers=headers)
    ctx = client.post("/ai/context-preview", json={
        "selected_entities": [], "chapter_number": cell["chapter_number"],
    }, headers=headers).json()["context"]
    assert "BU AŞAMANIN YAZIM KISITLARI" not in ctx  # boşsa maliyet ödenmez


def test_matrix_map_layer_in_context(client, headers):
    """AI, hangi bölümün hangi kolon×satır kesişimi olduğunu bilmeli -
    "3. bölüm hangi tura ait", "Sorgu aşaması diğer turlarda nerede"
    soruları ancak bu haritayla cevaplanır."""
    from app.qwen_client import build_matrix_map_layer, build_context
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app import models

    m = _make_matrix(client, headers, cols=("TUR 1: BAŞKAN", "TUR 2: JEOLOG"), rows=("Hologram", "Sorgu"))
    client.post(f"/matrix/{m['id']}/generate-chapters", headers=headers)
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    hedef = full["cells"][0]
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": hedef["column_id"], "row_id": hedef["row_id"],
        "content": "Başkanın hologramı.", "chapter_id": hedef["chapter_id"],
    }, headers=headers)

    db = sessionmaker(bind=engine)()
    novel_id = int(headers["X-Novel-Id"])
    uid = db.query(models.Novel).filter(models.Novel.id == novel_id).first().universe_id

    harita = build_matrix_map_layer(db, novel_id)
    assert "MATRİS HARİTASI" in harita
    assert "TUR 1: BAŞKAN" in harita and "TUR 2: JEOLOG" in harita
    assert "Hologram → Bölüm" in harita and "Sorgu → Bölüm" in harita
    assert "plan ✓" in harita and "plan boş" in harita   # doluluk da görünüyor
    assert "Başkanın hologramı" not in harita            # İÇERİK gitmez (ucuz kalsın)

    ctx = build_context(db, novel_id, uid, [])
    assert "MATRİS HARİTASI" in ctx

    # Matris yoksa katman hiç oluşmaz
    client.delete(f"/matrix/{m['id']}", headers=headers)
    assert build_matrix_map_layer(db, novel_id) == ""


# ---- Kolonu fihriste bağlama (kolon=bölüm, satırlar=kısımlar) --------------

def test_bind_column_to_outline_maps_rows_to_children(client, headers):
    """Kullanıcının zihin modeli: kolon = fihristteki BÖLÜM, satırlar = o
    bölümün altındaki KISIM'lar. Tek işlemde sırayla eşleşmeli."""
    # Fihrist: BÖLÜM 4 (üst) altında 3 kısım; BÖLÜM 5 (üst) altında 2 kısım
    b4 = client.post("/chapters/", json={"number": 1, "kind": "part", "title": "BÖLÜM 4 - Belediye Başkanı"}, headers=headers).json()
    k1 = client.post("/chapters/", json={"number": 2, "kind": "chapter", "title": "Kısım 1"}, headers=headers).json()
    k2 = client.post("/chapters/", json={"number": 3, "kind": "chapter", "title": "Kısım 2"}, headers=headers).json()
    k3 = client.post("/chapters/", json={"number": 4, "kind": "chapter", "title": "Kısım 3"}, headers=headers).json()
    b5 = client.post("/chapters/", json={"number": 5, "kind": "part", "title": "BÖLÜM 5 - Yargıç"}, headers=headers).json()
    y1 = client.post("/chapters/", json={"number": 6, "kind": "chapter", "title": "Yargıç Kısım 1"}, headers=headers).json()

    m = _make_matrix(client, headers, cols=("Belediye Başkanı", "Yargıç"), rows=("Aşama 1", "Aşama 2", "Aşama 3"))
    col_bb, col_y = m["columns"]

    r = client.post(f"/matrix/{m['id']}/columns/{col_bb['id']}/bind-outline",
                    json={"parent_chapter_id": b4["id"]}, headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["linked"]) == 3
    assert "Aşama 1 → #1-1 Kısım 1" in data["linked"][0]
    assert "Aşama 3 → #1-3 Kısım 3" in data["linked"][2]

    # Hücreler gerçekten bağlandı
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    bagli = {c["row_id"]: c["chapter_id"] for c in full["cells"] if c["column_id"] == col_bb["id"]}
    assert set(bagli.values()) == {k1["id"], k2["id"], k3["id"]}

    # İkinci kolon: alt girdisi 1 tane, kalan satırlar atlanır ve NEDENİ söylenir
    r = client.post(f"/matrix/{m['id']}/columns/{col_y['id']}/bind-outline",
                    json={"parent_chapter_id": b5["id"]}, headers=headers)
    data = r.json()
    assert len(data["linked"]) == 1 and y1["title"] in data["linked"][0]
    assert len(data["skipped"]) == 2 and "alt girdi yok" in data["skipped"][0]

    # Zaten bağlıyken tekrar bağlama: overwrite olmadan korunur
    r = client.post(f"/matrix/{m['id']}/columns/{col_bb['id']}/bind-outline",
                    json={"parent_chapter_id": b5["id"]}, headers=headers)
    assert all("zaten" in x for x in r.json()["skipped"][:1])


def test_outline_tree_endpoint(client, headers):
    """Eşleştirme ekranı için fihrist ağacı: numara, seviye, alt girdi sayısı."""
    client.post("/chapters/", json={"number": 1, "kind": "part", "title": "BÖLÜM 4"}, headers=headers)
    client.post("/chapters/", json={"number": 2, "kind": "chapter", "title": "Kısım 1"}, headers=headers)
    client.post("/chapters/", json={"number": 3, "kind": "chapter", "title": "Kısım 2"}, headers=headers)

    tree = client.get("/matrix/outline-tree", headers=headers).json()
    ust = next(t for t in tree if t["title"] == "BÖLÜM 4")
    assert ust["display"] == "1" and ust["level"] == 0 and ust["child_count"] == 2
    alt = next(t for t in tree if t["title"] == "Kısım 2")
    assert alt["display"] == "1-2" and alt["level"] == 1


def test_plan_for_chapter_returns_list(client, headers):
    """REGRESYON: /matrix/plan-for-chapter LİSTE döndürür (bir bölüme
    birden çok hücre bağlı olabilir). Frontend bunu tek nesne gibi
    okuyordu - plan kaydedilse bile "plan yok" görünüyordu."""
    ch = client.post("/chapters/", json={"number": 1, "kind": "chapter", "title": "B"}, headers=headers).json()
    r = client.post("/matrix/quick-plan", json={"chapter_id": ch["id"], "content": "- Madde bir"}, headers=headers)
    assert r.status_code == 200, r.text

    okunan = client.get(f"/matrix/plan-for-chapter/{ch['id']}", headers=headers).json()
    assert isinstance(okunan, list), "uç liste döndürmeli"
    assert len(okunan) == 1
    assert okunan[0]["content"] == "- Madde bir"
    assert okunan[0]["matrix_name"] == "Hızlı Planlar"

    # Aynı bölüme tekrar yazmak YENİ hücre açmaz, mevcudu günceller
    client.post("/matrix/quick-plan", json={"chapter_id": ch["id"], "content": "- Güncellendi"}, headers=headers)
    okunan2 = client.get(f"/matrix/plan-for-chapter/{ch['id']}", headers=headers).json()
    assert len(okunan2) == 1 and okunan2[0]["content"] == "- Güncellendi"


def test_outline_tree_exposes_parent_id(client, headers):
    """Satır türetme (bölümden matris) doğrudan alt girdileri bulmak için
    parent_id'ye ihtiyaç duyar - numara tahminiyle değil, gerçek bağla."""
    ust = client.post("/chapters/", json={"number": 1, "kind": "part", "title": "BÖLÜM 4"}, headers=headers).json()
    client.post("/chapters/", json={"number": 2, "kind": "chapter", "title": "Kısım A"}, headers=headers)
    client.post("/chapters/", json={"number": 3, "kind": "chapter", "title": "Kısım B"}, headers=headers)

    tree = client.get("/matrix/outline-tree", headers=headers).json()
    altlar = [t for t in tree if t["parent_id"] == ust["id"]]
    assert [t["title"] for t in altlar] == ["Kısım A", "Kısım B"]
    assert next(t for t in tree if t["id"] == ust["id"])["parent_id"] is None


def test_plan_layer_inherits_unbound_subrows_as_scenes(client, headers):
    """KRİTİK: kullanıcının çalışma biçiminde matris satırları hikâyeyi
    SIRAYLA taşır - bölüm numarası verilen satır BÖLÜM, ondan sonraki
    bağsız satırlar o bölümün SAHNELERİdir. Eskiden sadece bağlı hücre
    AI'ya gidiyordu; sahne sahne plan tamamen görünmezdi."""
    from app.qwen_client import build_plan_layer
    from sqlalchemy.orm import sessionmaker
    from app.database import engine

    m = _make_matrix(client, headers, cols=("Tur 1",),
                     rows=("1 HOLOGRAM (5 dk)", "↳ ÇERÇEVE", "↳ GÖRÜNTÜ 1", "2 KAMERA (10 dk)", "↳ GÖRÜNTÜ 2"))
    col = m["columns"][0]
    b13 = client.post("/chapters/", json={"number": 13, "kind": "chapter", "title": "Hologram"}, headers=headers).json()
    b14 = client.post("/chapters/", json={"number": 14, "kind": "chapter", "title": "Kamera"}, headers=headers).json()

    icerikler = ["Suçlular ilk kez bir arada", "Çerçeve kurulur", "Mahalle tablosu",
                 "Kamera turu başlar", "Makam odası"]
    for i, row in enumerate(m["rows"]):
        veri = {"column_id": col["id"], "row_id": row["id"], "content": icerikler[i]}
        if i == 0:
            veri["chapter_id"] = b13["id"]      # BÖLÜM 13
        if i == 3:
            veri["chapter_id"] = b14["id"]      # BÖLÜM 14
        client.put(f"/matrix/{m['id']}/cells", json=veri, headers=headers)

    db = sessionmaker(bind=engine)()
    novel_id = int(headers["X-Novel-Id"])
    plan13 = build_plan_layer(db, novel_id, 13)

    assert "Suçlular ilk kez bir arada" in plan13          # kendi planı
    assert "BU BÖLÜMÜN SAHNELERİ" in plan13
    assert "Çerçeve kurulur" in plan13                     # alt sahne 1 MİRAS
    assert "Mahalle tablosu" in plan13                     # alt sahne 2 MİRAS
    assert "Kamera turu başlar" not in plan13              # SONRAKİ bölümde durur
    assert "Makam odası" not in plan13                     # onun alt sahnesi de girmez

    # 14. bölüm kendi sahnesini alır
    plan14 = build_plan_layer(db, novel_id, 14)
    assert "Kamera turu başlar" in plan14 and "Makam odası" in plan14
    assert "Çerçeve kurulur" not in plan14


def test_parallel_layer_shows_same_stage_other_turns(client, headers):
    """TURLAR ARASI PARALELLİK: aynı aşamanın diğer turlardaki hâlleri
    bağlama girer. Matris haritası yalnızca EŞLEŞMEYİ veriyordu, içeriği
    değil - sistem "bunu Tur 1'de şöyle yaptın, tekrarlama" diyemiyordu."""
    from app.qwen_client import build_parallel_layer
    from sqlalchemy.orm import sessionmaker
    from app.database import engine

    m = _make_matrix(client, headers, cols=("TUR 1: BAŞKAN", "TUR 2: JEOLOG"), rows=("Hologram", "Sorgu"))
    c1, c2 = m["columns"]
    b13 = client.post("/chapters/", json={"number": 13, "kind": "chapter", "title": "T1 Hologram"}, headers=headers).json()
    b20 = client.post("/chapters/", json={"number": 20, "kind": "chapter", "title": "T2 Hologram"}, headers=headers).json()
    client.put(f"/chapters/{b13['id']}", json={"summary": "OLAY: Mahalle yanıyor."}, headers=headers)

    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": c1["id"], "row_id": m["rows"][0]["id"],
        "content": "Başkanın mahallesi gösterilir", "chapter_id": b13["id"]}, headers=headers)
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": c2["id"], "row_id": m["rows"][0]["id"],
        "content": "Jeologun ocağı gösterilir", "chapter_id": b20["id"]}, headers=headers)
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": c2["id"], "row_id": m["rows"][1]["id"],
        "content": "BAŞKA AŞAMA - girmemeli"}, headers=headers)

    db = sessionmaker(bind=engine)()
    novel_id = int(headers["X-Novel-Id"])
    kat = build_parallel_layer(db, novel_id, 20)     # Tur 2 yazılıyor

    assert "AYNI AŞAMANIN DİĞER TURLARI" in kat
    assert "Başkanın mahallesi" in kat               # Tur 1'in AYNI aşaması
    assert "TUR 1: BAŞKAN" in kat                    # hangi tur olduğu belli
    assert "Mahalle yanıyor" in kat                  # yazılmışsa ÖZETİ de gelir
    assert "TEKRARLAMA" in kat                       # direktif var
    assert "BAŞKA AŞAMA" not in kat                  # farklı satır girmez

    # Matris hücresi olmayan bölümde katman hiç oluşmaz (maliyet yok)
    assert build_parallel_layer(db, novel_id, 999) == ""


def test_arc_review_evaluates_tur_as_whole(client, headers):
    """TUR DEĞERLENDİRMESİ: üst başlık altındaki sahneler bir bütün olarak
    denetlenir - iç yay, ritim, tekrar, kapanış, hacim."""
    ust = client.post("/chapters/", json={"number": 1, "kind": "part", "title": "TUR 1: BAŞKAN"}, headers=headers).json()
    for no, ozet, adet in ((2, "Hologram açılır.", 3), (3, "Sorgu başlar.", 2)):
        ch = client.post("/chapters/", json={"number": no, "kind": "chapter", "title": f"Sahne {no}"}, headers=headers).json()
        for i in range(adet):
            client.put(f"/chapters/{ch['id']}/paragraphs/{i+1}", json={"number": i+1, "text": f"Metin {i}."}, headers=headers)
        client.put(f"/chapters/{ch['id']}", json={"summary": ozet}, headers=headers)

    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.return_value = _fake_qwen({
            "arc": "yukseliyor", "arc_note": "Gerilim tırmanıyor.",
            "rhythm": [{"scene": "1-1", "issue": "Açılış şişkin.", "fix": "Kısalt."},
                       {"scene": "", "issue": "", "fix": "boş - ayıklanmalı"}],
            "repeats": ["Aynı sessizlik imgesi iki sahnede"],
            "closing": "Eşik bırakıyor.", "volume_note": "Dengeli.",
            "summary": "Tur sağlam.",
        })
        r = client.post(f"/ai/arc-review/{ust['id']}", headers=headers)
    d = r.json()
    assert d["arc"] == "yukseliyor"
    assert len(d["rhythm"]) == 1                     # boş madde ayıklandı
    assert len(d["scenes"]) == 2
    assert d["scenes"][0]["paragraphs"] == 3         # hacim dağılımı hesaplandı
    assert "sessizlik imgesi" in d["repeats"][0]

    # Alt sahnesi olmayan girdide Qwen'e gidilmez
    yalniz = client.post("/chapters/", json={"number": 9, "kind": "chapter", "title": "Tek"}, headers=headers).json()
    with patch("app.qwen_client.get_client") as mc:
        r = client.post(f"/ai/arc-review/{yalniz['id']}", headers=headers)
        mc.assert_not_called()
    assert "alt sahnesi yok" in r.json()["summary"]
