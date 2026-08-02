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


def test_chat_context_includes_chapter_text_and_outline_map(client, headers):
    """Sohbette AI, üzerinde çalışılan bölümün METNİNİ ve fihrist
    numaralarını ("1-1" gibi) görmeli - "bu bölümü konuşalım" ya da
    "Kısım 1.1" atıfları ancak böyle çözülebilir."""
    from app.qwen_client import build_context, build_outline_layer, build_current_chapter_layer
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app import models

    part = client.post("/chapters/", json={"number": 1, "kind": "part", "title": "BİRİNCİ KISIM"}, headers=headers).json()
    ch = client.post("/chapters/", json={"number": 2, "kind": "chapter", "title": "Açılış"}, headers=headers).json()
    client.put(f"/chapters/{ch['id']}/paragraphs/1", json={"number": 1, "text": "Kule uzaktan görünüyordu."}, headers=headers)

    db = sessionmaker(bind=engine)()
    novel_id = int(headers["X-Novel-Id"])
    universe_id = db.query(models.Novel).filter(models.Novel.id == novel_id).first().universe_id

    outline = build_outline_layer(db, universe_id, novel_id)
    assert "FİHRİST HARİTASI" in outline
    assert "BİRİNCİ KISIM" in outline and "[KISIM]" in outline
    assert "1-1" in outline  # kısmın altındaki bölüm hiyerarşik numara aldı

    text_layer = build_current_chapter_layer(db, novel_id, 2)
    assert "ÜZERİNDE ÇALIŞILAN BÖLÜMÜN METNİ" in text_layer
    assert "[P1] Kule uzaktan görünüyordu." in text_layer

    # Sohbet bağlamı (include_chapter_text=True) metni İÇERİR
    ctx_chat = build_context(db, novel_id, universe_id, [], chapter_number=2, include_chapter_text=True)
    assert "Kule uzaktan görünüyordu" in ctx_chat
    assert "FİHRİST HARİTASI" in ctx_chat
    # Talimat bağlamı (varsayılan) metni TEKRAR etmez - existing_text ile gidiyor
    ctx_assist = build_context(db, novel_id, universe_id, [], chapter_number=2)
    assert "ÜZERİNDE ÇALIŞILAN BÖLÜMÜN METNİ" not in ctx_assist
