"""Kısım/Alt Başlık ESKİDEN sadece bir ayraç sayılıyordu ve backend yeni
paragraf eklemeyi 400 ile reddediyordu. Scrivener/Ulysses gibi yazım
araçlarının hiçbirinde "kap türüne göre içerik yasağı" yok - bir klasör/grup
kendisi de metin tutabilir, aynı zamanda alt girdileri de olabilir. Bu
yüzden kısıt TAMAMEN kaldırıldı: Kısım/Alt Başlık'a da doğrudan paragraf
yazılabilir. Bu testler artık bunun ÇALIŞTIĞINI doğruluyor (eskiden
reddedildiğini değil)."""


def test_part_paragraph_count_is_zero_by_default(client, headers):
    r = client.post("/chapters/", json={"number": 1, "title": "BİRİNCİ KISIM", "kind": "part"}, headers=headers)
    part_id = r.json()["id"]

    r = client.get("/chapters/", headers=headers)
    part_row = next(c for c in r.json() if c["id"] == part_id)
    assert part_row["paragraph_count"] == 0


def test_new_paragraph_on_part_is_allowed(client, headers):
    r = client.post("/chapters/", json={"number": 1, "title": "BİRİNCİ KISIM", "kind": "part"}, headers=headers)
    part_id = r.json()["id"]

    r = client.put(f"/chapters/{part_id}/paragraphs/1", json={"number": 1, "text": "artık serbest"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["text"] == "artık serbest"

    r = client.get("/chapters/", headers=headers)
    part_row = next(c for c in r.json() if c["id"] == part_id)
    assert part_row["paragraph_count"] == 1


def test_new_paragraph_on_subtitle_is_allowed(client, headers):
    r = client.post("/chapters/", json={"number": 1, "title": "Uyanış", "kind": "subtitle"}, headers=headers)
    sub_id = r.json()["id"]

    r = client.put(f"/chapters/{sub_id}/paragraphs/1", json={"number": 1, "text": "artık serbest"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["text"] == "artık serbest"


def test_new_paragraph_on_real_chapter_still_works(client, headers):
    r = client.post("/chapters/", json={"number": 1, "kind": "chapter"}, headers=headers)
    chapter_id = r.json()["id"]

    r = client.put(f"/chapters/{chapter_id}/paragraphs/1", json={"number": 1, "text": "normal paragraf"}, headers=headers)
    assert r.status_code == 200


def test_existing_orphan_paragraph_can_still_be_edited_for_recovery(client, headers):
    """Backend'in kendisi hiçbir zaman orphan paragraf oluşturamaz (bkz.
    yukarısı) ama ESKİ verilerde (bu kısıt eklenmeden önce oluşmuş) hâlâ
    olabilir - kurtarma imkanı olsun diye VAR OLAN bir paragrafı düzenlemek
    her zaman serbest kalmalı, sadece YENİ oluşturma engellenir."""
    r = client.post("/chapters/", json={"number": 1, "title": "BİRİNCİ KISIM", "kind": "part"}, headers=headers)
    part_id = r.json()["id"]

    # Doğrudan modele erişip (backend kısıtını bypass ederek) eski/orphan
    # veriyi simüle ediyoruz - gerçek dünyada bu, bu kısıttan ÖNCE oluşmuş
    # bir kayıt olurdu.
    from app import models
    from app.database import SessionLocal
    db = SessionLocal()
    db.add(models.Paragraph(chapter_id=part_id, number=1, text="eski içerik"))
    db.commit()
    db.close()

    r = client.get("/chapters/", headers=headers)
    part_row = next(c for c in r.json() if c["id"] == part_id)
    assert part_row["paragraph_count"] == 1

    r = client.get(f"/chapters/{part_id}", headers=headers)
    assert r.json()["paragraphs"][0]["text"] == "eski içerik"

    # VAR OLAN paragrafı düzenlemek hâlâ çalışmalı (kurtarma/taşıma imkanı)
    r = client.put(f"/chapters/{part_id}/paragraphs/1", json={"number": 1, "text": "düzeltildi"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["text"] == "düzeltildi"
