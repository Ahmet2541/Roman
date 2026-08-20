"""YAPI KİLİDİ v1.0 - yapılandırılmış hücre şeması testleri."""
import pytest


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    from app import ratelimit
    ratelimit._calls.clear()
    yield


def _matris(client, headers):
    return client.post("/matrix/", json={
        "name": "Turlar",
        "columns": [{"label": "TUR 1: BAŞKAN"}],
        "rows": [{"label": "3. Sorgu"}],
    }, headers=headers).json()


def test_structured_cell_renders_to_content(client, headers):
    """data gönderilir, content ondan üretilir - AI'ya giden metin bu."""
    m = _matris(client, headers)
    r = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "data": {
            "olay": "Başkan sanığa mendili uzatır.",
            "zaman": {"tarih": "12 Mart", "saat": "21:40", "tip": "SAYAC"},
            "mekan": "VIP Salonu",
            "duygu": {"baslangic": "güven", "bitis": "şüphe"},
            "kisiler": [{"id": None, "ad": "Vicdan"}],
            "giris": "İlk repliği reddeder.",
            "gelisme": "Baskı artar.",
            "sonuc": "ÇÖZÜN kelimesi havada kalır.",
            "baglantilar": [{"kod": "mp7", "tur": "ayna", "not": "T1·G1"}],
        },
    }, headers=headers)
    assert r.status_code == 200, r.text
    c = r.json()["content"]
    assert "OLAY: Başkan sanığa mendili uzatır." in c
    assert "ZAMAN: 12 Mart 21:40 (SAYAÇ)" in c
    assert "DUYGU: güven → şüphe" in c
    assert "SONUÇ: ÇÖZÜN kelimesi havada kalır." in c
    assert "BAĞLANTI: MP7 (ayna) → T1·G1" in c


def test_missing_fields_warn_but_do_not_block(client, headers):
    m = _matris(client, headers)
    r = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "data": {"olay": "Bir şey olur."},
    }, headers=headers)
    assert r.status_code == 200, "eksik alan kaydı ENGELLEMEMELİ"
    uyarilar = " · ".join(r.json()["warnings"])
    assert "GİRİŞ" in uyarilar and "MEKAN" in uyarilar


def test_damga_must_appear_in_sonuc(client, headers):
    """Turun damga kelimesi SONUÇ beat'inde geçmiyorsa uyarı çıkar."""
    m = _matris(client, headers)
    col_id = m["columns"][0]["id"]
    client.put(f"/matrix/{m['id']}/columns/{col_id}", json={
        "label": "TUR 1: BAŞKAN", "tur_data": {"damga": "ÇÖZÜN"},
    }, headers=headers)
    r = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": col_id, "row_id": m["rows"][0]["id"],
        "data": {"olay": "x", "giris": "a", "gelisme": "b", "sonuc": "Kapı kapanır."},
    }, headers=headers)
    assert any("Damga" in w for w in r.json()["warnings"])
    # Damga geçince uyarı kalkar
    r2 = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": col_id, "row_id": m["rows"][0]["id"],
        "data": {"olay": "x", "giris": "a", "gelisme": "b", "sonuc": "ÇÖZÜN havada kalır."},
    }, headers=headers)
    assert not any("Damga" in w for w in r2.json()["warnings"])


def test_miras_reaches_ai_context_live(client, headers):
    """TUR/PARÇA mirası hücreye kopyalanmaz - bağlamda canlı okunur."""
    m = _matris(client, headers)
    client.post(f"/matrix/{m['id']}/generate-chapters", headers=headers)
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    col_id, row_id = full["columns"][0]["id"], full["rows"][0]["id"]
    cell = full["cells"][0]

    client.put(f"/matrix/{m['id']}/columns/{col_id}", json={
        "label": "TUR 1", "tur_data": {"damga": "ÇÖZÜN", "suc": "ihmal"},
    }, headers=headers)
    client.put(f"/matrix/{m['id']}/rows/{row_id}", json={
        "label": "3. Sorgu", "parca_data": {"no": "3", "sure": "20 dk"},
    }, headers=headers)
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": col_id, "row_id": row_id, "data": {"olay": "Sorgu başlar."},
    }, headers=headers)

    ctx = client.post("/ai/context-preview", json={
        "selected_entities": [], "chapter_number": cell["chapter_number"],
    }, headers=headers).json()["context"]
    assert "OLAY: Sorgu başlar." in ctx
    assert "TUR MİRASI" in ctx and "ÇÖZÜN" in ctx
    assert "PARÇA MİRASI" in ctx and "20 dk" in ctx


def test_chapter_binding_survives_content_only_update(client, headers):
    """chapter_id yollanmayan istek bağı koparmamalı; açık null koparmalı."""
    ch = client.post("/chapters/", json={"number": 1, "title": "B1"}, headers=headers).json()
    m = _matris(client, headers)
    cid, rid = m["columns"][0]["id"], m["rows"][0]["id"]
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": cid, "row_id": rid, "data": {"olay": "ilk"}, "chapter_id": ch["id"],
    }, headers=headers)
    r = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": cid, "row_id": rid, "data": {"olay": "güncel"},
    }, headers=headers)
    assert r.json()["chapter_id"] == ch["id"], "bağ sessizce koptu"
    r2 = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": cid, "row_id": rid, "data": {"olay": "güncel"}, "chapter_id": None,
    }, headers=headers)
    assert r2.json()["chapter_id"] is None, "açık null bağı koparmalı"


def test_quick_plan_survives_deleted_column(client, headers):
    ch = client.post("/chapters/", json={"number": 1, "title": "B1"}, headers=headers).json()
    client.post("/matrix/quick-plan", json={"chapter_id": ch["id"], "content": "plan"}, headers=headers)
    qm = [x for x in client.get("/matrix/", headers=headers).json() if x["name"] == "Hızlı Planlar"][0]
    full = client.get(f"/matrix/{qm['id']}", headers=headers).json()
    client.delete(f"/matrix/{qm['id']}/columns/{full['columns'][0]['id']}", headers=headers)
    ch2 = client.post("/chapters/", json={"number": 2, "title": "B2"}, headers=headers).json()
    r = client.post("/matrix/quick-plan", json={"chapter_id": ch2["id"], "content": "plan2"}, headers=headers)
    assert r.status_code == 200, r.text


def test_free_text_cells_still_work(client, headers):
    """Eski serbest metin yolu bozulmadı - data göndermeyen istek content yazar."""
    m = _matris(client, headers)
    r = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "content": "serbest plan metni",
    }, headers=headers)
    assert r.json()["content"] == "serbest plan metni"
    assert r.json()["warnings"] == []


# --- v1.1: Qwen denetimi sonrası eklenen alanlar --------------------------

def test_sayac_needs_subject(client, headers):
    """SAYAÇ/ATLAMA tek başına boşlukta durmasın - neyin sayacı yazılmalı."""
    m = _matris(client, headers)
    ortak = {"column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"]}
    r = client.put(f"/matrix/{m['id']}/cells", json={
        **ortak, "data": {"olay": "x", "zaman": {"tip": "SAYAC"}},
    }, headers=headers)
    assert any("sayacı" in w for w in r.json()["warnings"])
    r2 = client.put(f"/matrix/{m['id']}/cells", json={
        **ortak, "data": {"olay": "x", "zaman": {"saat": "21:40", "tip": "SAYAC",
                                                 "sayac": "ambulans bekleme süresi"}},
    }, headers=headers)
    assert not any("sayacı" in w for w in r2.json()["warnings"])
    assert "ZAMAN: 21:40 (SAYAÇ: ambulans bekleme süresi)" in r2.json()["content"]


def test_duygu_has_owner(client, headers):
    """Sahipsiz duygu atmosfer olur, karakter olmaz."""
    m = _matris(client, headers)
    ortak = {"column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"]}
    r = client.put(f"/matrix/{m['id']}/cells", json={
        **ortak, "data": {"olay": "x", "duygu": {"baslangic": "güven", "bitis": "şüphe"}},
    }, headers=headers)
    assert any("kime ait" in w for w in r.json()["warnings"])
    r2 = client.put(f"/matrix/{m['id']}/cells", json={
        **ortak, "data": {"olay": "x", "duygu": {"kim": "Palyaço", "baslangic": "güven", "bitis": "şüphe"}},
    }, headers=headers)
    assert "DUYGU: Palyaço: güven → şüphe" in r2.json()["content"]


def test_odak_required_when_multiple_objects(client, headers):
    """Birden çok nesnede dikkat dağılmasın; tek nesnede odak zaten belli."""
    m = _matris(client, headers)
    ortak = {"column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"]}
    coklu = [{"ad": "mendil"}, {"ad": "şişe"}]
    r = client.put(f"/matrix/{m['id']}/cells", json={
        **ortak, "data": {"olay": "x", "nesneler": coklu},
    }, headers=headers)
    assert any("ODAK" in w for w in r.json()["warnings"])
    r2 = client.put(f"/matrix/{m['id']}/cells", json={
        **ortak, "data": {"olay": "x", "nesneler": coklu, "odak": "şişe"},
    }, headers=headers)
    assert not any("ODAK" in w for w in r2.json()["warnings"])
    assert "ODAK: şişe" in r2.json()["content"]
    # Tek nesnede uyarı çıkmamalı
    r3 = client.put(f"/matrix/{m['id']}/cells", json={
        **ortak, "data": {"olay": "x", "nesneler": [{"ad": "mendil"}]},
    }, headers=headers)
    assert not any("ODAK" in w for w in r3.json()["warnings"])


def test_baglanti_must_state_an_action(client, headers):
    """Bağlantı referans etiketi değil, yapılacak iş olmalı."""
    m = _matris(client, headers)
    ortak = {"column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"]}
    r = client.put(f"/matrix/{m['id']}/cells", json={
        **ortak, "data": {"olay": "x", "baglantilar": [{"kod": "MP7", "tur": "ayna"}]},
    }, headers=headers)
    assert any("ne yapılacağını" in w for w in r.json()["warnings"])
    r2 = client.put(f"/matrix/{m['id']}/cells", json={
        **ortak, "data": {"olay": "x", "baglantilar": [
            {"kod": "MP7", "tur": "ayna", "not": "MP7'deki ayna imgesini mendille yansıt"}]},
    }, headers=headers)
    assert "MP7 (ayna) → MP7'deki ayna imgesini mendille yansıt" in r2.json()["content"]


# --- v1.2: ikinci Qwen denetimi sonrası ------------------------------------

def test_damga_check_uses_word_boundary(client, headers):
    """Alt dize araması damgayı başka kelimenin içinde bulup uyarıyı
    yutuyordu: "ÇÖZÜN" damgası "çözünürlüğü" kelimesinde eşleşiyor."""
    m = _matris(client, headers)
    col_id, row_id = m["columns"][0]["id"], m["rows"][0]["id"]
    client.put(f"/matrix/{m['id']}/columns/{col_id}", json={
        "label": "TUR 3", "tur_data": {"damga": "ÇÖZÜN"},
    }, headers=headers)
    kandirmaca = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": col_id, "row_id": row_id,
        "data": {"olay": "x", "giris": "a", "gelisme": "b",
                 "sonuc": "raporun çözünürlüğü düşük fotokopisinin hışırtısıdır."},
    }, headers=headers)
    assert any("Damga" in w for w in kandirmaca.json()["warnings"]), \
        "damga başka kelimenin içinde bulunup uyarı yutuldu"
    gercek = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": col_id, "row_id": row_id,
        "data": {"olay": "x", "giris": "a", "gelisme": "b", "sonuc": "ÇÖZÜN masada asılı kalır."},
    }, headers=headers)
    assert not any("Damga" in w for w in gercek.json()["warnings"])


def test_beat_bloat_is_flagged(client, headers):
    """Beat'e olay dizisi yazılırsa yazan modele kuracak yer kalmaz."""
    m = _matris(client, headers)
    ortak = {"column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"]}
    dizi = ("Vicdan üç ayrı soruyla zemin etüdünün neden üç kat geciktiğini sorar; "
            "Jeolog her üçüne de ayrıntılı cevap verir, tarih sıralamasını kendisi "
            "kurar ve raporun kim tarafından imzalandığını açıklar.")
    r = client.put(f"/matrix/{m['id']}/cells", json={
        **ortak, "data": {"olay": "x", "gelisme": dizi},
    }, headers=headers)
    assert any("olay dizisi" in w for w in r.json()["warnings"])
    r2 = client.put(f"/matrix/{m['id']}/cells", json={
        **ortak, "data": {"olay": "x", "gelisme": "Jeolog sayfayı çevirmeyi reddeder."},
    }, headers=headers)
    assert not any("olay dizisi" in w for w in r2.json()["warnings"])


# --- Denetim promptu -------------------------------------------------------

def test_audit_prompt_finds_structural_faults(client, headers):
    """Sayılabilir kusurlar deterministik bulunur - modele sorulmaz."""
    m = client.post("/matrix/", json={
        "name": "Turlar", "columns": [{"label": "TUR 1"}],
        "rows": [{"label": "1. Giriş"}, {"label": "2. Sorgu"}],
    }, headers=headers).json()
    col_id = m["columns"][0]["id"]
    # Dolu ama BAĞSIZ plan + var olmayan koda referans
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": col_id, "row_id": m["rows"][0]["id"],
        "data": {"olay": "Bir şey olur.", "baglantilar": [
            {"kod": "MP999", "tur": "ayna", "not": "yansıt"}]},
    }, headers=headers)

    r = client.get(f"/matrix/{m['id']}/audit-prompt", headers=headers).json()
    metin = r["prompt"]
    assert "BAĞSIZ PLAN" in metin, "bağlanmamış plan bulunamadı"
    assert "KAYIP REFERANS" in metin and "MP999" in metin
    assert "BOŞ HÜCRE" in metin           # ikinci satır boş
    assert "DAMGASIZ TUR" in metin        # tur_data tanımlanmamış
    assert r["summary"]["dolu_hucre"] == 1
    assert r["summary"]["yapisal_bulgu"] >= 4
    # Sorular da metinde olmalı - kopyalanır kopyalanmaz kullanılabilsin
    assert "SORULAR" in metin and "Çelişki" in metin


def test_audit_prompt_can_scope_to_one_column(client, headers):
    m = client.post("/matrix/", json={
        "name": "T", "columns": [{"label": "TUR 1"}, {"label": "TUR 2"}],
        "rows": [{"label": "1. Giriş"}],
    }, headers=headers).json()
    hedef = m["columns"][0]["id"]
    r = client.get(f"/matrix/{m['id']}/audit-prompt?column_id={hedef}", headers=headers).json()
    assert r["summary"]["kolon_sayisi"] == 1
    assert "TUR 1" in r["prompt"] and "TUR 2" not in r["prompt"]
    assert client.get(f"/matrix/{m['id']}/audit-prompt?column_id=99999",
                      headers=headers).status_code == 404


def test_audit_prompt_clean_matrix_reports_no_faults(client, headers):
    """Temiz planda gürültü üretilmemeli - her plan kusurlu görünmesin."""
    ch = client.post("/chapters/", json={"number": 1, "title": "B1"}, headers=headers).json()
    m = client.post("/matrix/", json={
        "name": "T", "columns": [{"label": "TUR 1"}], "rows": [{"label": "1. Giriş"}],
    }, headers=headers).json()
    col_id = m["columns"][0]["id"]
    client.put(f"/matrix/{m['id']}/columns/{col_id}", json={
        "label": "TUR 1", "tur_data": {"damga": "ÇÖZÜN"},
    }, headers=headers)
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": col_id, "row_id": m["rows"][0]["id"], "chapter_id": ch["id"],
        "data": {"olay": "Sorgu başlar.", "mekan": "Salon",
                 "zaman": {"tip": "NOKTA"},
                 "ortam": {"baslangic": "beklenti"},
                 "duygu": {"kim": "Vicdan", "baslangic": "merak"},
                 "giris": "Kapı açılır.", "gelisme": "Soru sorulur.",
                 "sonuc": "ÇÖZÜN masada kalır."},
    }, headers=headers)
    r = client.get(f"/matrix/{m['id']}/audit-prompt", headers=headers).json()
    assert r["summary"]["yapisal_bulgu"] == 0
    assert "Yapısal kusur bulunamadı" in r["prompt"]
    assert r["summary"]["uyarili_hucre"] == 0


# --- Toplu dışa aktarım ----------------------------------------------------

def _dolu_matris(client, headers):
    ch = client.post("/chapters/", json={"number": 1, "title": "Sorgu"}, headers=headers).json()
    m = client.post("/matrix/", json={
        "name": "Turlar", "columns": [{"label": "TUR 1"}], "rows": [{"label": "1. Giriş"}],
    }, headers=headers).json()
    col_id, row_id = m["columns"][0]["id"], m["rows"][0]["id"]
    client.put(f"/matrix/{m['id']}/columns/{col_id}", json={
        "label": "TUR 1", "tur_data": {"damga": "ÇÖZÜN", "suc": "ihmal"},
    }, headers=headers)
    client.put(f"/matrix/{m['id']}/rows/{row_id}", json={
        "label": "1. Giriş", "instructions": "- Tek cümle",
        "parca_data": {"no": "1", "sure": "20 dk"},
    }, headers=headers)
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": col_id, "row_id": row_id, "chapter_id": ch["id"],
        "data": {"olay": "Sorgu başlar.", "mekan": "Salon"},
    }, headers=headers)
    return m


def test_export_json_carries_everything(client, headers):
    """JSON dökümü yeniden kurulabilecek kadar tam olmalı: miras alanları,
    yapılandırılmış hücre verisi, bölüm bağı, uyarılar."""
    import json as _json
    _dolu_matris(client, headers)
    r = client.get("/matrix/export?format=json", headers=headers)
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"]
    veri = _json.loads(r.content.decode("utf-8"))
    mat = veri["matrisler"][0]
    assert mat["turlar"][0]["tur_mirasi"]["damga"] == "ÇÖZÜN"
    assert mat["asamalar"][0]["parca_mirasi"]["sure"] == "20 dk"
    assert mat["asamalar"][0]["yazim_kisitlari"] == "- Tek cümle"
    h = mat["hucreler"][0]
    assert h["veri"]["olay"] == "Sorgu başlar."
    assert h["bolum"] == 1 and h["kod"]
    assert "OLAY: Sorgu başlar." in h["metin"]
    assert isinstance(h["uyarilar"], list)


def test_export_markdown_is_readable(client, headers):
    _dolu_matris(client, headers)
    r = client.get("/matrix/export?format=md", headers=headers)
    assert r.status_code == 200
    metin = r.content.decode("utf-8")
    assert "# PLAN MATRİSLERİ" in metin
    assert "TUR MİRASI" in metin and "ÇÖZÜN" in metin
    assert "YAZIM KISITLARI: - Tek cümle" in metin
    assert "→ Bölüm 1" in metin


def test_export_scope_and_errors(client, headers):
    m = _dolu_matris(client, headers)
    import json as _json
    tek = _json.loads(client.get(f"/matrix/export?matrix_id={m['id']}",
                                 headers=headers).content.decode("utf-8"))
    assert len(tek["matrisler"]) == 1
    assert client.get("/matrix/export?format=pdf", headers=headers).status_code == 400
    # "export" bir matris kimliği sanılmamalı (yol sırası)
    assert client.get("/matrix/export", headers=headers).status_code == 200


def test_export_keeps_legacy_free_text_cells(client, headers):
    """Eski serbest metinli hücrelerin içeriği dökümde kaybolmamalı."""
    import json as _json
    m = client.post("/matrix/", json={
        "name": "Eski", "columns": [{"label": "K"}], "rows": [{"label": "S"}],
    }, headers=headers).json()
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "content": "serbest plan metni",
    }, headers=headers)
    veri = _json.loads(client.get(f"/matrix/export?matrix_id={m['id']}",
                                  headers=headers).content.decode("utf-8"))
    assert veri["matrisler"][0]["hucreler"][0]["metin"] == "serbest plan metni"


# --- Hedef uzunluk (3 seviye) ---------------------------------------------

def test_uzunluk_three_levels_reach_the_plan_text(client, headers):
    """Etiket değil SOMUT karşılık gitmeli - 'uzun' tek başına modele
    hiçbir şey söylemez."""
    m = _matris(client, headers)
    ortak = {"column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"]}
    beklenen = {
        "ozet": ("ÖZET", "1-2 paragraf"),
        "normal": ("NORMAL", "4-6 paragraf"),
        "uzun": ("UZUN METİN", "8+ paragraf"),
    }
    for seviye, (etiket, olcu) in beklenen.items():
        r = client.put(f"/matrix/{m['id']}/cells", json={
            **ortak, "data": {"olay": "x", "uzunluk": seviye},
        }, headers=headers)
        metin = r.json()["content"]
        assert f"HEDEF UZUNLUK: {etiket}" in metin, f"{seviye} etiketi geçmedi: {metin}"
        assert olcu in metin, f"{seviye} için somut ölçü yok"
        assert r.json()["data"]["uzunluk"] == seviye


def test_uzunluk_defaults_to_normal(client, headers):
    """Belirtilmeyen ya da geçersiz değer normale düşer - uzunluksuz plan,
    modelin her sahnede kendi ölçüsünü seçmesi demek."""
    m = _matris(client, headers)
    ortak = {"column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"]}
    for veri in ({"olay": "x"}, {"olay": "x", "uzunluk": "saçma"}):
        r = client.put(f"/matrix/{m['id']}/cells", json={**ortak, "data": veri}, headers=headers)
        assert r.json()["data"]["uzunluk"] == "normal"
        assert "HEDEF UZUNLUK: NORMAL" in r.json()["content"]


def test_uzunluk_reaches_ai_context(client, headers):
    """Zincirin ucu: seçilen ölçü yazım anında AI'ya gitmeli."""
    m = _matris(client, headers)
    client.post(f"/matrix/{m['id']}/generate-chapters", headers=headers)
    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    cell = full["cells"][0]
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": cell["column_id"], "row_id": cell["row_id"],
        "data": {"olay": "Sorgu başlar.", "uzunluk": "ozet"},
    }, headers=headers)
    ctx = client.post("/ai/context-preview", json={
        "selected_entities": [], "chapter_number": cell["chapter_number"],
    }, headers=headers).json()["context"]
    assert "HEDEF UZUNLUK: ÖZET" in ctx and "sahne AÇILMAZ" in ctx


# --- Paralellik denetimi ---------------------------------------------------

def _paralel_matris(client, headers, turlar=3, satirlar=3):
    return client.post("/matrix/", json={
        "name": "Turlar",
        "columns": [{"label": f"Tur {i}"} for i in range(1, turlar + 1)],
        "rows": [{"label": f"{i}. Sahne"} for i in range(1, satirlar + 1)],
    }, headers=headers).json()


def _doldur(client, headers, m, col_idx, row_idx, uzunluk="normal"):
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][col_idx]["id"], "row_id": m["rows"][row_idx]["id"],
        "data": {"olay": "x", "uzunluk": uzunluk},
    }, headers=headers)


def test_untouched_columns_are_not_reported_as_gaps(client, headers):
    """Hiç başlanmamış turu 'eksik' diye raporlamak gerçek delikleri
    gürültüye gömer - 8 turdan 7'si boşken uyarı yağmuru olmamalı."""
    m = _paralel_matris(client, headers)
    for r in range(3):
        _doldur(client, headers, m, 0, r)
    metin = client.get(f"/matrix/{m['id']}/audit-prompt", headers=headers).json()["prompt"]
    assert "PARALELLİK DELİĞİ" not in metin, "başlanmamış turlar için uyarı üretildi"


def test_gap_in_started_column_is_reported(client, headers):
    """Asıl korku: Tur 1'de 3 sahne dolu, Tur 2'de 2 - yazımda biri
    eksik sahneyle çıkar."""
    m = _paralel_matris(client, headers)
    for r in range(3):
        _doldur(client, headers, m, 0, r)
    _doldur(client, headers, m, 1, 0)
    _doldur(client, headers, m, 1, 2)   # 2. sahne atlandı
    metin = client.get(f"/matrix/{m['id']}/audit-prompt", headers=headers).json()["prompt"]
    delik = [x for x in metin.split("\n") if "PARALELLİK DELİĞİ" in x]
    assert delik and "Tur 2" in delik[0] and "2. Sahne" in delik[0]
    assert not any("Tur 1" in d for d in delik), "eksiksiz tur delik olarak raporlandı"


def test_length_mismatch_across_parallel_cells(client, headers):
    """Aynı satır, farklı ölçü: paralel sahneler farklı boyda çıkar."""
    m = _paralel_matris(client, headers, satirlar=1)
    _doldur(client, headers, m, 0, 0, "ozet")
    _doldur(client, headers, m, 1, 0, "uzun")
    metin = client.get(f"/matrix/{m['id']}/audit-prompt", headers=headers).json()["prompt"]
    uyum = [x for x in metin.split("\n") if "UZUNLUK UYUŞMAZLIĞI" in x]
    assert uyum and "1. Sahne" in uyum[0]
    assert "ozet" in uyum[0] and "uzun" in uyum[0]


def test_aligned_columns_report_clean(client, headers):
    m = _paralel_matris(client, headers, satirlar=2)
    for c in (0, 1):
        for r in (0, 1):
            _doldur(client, headers, m, c, r, "normal")
    metin = client.get(f"/matrix/{m['id']}/audit-prompt", headers=headers).json()["prompt"]
    assert "PARALELLİK DELİĞİ" not in metin and "UZUNLUK UYUŞMAZLIĞI" not in metin


def test_parallel_findings_also_reach_audit_prompt(client, headers):
    m = _paralel_matris(client, headers, satirlar=2)
    _doldur(client, headers, m, 0, 0)
    _doldur(client, headers, m, 0, 1)
    _doldur(client, headers, m, 1, 0)
    metin = client.get(f"/matrix/{m['id']}/audit-prompt", headers=headers).json()["prompt"]
    assert "PARALELLİK DELİĞİ" in metin


def test_sayac_accepts_turkish_spelling_and_renders_it(client, headers):
    """Kullanıcı 'SAYAÇ' yazsa da anahtar ASCII 'SAYAC' saklanır; ekranda
    ve AI metninde Türkçesi görünür."""
    m = _matris(client, headers)
    r = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "data": {"olay": "x", "zaman": {"tarih": "12 Mart 2027", "tip": "SAYAÇ",
                                        "sayac": "ambulansın gelişi"}},
    }, headers=headers)
    assert r.json()["data"]["zaman"]["tip"] == "SAYAC"
    assert "ZAMAN: 12 Mart 2027 (SAYAÇ: ambulansın gelişi)" in r.json()["content"]


def test_atlama_warning_asks_the_right_question(client, headers):
    """ATLAMA'da sorulan şey 'neyin sayacı' değil 'neyden atlandığı'."""
    m = _matris(client, headers)
    r = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "data": {"olay": "x", "zaman": {"tip": "ATLAMA"}},
    }, headers=headers)
    uyari = [w for w in r.json()["warnings"] if "ATLAMA" in w]
    assert uyari and "atlandığı" in uyari[0]


def test_ortam_and_person_emotion_are_separate_arcs(client, headers):
    """Odanın hâli ile kişinin hâli ayrı: asıl değer aradaki farkta.
    Odada gerilim varken Başkan'da korku olması, adamın kalabalığın
    hissettiğinden fazlasını hissettiğini söyler."""
    m = _matris(client, headers)
    r = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "data": {"olay": "x", "mekan": "VIP Salonu",
                 "ortam": {"baslangic": "endişe", "bitis": "korku"},
                 "duygu": {"kim": "Başkan", "baslangic": "soğukkanlılık", "bitis": "panik"}},
    }, headers=headers)
    metin = r.json()["content"]
    assert "ORTAM: endişe → korku" in metin
    assert "DUYGU: Başkan: soğukkanlılık → panik" in metin
    # ORTAM satırı MEKAN'dan hemen sonra gelmeli - ikisi sahnenin yeri ve havası
    satirlar = metin.split("\n")
    assert satirlar[satirlar.index("MEKAN: VIP Salonu") + 1].startswith("ORTAM:")


def test_identical_ortam_and_person_emotion_is_flagged(client, headers):
    """İki alanın varlık sebebi FARK - aynıysa sahne bunu kullanmıyor."""
    m = _matris(client, headers)
    ortak = {"column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"]}
    ayni = client.put(f"/matrix/{m['id']}/cells", json={
        **ortak, "data": {"olay": "x", "ortam": {"baslangic": "gerilim"},
                          "duygu": {"kim": "Başkan", "baslangic": "gerilim"}},
    }, headers=headers)
    assert any("birebir aynı" in w for w in ayni.json()["warnings"])
    farkli = client.put(f"/matrix/{m['id']}/cells", json={
        **ortak, "data": {"olay": "x", "ortam": {"baslangic": "gerilim"},
                          "duygu": {"kim": "Başkan", "baslangic": "korku"}},
    }, headers=headers)
    assert not any("birebir aynı" in w for w in farkli.json()["warnings"])


def test_empty_ortam_is_warned(client, headers):
    m = _matris(client, headers)
    r = client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "data": {"olay": "x"},
    }, headers=headers)
    assert any("ORTAM duygusu boş" in w for w in r.json()["warnings"])


# --- Matris etiketi ve sırası -----------------------------------------------

def test_matrix_label_is_derived_from_chapter_bindings(client, headers):
    """Bölüm aralığı ELLE yazılmaz - bağlardan türetilir, böylece bağ
    değişince ad kendiliğinden düzelir."""
    m = client.post("/matrix/", json={
        "name": "Tur Yapısı", "columns": [{"label": "T1"}, {"label": "T2"}],
        "rows": [{"label": "S1"}],
    }, headers=headers).json()
    ozet = lambda: [x for x in client.get("/matrix/", headers=headers).json() if x["id"] == m["id"]][0]
    assert ozet()["chapter_label"] is None, "bağ yokken aralık uydurulmamalı"

    a = client.post("/chapters/", json={"number": 5, "title": "A"}, headers=headers).json()
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][0]["id"], "row_id": m["rows"][0]["id"],
        "chapter_id": a["id"], "data": {"olay": "x"}}, headers=headers)
    assert ozet()["chapter_label"] == "5. Bölüm", "tek bölümde aralık gösterilmemeli"

    b = client.post("/chapters/", json={"number": 12, "title": "B"}, headers=headers).json()
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": m["columns"][1]["id"], "row_id": m["rows"][0]["id"],
        "chapter_id": b["id"], "data": {"olay": "y"}}, headers=headers)
    o = ozet()
    assert o["chapter_label"] == "5-12. Bölüm"
    assert o["chapter_min"] == 5 and o["chapter_max"] == 12


def test_matrix_order_and_move(client, headers):
    """Araya ekleme: yeni matris sona açılır, sonra yerine taşınır."""
    adlar = ["A", "B", "C"]
    for ad in adlar:
        client.post("/matrix/", json={"name": ad, "columns": [{"label": "K"}],
                                      "rows": [{"label": "S"}]}, headers=headers)
    sirala = lambda: [x["name"] for x in client.get("/matrix/", headers=headers).json()]
    assert sirala() == ["A", "B", "C"]

    c_id = [x for x in client.get("/matrix/", headers=headers).json() if x["name"] == "C"][0]["id"]
    assert client.post(f"/matrix/{c_id}/move?direction=up", headers=headers).json()["moved"]
    assert sirala() == ["A", "C", "B"]
    assert client.post(f"/matrix/{c_id}/move?direction=up", headers=headers).json()["moved"]
    assert sirala() == ["C", "A", "B"]
    # Uçtaki matris daha yukarı gitmez ama hata da vermez
    assert client.post(f"/matrix/{c_id}/move?direction=up", headers=headers).json()["moved"] is False
    assert sirala() == ["C", "A", "B"]
    assert client.post(f"/matrix/{c_id}/move?direction=yan", headers=headers).status_code == 400
