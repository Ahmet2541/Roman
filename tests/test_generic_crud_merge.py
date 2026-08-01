"""generic_crud.py'nin PUT'ta dict alanları (sections gibi) YERİNE koymak
yerine BİRLEŞTİRMESİ (merge) - kullanıcı isteğiydi, kritik davranış."""


def test_put_sections_merges_does_not_overwrite_other_keys(client, headers):
    r = client.post("/characters/", json={
        "name": "Ahmet",
        "sections": {"duygusal_yapi": "soğukkanlı", "konusma_tarzi": "eski asker"},
    }, headers=headers)
    char_id = r.json()["id"]

    r = client.put(f"/characters/{char_id}", json={"sections": {"gecmis": "eski bir savaşta yaralandı"}}, headers=headers)
    assert r.status_code == 200
    assert r.json()["sections"] == {
        "duygusal_yapi": "soğukkanlı",
        "konusma_tarzi": "eski asker",
        "gecmis": "eski bir savaşta yaralandı",
    }


def test_put_sections_can_overwrite_an_existing_key_without_touching_others(client, headers):
    r = client.post("/characters/", json={
        "name": "Zeynep",
        "sections": {"duygusal_yapi": "eski hali", "konusma_tarzi": "eski asker"},
    }, headers=headers)
    char_id = r.json()["id"]

    r = client.put(f"/characters/{char_id}", json={"sections": {"duygusal_yapi": "yeni hali"}}, headers=headers)
    assert r.json()["sections"]["duygusal_yapi"] == "yeni hali"
    assert r.json()["sections"]["konusma_tarzi"] == "eski asker"


def test_unknown_section_key_is_rejected_with_422(client, headers):
    r = client.post("/characters/", json={"name": "Hatalı", "sections": {"duygusl_yapi": "yazim hatasi"}}, headers=headers)
    assert r.status_code == 422


def test_meta_section_can_be_saved_by_user(client, headers):
    r = client.post("/characters/", json={"name": "Sembolik", "sections": {"meta": "umudu temsil ediyor"}}, headers=headers)
    assert r.status_code == 201
    assert r.json()["sections"]["meta"] == "umudu temsil ediyor"


def test_aliases_persist_and_are_returned_as_list(client, headers):
    r = client.post("/characters/", json={"name": "Başkan", "aliases": ["Aeron", "Majesteleri"]}, headers=headers)
    assert r.status_code == 201
    assert r.json()["aliases"] == ["Aeron", "Majesteleri"]

    char_id = r.json()["id"]
    r = client.get(f"/characters/{char_id}", headers=headers)
    assert r.json()["aliases"] == ["Aeron", "Majesteleri"]


def test_character_without_aliases_returns_empty_list_not_null(client, headers):
    r = client.post("/characters/", json={"name": "Sıradan Karakter"}, headers=headers)
    assert r.status_code == 201
    assert r.json()["aliases"] == []


def test_rule_tags_persist(client, headers):
    r = client.post("/rules/", json={"title": "Büyü Kuralı", "description": "Ateş suyla söner", "tags": ["buyu"]}, headers=headers)
    assert r.status_code == 201
    assert r.json()["tags"] == ["buyu"]


def test_objects_without_sections_field_still_work_generically(client, headers):
    """sections/aliases'i olmayan basit varlık tiplerinin (Nesneler gibi)
    generic_crud merge mantığından etkilenmediğini doğrular - regresyon
    kontrolü."""
    r = client.post("/objects/", json={"name": "Kılıç", "description": "eski bir kılıç"}, headers=headers)
    assert r.status_code == 201
    r2 = client.put(f"/objects/{r.json()['id']}", json={"description": "yeni açıklama"}, headers=headers)
    assert r2.status_code == 200
    assert r2.json()["description"] == "yeni açıklama"
