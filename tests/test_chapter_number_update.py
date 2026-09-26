"""Regression: insertAfterNumber must actually free a slot before creation."""
import pytest


def create(client, headers, number, kind="chapter"):
    response = client.post("/chapters/", headers=headers, json={
        "number": number, "kind": kind, "title": f"Entry {number}",
    })
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize("kind", ["chapter", "subtitle"])
def test_insert_inside_outline_preserves_existing_content(client, headers, kind):
    part = create(client, headers, 1, "part")
    following = create(client, headers, 2)
    last = create(client, headers, 3, "part")
    response = client.put(f"/chapters/{following['id']}/paragraphs/1",
                          headers=headers, json={"number": 1, "text": "Existing text"})
    assert response.status_code == 200, response.text
    # Same descending sequence used by the create modal.
    for entry in [last, following]:
        response = client.put(f"/chapters/{entry['id']}", headers=headers,
                              json={"number": entry["number"] + 1})
        assert response.status_code == 200, response.text
        assert response.json()["number"] == entry["number"] + 1
    inserted = create(client, headers, 2, kind)
    outline = client.get("/chapters/", headers=headers).json()
    assert [entry["id"] for entry in outline] == [
        part["id"], inserted["id"], following["id"], last["id"],
    ]
    original = client.get(f"/chapters/{following['id']}", headers=headers).json()
    assert original["paragraphs"][0]["text"] == "Existing text"


def test_number_conflict_is_rejected_without_changing_entries(client, headers):
    first = create(client, headers, 1)
    second = create(client, headers, 2)
    response = client.put(f"/chapters/{second['id']}", headers=headers, json={"number": 1})
    assert response.status_code == 400
    assert client.get(f"/chapters/{second['id']}", headers=headers).json()["number"] == 2
    response = client.put(f"/chapters/{first['id']}", headers=headers, json={"number": 1})
    assert response.status_code == 200


@pytest.mark.parametrize("number", [None, 0, -1])
def test_invalid_number_rejected(client, headers, number):
    entry = create(client, headers, 1)
    response = client.put(f"/chapters/{entry['id']}", headers=headers, json={"number": number})
    assert response.status_code == 400
    assert client.get(f"/chapters/{entry['id']}", headers=headers).json()["number"] == 1


def test_renumbering_is_scoped_to_current_novel(client, headers, auth_headers):
    entry = create(client, headers, 1)
    other = client.post("/novels/", headers=auth_headers, json={"name": "Other"}).json()
    other_headers = {**auth_headers, "X-Novel-Id": str(other["id"])}
    create(client, other_headers, 2)
    response = client.put(f"/chapters/{entry['id']}", headers=headers, json={"number": 2})
    assert response.status_code == 200
    response = client.put(f"/chapters/{entry['id']}", headers=other_headers, json={"number": 3})
    assert response.status_code == 404
