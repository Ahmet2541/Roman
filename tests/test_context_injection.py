"""build_dynamic_layer'ın otomatik enjekte ettiği iki şey: mekan ata
zinciri (parent_place_id) ve karakterin faksiyon üyeliği. İkisi de
'yazarın elle yazmasına gerek kalmasın, veri tek yerde tutulsun' fikrinin
somut testleri."""
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.qwen_client import build_dynamic_layer
from app import schemas


def _db():
    Session = sessionmaker(bind=engine)
    return Session()


def test_place_ancestor_chain_is_injected(client, headers, novel):
    r = client.post("/places/", json={"name": "Kuzey Krallığı"}, headers=headers)
    kingdom = r.json()
    r = client.post("/places/", json={"name": "Buz Şehri", "parent_place_id": kingdom["id"]}, headers=headers)
    city = r.json()
    r = client.post("/places/", json={"name": "Kraliyet Sarayı", "parent_place_id": city["id"]}, headers=headers)
    palace = r.json()

    db = _db()
    ref = schemas.EntityRef(entity_type="place", entity_id=palace["id"])
    context = build_dynamic_layer(db, novel["universe_id"], [ref])
    assert "Nerede: Buz Şehri, Kuzey Krallığı içinde" in context


def test_place_without_parent_has_no_nerede_line(client, headers, novel):
    r = client.post("/places/", json={"name": "Yalnız Ada"}, headers=headers)
    place = r.json()
    db = _db()
    ref = schemas.EntityRef(entity_type="place", entity_id=place["id"])
    context = build_dynamic_layer(db, novel["universe_id"], [ref])
    assert "Nerede:" not in context


def test_faction_membership_is_injected(client, headers, novel):
    r = client.post("/characters/", json={"name": "Ahmet"}, headers=headers)
    char = r.json()
    r = client.post("/factions/", json={"name": "Kuzey Hanedanı"}, headers=headers)
    faction = r.json()
    client.post("/faction-memberships/", json={"faction_id": faction["id"], "character_id": char["id"], "role": "Muhafız"}, headers=headers)

    db = _db()
    ref = schemas.EntityRef(entity_type="character", entity_id=char["id"])
    context = build_dynamic_layer(db, novel["universe_id"], [ref])
    assert "Faksiyon üyeliği: Kuzey Hanedanı (Muhafız)" in context


def test_character_without_faction_has_no_faction_line(client, headers, novel):
    r = client.post("/characters/", json={"name": "Bağımsız"}, headers=headers)
    char = r.json()
    db = _db()
    ref = schemas.EntityRef(entity_type="character", entity_id=char["id"])
    context = build_dynamic_layer(db, novel["universe_id"], [ref])
    assert "Faksiyon üyeliği" not in context


def test_meta_section_never_appears_in_ai_context(client, headers, novel):
    r = client.post("/characters/", json={"name": "Gizli", "sections": {"meta": "bu sır AI'ya gitmemeli"}}, headers=headers)
    char = r.json()
    db = _db()
    ref = schemas.EntityRef(entity_type="character", entity_id=char["id"])
    context = build_dynamic_layer(db, novel["universe_id"], [ref])
    assert "bu sır AI'ya gitmemeli" not in context
