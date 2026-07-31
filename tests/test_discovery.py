"""AI keşif fonksiyonlarının (ilişki/olay önerisi) DB mantığı - Qwen
çağrısı mock'lanır, gerçek DB ile: tekilleştirme, kısa devre (Qwen'e hiç
gitmeden boş dönme), ve olaylar için deterministik story_order hesabı."""
import json
from unittest.mock import patch, MagicMock

from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.qwen_client import suggest_relationships_for_chapters, suggest_events_for_chapters


def _db():
    Session = sessionmaker(bind=engine)
    return Session()


def _fake_qwen_response(payload: dict):
    resp = MagicMock()
    resp.choices = [MagicMock(message=MagicMock(content=json.dumps(payload)))]
    return resp


def test_relationship_suggestion_skips_qwen_call_with_fewer_than_two_characters(client, headers, novel):
    client.post("/characters/", json={"name": "Yalnız Karakter"}, headers=headers)
    r = client.post("/chapters/", json={"number": 1, "title": "B", "kind": "chapter"}, headers=headers)
    chapter_id = r.json()["id"]
    client.put(f"/chapters/{chapter_id}/paragraphs/1", json={"number": 1, "text": "Bir şeyler oldu."}, headers=headers)

    db = _db()
    from app import models
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()

    with patch("app.qwen_client.get_client") as mock_get_client:
        result = suggest_relationships_for_chapters(db, [chapter])
        mock_get_client.assert_not_called()
    assert result == []


def test_relationship_suggestion_deduplicates_against_existing(client, headers, novel):
    r = client.post("/characters/", json={"name": "A"}, headers=headers)
    char_a = r.json()["id"]
    r = client.post("/characters/", json={"name": "B"}, headers=headers)
    char_b = r.json()["id"]
    client.post("/relationships/", json={"character_a_id": char_a, "character_b_id": char_b, "label": "kardeşi"}, headers=headers)

    r = client.post("/chapters/", json={"number": 1, "title": "B", "kind": "chapter"}, headers=headers)
    chapter_id = r.json()["id"]
    client.put(f"/chapters/{chapter_id}/paragraphs/1", json={"number": 1, "text": "A ve B konuştu."}, headers=headers)

    db = _db()
    from app import models
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()

    fake = _fake_qwen_response({"relationships": [
        {"character_a_id": char_a, "character_b_id": char_b, "label": "kardeşi (tekrar)", "notes": ""},
    ]})
    with patch("app.qwen_client.get_client") as mock_get_client:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = fake
        mock_get_client.return_value = mock_client
        result = suggest_relationships_for_chapters(db, [chapter])

    assert result == [], "Zaten kayıtlı bir ilişki (yön farketmeksizin) tekrar önerilmemeli"


def test_relationship_suggestion_returns_new_pair(client, headers, novel):
    r = client.post("/characters/", json={"name": "A"}, headers=headers)
    char_a = r.json()["id"]
    r = client.post("/characters/", json={"name": "B"}, headers=headers)
    char_b = r.json()["id"]
    r = client.post("/chapters/", json={"number": 1, "title": "B", "kind": "chapter"}, headers=headers)
    chapter_id = r.json()["id"]
    client.put(f"/chapters/{chapter_id}/paragraphs/1", json={"number": 1, "text": "A ve B konuştu."}, headers=headers)

    db = _db()
    from app import models
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()

    fake = _fake_qwen_response({"relationships": [
        {"character_a_id": char_a, "character_b_id": char_b, "label": "danışmanı", "notes": "not"},
    ]})
    with patch("app.qwen_client.get_client") as mock_get_client:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = fake
        mock_get_client.return_value = mock_client
        result = suggest_relationships_for_chapters(db, [chapter])

    assert len(result) == 1
    assert result[0]["label"] == "danışmanı"


def test_event_suggestion_computes_deterministic_non_colliding_story_order(client, headers, novel):
    r = client.post("/chapters/", json={"number": 5, "title": "B", "kind": "chapter"}, headers=headers)
    chapter_id = r.json()["id"]
    client.put(f"/chapters/{chapter_id}/paragraphs/1", json={"number": 1, "text": "Bir şeyler oldu."}, headers=headers)

    db = _db()
    from app import models
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()

    fake = _fake_qwen_response({"events": [
        {"name": "Olay 1", "description": "", "character_ids": [], "place_id": None, "chapter_number": 5},
        {"name": "Olay 2", "description": "", "character_ids": [], "place_id": None, "chapter_number": 5},
    ]})
    with patch("app.qwen_client.get_client") as mock_get_client:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = fake
        mock_get_client.return_value = mock_client
        result = suggest_events_for_chapters(db, [chapter])

    assert len(result) == 2
    assert result[0]["story_order"] == 5000
    assert result[1]["story_order"] == 5001
    assert result[0]["story_order"] != result[1]["story_order"], "Aynı bölümdeki iki olay ÇAKIŞMAMALI"


def test_event_suggestion_skips_events_matching_existing_name(client, headers, novel):
    client.post("/events/", json={"name": "Zaten Var Olan Olay"}, headers=headers)
    r = client.post("/chapters/", json={"number": 1, "title": "B", "kind": "chapter"}, headers=headers)
    chapter_id = r.json()["id"]
    client.put(f"/chapters/{chapter_id}/paragraphs/1", json={"number": 1, "text": "x"}, headers=headers)

    db = _db()
    from app import models
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()

    fake = _fake_qwen_response({"events": [
        {"name": "Zaten Var Olan Olay", "description": "", "character_ids": [], "place_id": None, "chapter_number": 1},
    ]})
    with patch("app.qwen_client.get_client") as mock_get_client:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = fake
        mock_get_client.return_value = mock_client
        result = suggest_events_for_chapters(db, [chapter])

    assert result == [], "Aynı isimde zaten kayıtlı bir olay tekrar önerilmemeli"


def test_event_suggestion_resolves_place_and_character_names(client, headers, novel):
    r = client.post("/characters/", json={"name": "Kahraman"}, headers=headers)
    char_id = r.json()["id"]
    r = client.post("/places/", json={"name": "Kale"}, headers=headers)
    place_id = r.json()["id"]
    r = client.post("/chapters/", json={"number": 1, "title": "B", "kind": "chapter"}, headers=headers)
    chapter_id = r.json()["id"]
    client.put(f"/chapters/{chapter_id}/paragraphs/1", json={"number": 1, "text": "x"}, headers=headers)

    db = _db()
    from app import models
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()

    fake = _fake_qwen_response({"events": [
        {"name": "Yeni Olay", "description": "", "character_ids": [char_id], "place_id": place_id, "chapter_number": 1},
    ]})
    with patch("app.qwen_client.get_client") as mock_get_client:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = fake
        mock_get_client.return_value = mock_client
        result = suggest_events_for_chapters(db, [chapter])

    assert result[0]["place_name"] == "Kale"
    assert result[0]["character_names"] == ["Kahraman"]
