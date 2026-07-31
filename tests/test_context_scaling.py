"""Devasa dünya senaryosu için eklenen iki koruma: 40+ kural varken
talimat metnine göre etiket filtreleme, ve 10+ progression notu varken
eskilerin sıkıştırılması. İkisi de eşik ALTINDA davranışı DEĞİŞTİRMEMELİ -
bu da ayrıca test ediliyor."""
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.qwen_client import build_fixed_layer, build_dynamic_layer
from app import schemas


def _db():
    Session = sessionmaker(bind=engine)
    return Session()


def test_small_rule_count_ignores_tags_entirely(client, headers, novel):
    """Eşik altında (buradaki test için az sayıda kural), etiket olsun ya
    da olmasın hepsi gitmeli - küçük romanlarda davranış değişmemeli."""
    for i in range(5):
        client.post("/rules/", json={"title": f"Kural {i}", "description": "x", "tags": ["nadir-etiket"]}, headers=headers)
    db = _db()
    # instruction_text'te etiket YOK ama eşik altı olduğu için hepsi gelmeli
    context = build_fixed_layer(db, novel["universe_id"], instruction_text="alakasız bir talimat")
    assert context.count("Kural ") == 5


def test_large_rule_count_filters_by_tag_in_instruction(client, headers, novel):
    for i in range(45):
        tags = ["buyu"] if i % 2 == 0 else ["kilic-dovusu"]
        client.post("/rules/", json={"title": f"Kural {i}", "description": "x", "tags": tags}, headers=headers)
    db = _db()
    context_all = build_fixed_layer(db, novel["universe_id"], instruction_text="")
    context_filtered = build_fixed_layer(db, novel["universe_id"], instruction_text="buyu hakkında bir sahne yaz")

    assert context_all.count("Kural ") == 45, "Talimat boşsa (eşleşme yoksa) güvenli tarafta kal - hepsini gönder"
    assert context_filtered.count("Kural ") < 45, "40+ kural + eşleşen etiket varsa filtrelenmeli"
    assert context_filtered.count("Kural ") > 0


def test_untagged_rules_always_included_even_above_threshold(client, headers, novel):
    for i in range(41):
        client.post("/rules/", json={"title": f"Evrensel Kural {i}", "description": "x"}, headers=headers)  # tags=[] (varsayılan)
    db = _db()
    context = build_fixed_layer(db, novel["universe_id"], instruction_text="tamamen alakasız bir şey")
    assert context.count("Evrensel Kural") == 41, "Etiketsiz kurallar eşik üstünde bile HER ZAMAN dahil edilmeli"


def test_progression_compaction_keeps_last_ten_verbatim(client, headers, novel):
    r = client.post("/characters/", json={"name": "Ahmet"}, headers=headers)
    char_id = r.json()["id"]
    for i in range(15):
        client.post("/progressions/", json={"entity_type": "character", "entity_id": char_id, "chapter_number": i + 1, "note": f"Not {i + 1}"}, headers=headers)

    db = _db()
    ref = schemas.EntityRef(entity_type="character", entity_id=char_id)
    context = build_dynamic_layer(db, novel["universe_id"], [ref])

    assert "ESKİ NOTLARIN ÖZETİ" in context
    for i in range(6, 16):  # son 10 not (6-15) tam metinle kalmalı
        assert f"Not {i}" in context


def test_progression_below_threshold_shows_all_verbatim_no_compaction(client, headers, novel):
    r = client.post("/characters/", json={"name": "Zeynep"}, headers=headers)
    char_id = r.json()["id"]
    for i in range(5):
        client.post("/progressions/", json={"entity_type": "character", "entity_id": char_id, "chapter_number": i + 1, "note": f"Not {i + 1}"}, headers=headers)

    db = _db()
    ref = schemas.EntityRef(entity_type="character", entity_id=char_id)
    context = build_dynamic_layer(db, novel["universe_id"], [ref])

    assert "ESKİ NOTLARIN ÖZETİ" not in context
    for i in range(1, 6):
        assert f"Not {i}" in context
