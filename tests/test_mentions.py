"""mentions.py'nin alias desteği: bir karakter 'Aeron' unvanıyla da
anılıyorsa, metinde asıl ismi ('Başkan') hiç geçmese bile mention
tespit edilmeli."""


def test_alias_mention_is_detected_without_primary_name(client, headers):
    r = client.post("/characters/", json={"name": "Başkan", "aliases": ["Aeron", "Majesteleri"]}, headers=headers)
    char_id = r.json()["id"]

    r = client.post("/chapters/", json={"number": 1, "title": "Bölüm", "kind": "chapter"}, headers=headers)
    chapter_id = r.json()["id"]
    r = client.put(f"/chapters/{chapter_id}/paragraphs/1", json={"number": 1, "text": "Aeron o gece hiç uyumadı."}, headers=headers)
    assert r.status_code == 200

    r = client.get("/chapters/search", params={"entity_type": "character", "entity_id": char_id}, headers=headers)
    assert len(r.json()) == 1
    assert "Aeron" in r.json()[0]["text_preview"]


def test_primary_name_still_works_alongside_aliases(client, headers):
    r = client.post("/characters/", json={"name": "General Kara", "aliases": ["Kumandan"]}, headers=headers)
    char_id = r.json()["id"]
    r = client.post("/chapters/", json={"number": 1, "title": "B", "kind": "chapter"}, headers=headers)
    chapter_id = r.json()["id"]
    client.put(f"/chapters/{chapter_id}/paragraphs/1", json={"number": 1, "text": "General Kara limana geldi."}, headers=headers)

    r = client.get("/chapters/search", params={"entity_type": "character", "entity_id": char_id}, headers=headers)
    assert len(r.json()) == 1


def test_no_false_positive_for_unrelated_text(client, headers):
    r = client.post("/characters/", json={"name": "Ela", "aliases": []}, headers=headers)
    char_id = r.json()["id"]
    r = client.post("/chapters/", json={"number": 1, "title": "B", "kind": "chapter"}, headers=headers)
    chapter_id = r.json()["id"]
    client.put(f"/chapters/{chapter_id}/paragraphs/1", json={"number": 1, "text": "Deniz sakindi, hiçbir şey olmadı."}, headers=headers)

    r = client.get("/chapters/search", params={"entity_type": "character", "entity_id": char_id}, headers=headers)
    assert len(r.json()) == 0


def test_turkish_uppercase_i_dotted_undotted_matches_correctly(client, headers):
    """Python'un varsayılan str.lower()'ı Türkçe İ/I harflerini yanlış
    çevirir: 'I'.lower() -> 'i' (Türkçe kuralında 'ı' olmalı), 'İ'.lower()
    -> birleşik karakterli 'i' (tek bir 'i' değil). Bu yüzden bir karakter
    "Yaşlı Teknisyen" olarak kayıtlıyken metinde TAMAMEN BÜYÜK HARFLE
    ("YAŞLI TEKNİSYEN") geçerse mention tespiti sessizce başarısız
    oluyordu - bkz. mentions.turkish_lower()."""
    r = client.post("/characters/", json={"name": "Yaşlı Teknisyen"}, headers=headers)
    char_id = r.json()["id"]

    r = client.post("/chapters/", json={"number": 1, "kind": "chapter"}, headers=headers)
    chapter_id = r.json()["id"]
    r = client.put(
        f"/chapters/{chapter_id}/paragraphs/1",
        json={"number": 1, "text": "YAŞLI TEKNİSYEN kapıdan içeri girdi ve oturdu."},
        headers=headers,
    )
    assert r.status_code == 200

    r = client.get("/chapters/search", params={"entity_type": "character", "entity_id": char_id}, headers=headers)
    assert len(r.json()) == 1


def test_turkish_lowercase_dotless_i_matches_correctly(client, headers):
    """Aynı hatanın tersi yönü: kayıtlı isimde büyük 'I' (İstanbul gibi)
    varken metinde küçük 'ı' ile geçtiğinde de eşleşmeli."""
    r = client.post("/characters/", json={"name": "IŞIK"}, headers=headers)
    char_id = r.json()["id"]

    r = client.post("/chapters/", json={"number": 1, "kind": "chapter"}, headers=headers)
    chapter_id = r.json()["id"]
    r = client.put(
        f"/chapters/{chapter_id}/paragraphs/1",
        json={"number": 1, "text": "Işık pencereden içeri vurdu."},
        headers=headers,
    )
    assert r.status_code == 200

    r = client.get("/chapters/search", params={"entity_type": "character", "entity_id": char_id}, headers=headers)
    assert len(r.json()) == 1
