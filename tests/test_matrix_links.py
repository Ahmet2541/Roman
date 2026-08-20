"""PLAN MATRİSİ BAĞLANTI DENETİMİ: kopuk uç var mı?

Matris beş ayrı şeye bağlanır: bölümler (chapter_id), kişiler
(column.character_id), varlıklar (hücre içindeki mekan_id / kişi / nesne
ID'leri), diğer hücreler (MP kodları) ve kendi kolon/satırları. Her biri
için karşı taraf SİLİNDİĞİNDE ne olduğu ayrı ayrı sınanır - kopuk uç
sessiz kalırsa plan yazım anında AI'ya eksik gider ve kimse fark etmez.
"""
import pytest


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    from app import ratelimit
    ratelimit._calls.clear()
    yield


def _kur(client, headers, satir=1):
    m = client.post("/matrix/", json={
        "name": "T", "columns": [{"label": "TUR 1"}],
        "rows": [{"label": f"S{i}"} for i in range(1, satir + 1)],
    }, headers=headers).json()
    return m


def test_deleted_chapter_leaves_no_dangling_cell_binding(client, headers):
    """Bölüm silinince ona bağlı hücre ne oluyor? Bağ kopuk kalırsa hücre
    var olmayan bir bölüme işaret eder ve plan hiçbir yere gitmez."""
    ch = client.post("/chapters/", json={"number": 1, "title": "B1"}, headers=headers).json()
    m = _kur(client, headers)
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "chapter_id": ch["id"], "data": {"olay": "x"},
    }, headers=headers)

    d = client.delete(f"/chapters/{ch['id']}", headers=headers)
    assert d.status_code in (200, 204), d.text

    full = client.get(f"/matrix/{m['id']}", headers=headers)
    assert full.status_code == 200, f"bölüm silinince matris okunamıyor: {full.text}"
    hucre = full.json()["cells"][0]
    assert hucre["chapter_id"] is None, (
        f"KOPUK UÇ: hücre silinmiş bölüme ({ch['id']}) bağlı kalmış")


def test_deleted_character_leaves_no_dangling_column_link(client, headers):
    """Kolon bir Kişi'ye bağlanabiliyor. Kişi silinirse?"""
    k = client.post("/characters/", json={"name": "Vicdan"}, headers=headers).json()
    m = _kur(client, headers)
    col_id = m["columns"][0]["id"]
    client.put(f"/matrix/{m['id']}/columns/{col_id}", json={
        "label": "TUR 1", "character_id": k["id"],
    }, headers=headers)

    d = client.delete(f"/characters/{k['id']}", headers=headers)
    assert d.status_code in (200, 204), d.text

    full = client.get(f"/matrix/{m['id']}", headers=headers)
    assert full.status_code == 200, f"kişi silinince matris okunamıyor: {full.text}"
    assert full.json()["columns"][0]["character_id"] is None, (
        "KOPUK UÇ: kolon silinmiş kişiye bağlı kalmış")


def test_deleted_column_removes_its_cells(client, headers):
    """Kolon silinince hücreleri de gitmeli - öksüz hücre matriste
    görünmez ama MP kodunu tutmaya devam ederse referanslar yanıltır."""
    m = _kur(client, headers)
    col_id = m["columns"][0]["id"]
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": col_id, "row_id": m["rows"][0]["id"], "data": {"olay": "x"},
    }, headers=headers)
    client.delete(f"/matrix/{m['id']}/columns/{col_id}", headers=headers)
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    assert full["cells"] == [], "KOPUK UÇ: kolon silindi ama hücreleri kaldı"


def test_deleted_row_removes_its_cells(client, headers):
    m = _kur(client, headers)
    row_id = m["rows"][0]["id"]
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": row_id, "data": {"olay": "x"},
    }, headers=headers)
    client.delete(f"/matrix/{m['id']}/rows/{row_id}", headers=headers)
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    assert full["cells"] == [], "KOPUK UÇ: satır silindi ama hücreleri kaldı"


def test_deleted_matrix_removes_everything(client, headers):
    m = _kur(client, headers)
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"], "data": {"olay": "x"},
    }, headers=headers)
    client.delete(f"/matrix/{m['id']}", headers=headers)
    assert client.get(f"/matrix/{m['id']}", headers=headers).status_code == 404
    # Kalıntı hücre başka matrisin MP sayacını kaydırmamalı
    m2 = _kur(client, headers)
    r = client.put(f"/matrix/{m2['id']}/cells", json={
        "column_id": m2["columns"][0]["id"], "row_id": m2["rows"][0]["id"], "data": {"olay": "y"},
    }, headers=headers)
    assert r.status_code == 200


def test_deleted_place_leaves_stale_id_in_cell(client, headers):
    """Hücre mekana ID ile bağlanır. Mekan silinirse ID kopuk kalır mı?"""
    yer = client.post("/places/", json={"name": "VIP Salonu"}, headers=headers).json()
    m = _kur(client, headers)
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "data": {"olay": "x", "mekan": "VIP Salonu", "mekan_id": yer["id"]},
    }, headers=headers)
    client.delete(f"/places/{yer['id']}", headers=headers)

    full = client.get(f"/matrix/{m['id']}", headers=headers)
    assert full.status_code == 200, "mekan silinince matris okunamıyor"
    hucre = full.json()["cells"][0]
    # Ad korunmalı (plan metni bozulmasın) ama ölü ID taşınmamalı.
    assert hucre["data"]["mekan"] == "VIP Salonu"
    assert hucre["data"]["mekan_id"] is None, (
        "KOPUK UÇ: hücre silinmiş mekanın ID'sini tutuyor")


def test_dangling_mp_reference_is_reported_not_crashed(client, headers):
    """Var olmayan MP koduna referans: çökmemeli, denetimde görünmeli."""
    m = _kur(client, headers)
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "data": {"olay": "x", "baglantilar": [{"kod": "MP404", "tur": "ayna", "not": "yansıt"}]},
    }, headers=headers)
    denetim = client.get(f"/matrix/{m['id']}/audit-prompt", headers=headers).json()
    assert "KAYIP REFERANS" in denetim["prompt"] and "MP404" in denetim["prompt"]


def test_plan_reaches_context_after_chapter_rebind(client, headers):
    """Zincirin ucu: hücre → bölüm → bağlam katmanı. Bağ değiştirilince
    plan ESKİ bölümde kalmamalı, YENİ bölümde görünmeli."""
    a = client.post("/chapters/", json={"number": 1, "title": "A"}, headers=headers).json()
    b = client.post("/chapters/", json={"number": 2, "title": "B"}, headers=headers).json()
    m = _kur(client, headers)
    ortak = {"column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"]}
    client.put(f"/matrix/{m['id']}/cells", json={
        **ortak, "chapter_id": a["id"], "data": {"olay": "İşaret cümlesi."},
    }, headers=headers)

    def ctx(num):
        return client.post("/ai/context-preview", json={
            "selected_entities": [], "chapter_number": num,
        }, headers=headers).json()["context"]

    assert "İşaret cümlesi." in ctx(1)
    # Yalnızca bağı değiştir - data/content YOLLAMA. Bu istek planı
    # silmemeli (varsayılan boş dize içeriğin üstüne yazılmamalı).
    client.put(f"/matrix/{m['id']}/cells", json={**ortak, "chapter_id": b["id"]}, headers=headers)

    # Bölüm 1 bağlamında plan artık KENDİ planı olarak görünmemeli. Ama
    # "SONRAKİ BÖLÜMÜN PLANI" başlığı altında görünür - o tasarım gereği,
    # yazarken nereye gidildiğini bilmek için. Kendi planı bölümünde ara.
    kendi = ctx(1).split("SONRAKİ BÖLÜMÜN PLANI")[0]
    assert "İşaret cümlesi." not in kendi, "KOPUK UÇ: plan eski bölümde kaldı"
    assert "İşaret cümlesi." in ctx(2), "KOPUK UÇ: plan yeni bölüme geçmedi (bağ değişince içerik silinmiş olabilir)"


def test_deleted_character_also_clears_cell_person_ids(client, headers):
    """Kişi hem kolona hem hücrenin KİŞİLER listesine bağlanabilir -
    ikisi de temizlenmeli, biri unutulursa ölü ID kalır."""
    k = client.post("/characters/", json={"name": "Vicdan"}, headers=headers).json()
    m = _kur(client, headers)
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "data": {"olay": "x", "kisiler": [{"id": k["id"], "ad": "Vicdan"}]},
    }, headers=headers)
    client.delete(f"/characters/{k['id']}", headers=headers)
    hucre = client.get(f"/matrix/{m['id']}", headers=headers).json()["cells"][0]
    assert hucre["data"]["kisiler"][0]["ad"] == "Vicdan", "ad silinmemeliydi"
    assert hucre["data"]["kisiler"][0]["id"] is None, "KOPUK UÇ: ölü kişi ID'si duruyor"


def test_deleted_object_clears_cell_object_ids(client, headers):
    n = client.post("/objects/", json={"name": "mendil"}, headers=headers).json()
    m = _kur(client, headers)
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "data": {"olay": "x", "nesneler": [{"id": n["id"], "ad": "mendil"}]},
    }, headers=headers)
    client.delete(f"/objects/{n['id']}", headers=headers)
    hucre = client.get(f"/matrix/{m['id']}", headers=headers).json()["cells"][0]
    assert hucre["data"]["nesneler"][0]["id"] is None, "KOPUK UÇ: ölü nesne ID'si duruyor"


def test_binding_only_update_does_not_erase_plan(client, headers):
    """Yalnızca bölüm bağını değiştiren istek planı SİLMEMELİ. Varsayılan
    boş content, yazılmış planın üstüne yazılıyordu."""
    a = client.post("/chapters/", json={"number": 1, "title": "A"}, headers=headers).json()
    m = _kur(client, headers)
    ortak = {"column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"]}
    client.put(f"/matrix/{m['id']}/cells", json={
        **ortak, "data": {"olay": "Kalıcı olmalı."}}, headers=headers)
    r = client.put(f"/matrix/{m['id']}/cells", json={**ortak, "chapter_id": a["id"]}, headers=headers)
    assert "Kalıcı olmalı." in r.json()["content"], "plan silindi"
    assert r.json()["data"]["olay"] == "Kalıcı olmalı."
