"""Menü verisi için değişiklik geçmişi (EntitySnapshot) - description/notes/
sections/aliases/tags/status alanlarından biri üzerine yazıldığında eski
hali kaydediliyor mu, gereksiz (değişmeyen alan için) kayıt oluşmuyor mu,
ve geri yükleme (restore) gerçekten çalışıyor mu."""


def test_changing_a_field_saves_the_old_value(client, headers):
    r = client.post("/characters/", json={"name": "Ahmet", "notes": "İlk not - önemli bir sır"}, headers=headers)
    char_id = r.json()["id"]

    client.put(f"/characters/{char_id}", json={"notes": "YANLIŞLIKLA ÜZERİNE YAZILDI"}, headers=headers)

    r = client.get(f"/entity-history/character/{char_id}", headers=headers)
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["field_name"] == "notes"
    assert r.json()[0]["old_value"] == "İlk not - önemli bir sır"


def test_unchanged_field_does_not_create_a_snapshot(client, headers):
    """Frontend formu her zaman TÜM alanları (status dahil) gönderir - status
    değişmediği halde her PUT'ta bir 'değişiklik' kaydı oluşmamalı, yoksa
    geçmiş anlamsız kayıtlarla dolar."""
    r = client.post("/characters/", json={"name": "Ahmet", "status": "aktif"}, headers=headers)
    char_id = r.json()["id"]

    client.put(f"/characters/{char_id}", json={"status": "aktif", "notes": "yeni not"}, headers=headers)

    r = client.get(f"/entity-history/character/{char_id}", headers=headers)
    field_names = {h["field_name"] for h in r.json()}
    assert "status" not in field_names
    assert "notes" not in field_names  # notes de eskiden boştu (kaybedecek bir şey yoktu)


def test_empty_old_value_does_not_create_a_snapshot(client, headers):
    r = client.post("/characters/", json={"name": "Ahmet"}, headers=headers)  # notes boş
    char_id = r.json()["id"]

    client.put(f"/characters/{char_id}", json={"notes": "ilk gerçek not"}, headers=headers)

    r = client.get(f"/entity-history/character/{char_id}", headers=headers)
    assert r.json() == []


def test_dict_field_snapshot_preserves_type(client, headers):
    """sections dict tipinde - geçmişte de dict olarak (JSON string değil)
    dönmeli, ki frontend'in formatHistoryValue'su doğru çalışsın."""
    r = client.post("/characters/", json={
        "name": "Ahmet", "sections": {"gecmis": "eski bir savaşta yaralandı"},
    }, headers=headers)
    char_id = r.json()["id"]

    client.put(f"/characters/{char_id}", json={"sections": {"gecmis": "DEĞİŞTİRİLDİ"}}, headers=headers)

    r = client.get(f"/entity-history/character/{char_id}", headers=headers)
    snap = next(h for h in r.json() if h["field_name"] == "sections")
    assert snap["old_value"] == {"gecmis": "eski bir savaşta yaralandı"}
    assert isinstance(snap["old_value"], dict)


def test_restore_brings_back_the_old_value(client, headers):
    r = client.post("/characters/", json={"name": "Ahmet", "notes": "kaybolmasın istediğim not"}, headers=headers)
    char_id = r.json()["id"]
    client.put(f"/characters/{char_id}", json={"notes": "yanlışlıkla silindi"}, headers=headers)

    history = client.get(f"/entity-history/character/{char_id}", headers=headers).json()
    snapshot_id = history[0]["id"]

    r = client.post(f"/entity-history/{snapshot_id}/restore", headers=headers)
    assert r.status_code == 200
    assert r.json()["restored_value"] == "kaybolmasın istediğim not"

    r = client.get(f"/characters/{char_id}", headers=headers)
    assert r.json()["notes"] == "kaybolmasın istediğim not"


def test_restore_itself_is_undoable(client, headers):
    """Geri yükleme de bir 'değişiklik' - kazara yanlış bir snapshot'ı geri
    yüklersen, onu da geri alabilmelisin (redo gibi)."""
    r = client.post("/characters/", json={"name": "Ahmet", "notes": "v1"}, headers=headers)
    char_id = r.json()["id"]
    client.put(f"/characters/{char_id}", json={"notes": "v2"}, headers=headers)

    history = client.get(f"/entity-history/character/{char_id}", headers=headers).json()
    client.post(f"/entity-history/{history[0]['id']}/restore", headers=headers)

    history_after = client.get(f"/entity-history/character/{char_id}", headers=headers).json()
    assert len(history_after) == 2  # orijinal "v1" kaydı + restore'un bıraktığı "v2" kaydı


def test_history_is_scoped_to_universe(client, auth_headers):
    """İki farklı evrendeki aynı id'li (ya da farklı id'li) kayıtların
    geçmişi birbirine karışmamalı."""
    r1 = client.post("/novels/", json={"name": "Roman A"}, headers=auth_headers)
    h1 = dict(auth_headers, **{"X-Novel-Id": str(r1.json()["id"])})
    r2 = client.post("/novels/", json={"name": "Roman B"}, headers=auth_headers)
    h2 = dict(auth_headers, **{"X-Novel-Id": str(r2.json()["id"])})

    c1 = client.post("/characters/", json={"name": "Ahmet", "notes": "A evreni notu"}, headers=h1).json()
    client.put(f"/characters/{c1['id']}", json={"notes": "değişti"}, headers=h1)

    r = client.get(f"/entity-history/character/{c1['id']}", headers=h2)
    assert r.json() == []  # B evreninden A evreninin geçmişi görünmemeli


def test_restoring_deleted_entity_returns_404(client, headers):
    r = client.post("/characters/", json={"name": "Ahmet", "notes": "v1"}, headers=headers)
    char_id = r.json()["id"]
    client.put(f"/characters/{char_id}", json={"notes": "v2"}, headers=headers)
    history = client.get(f"/entity-history/character/{char_id}", headers=headers).json()

    client.delete(f"/characters/{char_id}", headers=headers)

    r = client.post(f"/entity-history/{history[0]['id']}/restore", headers=headers)
    assert r.status_code == 404


def test_lifespan_changes_are_tracked(client, headers):
    """Varoluş tarihini kaydırmak BÜTÜN sahnelerin geçerliliğini değiştirir -
    geri dönülemeyen bir değişiklik olmamalı."""
    k = client.post("/characters/", json={
        "name": "Vicdan", "var_olus": "28 Haziran 2030"}, headers=headers).json()
    client.put(f"/characters/{k['id']}", json={
        "name": "Vicdan", "var_olus": "1 Temmuz 2030", "yok_olus": "9 Temmuz 2030"},
        headers=headers)

    gecmis = client.get(f"/entity-history/character/{k['id']}", headers=headers).json()
    alanlar = {x["field_name"] for x in gecmis}
    assert "var_olus" in alanlar, "varoluş değişikliği izlenmedi"
    eski = [x for x in gecmis if x["field_name"] == "var_olus"][0]
    assert eski["old_value"] == "28 Haziran 2030", "eski değer saklanmadı"
