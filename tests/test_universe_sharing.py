"""Universe/Novel ayrımının asıl vaat ettiği şey: aynı serinin kitapları
karakter/mekan/kural havuzunu paylaşsın, ama bir kitabı silmek bu paylaşılan
veriyi SİLMESİN. Bu dosya tam bunu doğruluyor."""


def test_new_novel_without_universe_id_creates_its_own_universe(client, auth_headers):
    r = client.post("/novels/", json={"name": "Yalnız Roman"}, headers=auth_headers)
    assert r.status_code == 201
    novel = r.json()
    assert novel["universe_id"] is not None


def test_second_book_in_same_universe_shares_characters(client, auth_headers):
    r = client.post("/novels/", json={"name": "Seri Kitap 1"}, headers=auth_headers)
    book1 = r.json()
    universe_id = book1["universe_id"]
    h1 = dict(auth_headers, **{"X-Novel-Id": str(book1["id"])})

    r = client.post("/characters/", json={"name": "Kahraman"}, headers=h1)
    assert r.status_code == 201
    char_id = r.json()["id"]

    r = client.post("/novels/", json={"name": "Seri Kitap 2", "universe_id": universe_id, "book_number": 2}, headers=auth_headers)
    assert r.status_code == 201
    book2 = r.json()
    assert book2["universe_id"] == universe_id
    h2 = dict(auth_headers, **{"X-Novel-Id": str(book2["id"])})

    r = client.get("/characters/", headers=h2)
    assert r.status_code == 200
    names = [c["name"] for c in r.json()]
    assert "Kahraman" in names, "Kitap 2, Kitap 1 ile aynı evrenin karakterini görmeli"
    assert r.json()[0]["id"] == char_id


def test_deleting_novel_does_not_delete_shared_universe_data(client, auth_headers):
    r = client.post("/novels/", json={"name": "Silinecek Kitap"}, headers=auth_headers)
    book = r.json()
    h = dict(auth_headers, **{"X-Novel-Id": str(book["id"])})

    r = client.post("/characters/", json={"name": "Kalıcı Karakter"}, headers=h)
    char_id = r.json()["id"]
    r = client.post("/chapters/", json={"number": 1, "title": "Bölüm", "kind": "chapter"}, headers=h)
    chapter_id = r.json()["id"]

    r = client.delete(f"/novels/{book['id']}", headers=h)
    assert r.status_code == 204

    # Karakter evren düzeyinde olduğu için silinmemeli - ama artık bu
    # kitap yok, o yüzden BAŞKA bir kitap üzerinden (aynı evrende yeni bir
    # kitap açıp) doğrulamamız lazım.
    r = client.post("/novels/", json={"name": "Yeni Kitap", "universe_id": book["universe_id"]}, headers=auth_headers)
    h2 = dict(auth_headers, **{"X-Novel-Id": str(r.json()["id"])})
    r = client.get("/characters/", headers=h2)
    names = [c["name"] for c in r.json()]
    assert "Kalıcı Karakter" in names, "Kitap silinince evren verisi silinmemeli"

    # Ama silinen kitabın BÖLÜMÜ artık erişilemez olmalı (o kitaba özeldi)
    r = client.get(f"/chapters/{chapter_id}", headers=h)
    assert r.status_code == 404


def test_deleting_universe_deletes_everything(client, auth_headers):
    r = client.post("/novels/", json={"name": "Tamamen Silinecek Seri"}, headers=auth_headers)
    book = r.json()
    universe_id = book["universe_id"]
    h = dict(auth_headers, **{"X-Novel-Id": str(book["id"])})
    client.post("/characters/", json={"name": "Yok Olacak"}, headers=h)

    r = client.delete(f"/universes/{universe_id}", headers=auth_headers)
    assert r.status_code == 204

    r = client.get("/novels/", headers=auth_headers)
    remaining_ids = [n["id"] for n in r.json()]
    assert book["id"] not in remaining_ids, "Evren silinince kitap da silinmeli"


def test_novel_list_shows_universe_name(client, auth_headers):
    r = client.post("/novels/", json={"name": "İsim Kontrolü"}, headers=auth_headers)
    book = r.json()
    r = client.get("/novels/", headers=auth_headers)
    found = next(n for n in r.json() if n["id"] == book["id"])
    assert found["universe_name"] == "İsim Kontrolü"
