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


def test_shortcut_codes_resolve_entries(client, headers):
    """Kısayol kodları: '1BLM' (bölüm), '1-1KSM' (kısım). Fihrist haritası
    kodları listeler; mesajda geçen kod o girdinin ÖZET+METNİNİ context'e
    getirir."""
    from app.qwen_client import build_outline_layer, build_referenced_entries_layer, build_context
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app import models

    ch = client.post("/chapters/", json={"number": 1, "kind": "chapter", "title": "Küllerin Sesi"}, headers=headers).json()
    client.put(f"/chapters/{ch['id']}/paragraphs/1", json={"number": 1, "text": "Kule uzaktan görünüyordu."}, headers=headers)
    client.put(f"/chapters/{ch['id']}", json={"summary": "ZAMAN: 2030. OLAY: Açılış."}, headers=headers)
    part = client.post("/chapters/", json={"number": 2, "kind": "part", "title": "DİJİTAL DOĞUM"}, headers=headers).json()
    ch2 = client.post("/chapters/", json={"number": 3, "kind": "chapter", "title": "İkinci"}, headers=headers).json()
    client.put(f"/chapters/{ch2['id']}/paragraphs/1", json={"number": 1, "text": "İkinci bölümün metni."}, headers=headers)

    db = sessionmaker(bind=engine)()
    novel_id = int(headers["X-Novel-Id"])
    uid = db.query(models.Novel).filter(models.Novel.id == novel_id).first().universe_id

    outline = build_outline_layer(db, uid, novel_id)
    assert "KOD: 1BLM" in outline          # ilk bölüm
    assert "KOD: 2KSM" in outline          # kısım
    assert "BLM=Bölüm, KSM=Kısım" in outline

    ref = build_referenced_entries_layer(db, uid, novel_id, "1BLM'yi özetler misin?")
    assert "ATIF YAPILAN GİRDİLER" in ref
    assert "Kule uzaktan görünüyordu" in ref     # metni geldi
    assert "ZAMAN: 2030" in ref                  # özeti de geldi
    assert "İkinci bölümün metni" not in ref     # istenmeyen girdi gelmedi

    # Kod geçmiyorsa katman hiç oluşmaz (maliyet ödenmez)
    assert build_referenced_entries_layer(db, uid, novel_id, "genel bir soru") == ""
    # Kod EKRANDAKİ numaraya göre üretilir, sistem numarasına göre değil:
    # ikinci bölüm Kısım'ın altında olduğu için kodu "2-1BLM"dir.
    assert "KOD: 2-1BLM" in outline
    ctx = build_context(db, novel_id, uid, [], instruction_text="1BLM ile 2-1BLM'yi karşılaştır")
    assert "Kule uzaktan görünüyordu" in ctx and "İkinci bölümün metni" in ctx
    # Nokta ile de yazılabilmeli ("2.1BLM")
    ref2 = build_referenced_entries_layer(db, uid, novel_id, "2.1BLM nasıl?")
    assert "İkinci bölümün metni" in ref2


def test_wrong_shortcut_code_warns_instead_of_guessing(client, headers):
    """'1KSM' istenip 1 numaralı girdi BÖLÜM ise, sistem yanlış girdiyi
    getirmemeli; kodun olmadığını söyleyip yakın alternatifleri vermeli."""
    from app.qwen_client import build_referenced_entries_layer
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app import models

    ch = client.post("/chapters/", json={"number": 1, "kind": "chapter", "title": "BİRİNCİ BÖLÜM"}, headers=headers).json()
    client.put(f"/chapters/{ch['id']}/paragraphs/1", json={"number": 1, "text": "Bölümün metni burada."}, headers=headers)
    p1 = client.post("/chapters/", json={"number": 2, "kind": "part", "title": "DİJİTAL DOĞUM"}, headers=headers).json()
    c2 = client.post("/chapters/", json={"number": 3, "kind": "chapter", "title": "Alt bölüm"}, headers=headers).json()
    client.put(f"/chapters/{c2['id']}/paragraphs/1", json={"number": 1, "text": "Kısmın altındaki metin."}, headers=headers)

    db = sessionmaker(bind=engine)()
    novel_id = int(headers["X-Novel-Id"])
    uid = db.query(models.Novel).filter(models.Novel.id == novel_id).first().universe_id

    ref = build_referenced_entries_layer(db, uid, novel_id, "1KSM hakkında ne düşünüyorsun?")
    assert "'1KSM' diye bir girdi YOK" in ref
    assert "1BLM" in ref                      # yakın alternatif önerildi
    assert "Bölümün metni burada" not in ref  # YANLIŞ girdi getirilmedi

    # Doğru kod hâlâ çalışıyor
    ok = build_referenced_entries_layer(db, uid, novel_id, "1BLM nasıl?")
    assert "Bölümün metni burada" in ok and "YOK" not in ok
