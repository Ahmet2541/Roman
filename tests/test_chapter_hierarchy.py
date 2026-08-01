"""resolve_chapters_for_part - Kısım seviyesinde toplu tarama hangi
bölümleri kapsıyor sorusunun backend karşılığı. Alt Başlıkların şeffaf
olması (aradan geçse de bölümler hâlâ üstteki Kısım'a ait sayılması)
kritik bir davranış."""
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.routers.chapters import resolve_chapters_for_part


def _db():
    Session = sessionmaker(bind=engine)
    return Session()


def test_resolve_chapters_for_part_includes_only_chapters_in_that_part(client, headers, novel):
    novel_id = novel["id"]
    r = client.post("/chapters/", json={"number": 1, "title": "BİRİNCİ KISIM", "kind": "part"}, headers=headers)
    part1 = r.json()
    client.post("/chapters/", json={"number": 2, "title": "B1", "kind": "chapter"}, headers=headers)
    client.post("/chapters/", json={"number": 3, "title": "B2", "kind": "chapter"}, headers=headers)
    r = client.post("/chapters/", json={"number": 4, "title": "İKİNCİ KISIM", "kind": "part"}, headers=headers)
    client.post("/chapters/", json={"number": 5, "title": "B3", "kind": "chapter"}, headers=headers)

    db = _db()
    chapters = resolve_chapters_for_part(db, novel_id, part1["id"])
    numbers = sorted(c.number for c in chapters)
    assert numbers == [2, 3], "Sadece BİRİNCİ KISIM'daki bölümler dönmeli, İKİNCİ KISIM'daki (5) değil"


def test_resolve_chapters_for_part_sees_through_subtitles(client, headers, novel):
    novel_id = novel["id"]
    r = client.post("/chapters/", json={"number": 1, "title": "KISIM", "kind": "part"}, headers=headers)
    part = r.json()
    client.post("/chapters/", json={"number": 2, "title": "Alt Başlık", "kind": "subtitle"}, headers=headers)
    client.post("/chapters/", json={"number": 3, "title": "Bölüm Alt Başlık Altında", "kind": "chapter"}, headers=headers)

    db = _db()
    chapters = resolve_chapters_for_part(db, novel_id, part["id"])
    numbers = sorted(c.number for c in chapters)
    assert numbers == [3], "Alt Başlık'ın altındaki bölüm de bu Kısım'a ait sayılmalı"


def test_resolve_chapters_for_part_with_no_chapters_returns_empty(client, headers, novel):
    novel_id = novel["id"]
    r = client.post("/chapters/", json={"number": 1, "title": "Boş Kısım", "kind": "part"}, headers=headers)
    part = r.json()
    db = _db()
    assert resolve_chapters_for_part(db, novel_id, part["id"]) == []


def test_container_chapter_owns_following_subtitles(client, headers):
    """Bir BÖLÜM'ün hemen ardından Alt Başlık geliyorsa, o bölüm kapsayıcı
    sayılmalı: alt başlıklar ve onların bölümleri ona bağlanır. Kullanıcı
    yapısını Kısım'a çevirmeye zorlanmaz (Word taslak davranışı).

    Not: hiyerarşi hesabı frontend'de (buildChapterHierarchy) yapılıyor;
    bu test veri tarafının bu düzeni desteklediğini (aynı romanda karışık
    türlerin yan yana durabildiğini) garantiler.
    """
    entries = [
        (1, "chapter", "BİRİNCİ BÖLÜM"),      # kapsayıcı bölüm
        (2, "subtitle", "Tur 1: Başkan"),
        (3, "chapter", "Hologram"),
        (4, "chapter", "Sorgu"),
        (5, "subtitle", "Tur 2: Jeolog"),
        (6, "chapter", "Hologram 2"),
    ]
    for number, kind, title in entries:
        r = client.post("/chapters/", json={"number": number, "kind": kind, "title": title}, headers=headers)
        assert r.status_code == 201, r.text
    listed = client.get("/chapters/", headers=headers).json()
    assert [(c["number"], c["kind"]) for c in listed] == [(n, k) for n, k, _ in entries]
    # Tür değiştirme de çalışmalı (✎ ile Kısım'a çevirme)
    first = listed[0]
    r = client.put(f"/chapters/{first['id']}", json={"kind": "part"}, headers=headers)
    assert r.status_code == 200 and r.json()["kind"] == "part"
