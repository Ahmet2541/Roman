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


# ---- Bağlam kapsamı, geçmiş budama, boyut ölçümü --------------------------

def test_text_scope_none_chapter_novel(client, headers):
    """Kapsam seçimi: none (metin yok) / chapter (açık bölüm) / novel (tümü)."""
    from app.qwen_client import build_context
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app import models

    for n, txt in ((1, "Birinci bölümün metni."), (2, "İkinci bölümün metni.")):
        ch = client.post("/chapters/", json={"number": n, "kind": "chapter", "title": f"B{n}"}, headers=headers).json()
        client.put(f"/chapters/{ch['id']}/paragraphs/1", json={"number": 1, "text": txt}, headers=headers)

    db = sessionmaker(bind=engine)()
    novel_id = int(headers["X-Novel-Id"])
    uid = db.query(models.Novel).filter(models.Novel.id == novel_id).first().universe_id

    ctx_none = build_context(db, novel_id, uid, [], chapter_number=1, include_chapter_text=True, text_scope="none")
    assert "Birinci bölümün metni" not in ctx_none

    ctx_chapter = build_context(db, novel_id, uid, [], chapter_number=1, include_chapter_text=True, text_scope="chapter")
    assert "Birinci bölümün metni" in ctx_chapter
    assert "İkinci bölümün metni" not in ctx_chapter   # sadece açık bölüm

    ctx_novel = build_context(db, novel_id, uid, [], chapter_number=1, include_chapter_text=True, text_scope="novel")
    assert "Birinci bölümün metni" in ctx_novel and "İkinci bölümün metni" in ctx_novel
    assert "KİTABIN TAM METNİ" in ctx_novel


def test_chat_history_trimming():
    """Uzun sohbette son turlar tam kalır, öncesi tek özete sıkışır."""
    from app.qwen_client import trim_chat_history
    kısa = [{"role": "user", "content": f"m{i}"} for i in range(5)]
    assert trim_chat_history(kısa) == kısa          # kısa sohbete dokunulmaz

    uzun = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"mesaj{i}"} for i in range(30)]
    trimmed = trim_chat_history(uzun, keep_recent=8)
    assert len(trimmed) == 9                        # 1 özet + 8 güncel
    assert "ÖNCEKİ KONUŞMANIN ÖZETİ" in trimmed[0]["content"]
    assert "22 mesaj sıkıştırıldı" in trimmed[0]["content"]
    assert trimmed[1:] == uzun[-8:]                 # son 8 mesaj AYNEN korunur
    assert "mesaj3" in trimmed[0]["content"]        # eski içerik özette yaşıyor


def test_context_size_breakdown(client, headers):
    """Önizleme, katman bazında boyut dökümü vermeli (şeffaflık)."""
    client.post("/rules/", json={"title": "Şişe mekaniği", "description": "Yalan karartır."}, headers=headers)
    ch = client.post("/chapters/", json={"number": 1, "kind": "chapter", "title": "B1"}, headers=headers).json()
    client.put(f"/chapters/{ch['id']}/paragraphs/1", json={"number": 1, "text": "Uzun bir metin. " * 50}, headers=headers)

    r = client.post("/ai/context-preview", json={
        "selected_entities": [], "chapter_number": 1,
        "include_chapter_text": True, "text_scope": "chapter",
    }, headers=headers)
    data = r.json()
    assert data["char_count"] > 0 and data["approx_tokens"] > 0
    assert data["breakdown"], "katman dökümü boş olmamalı"
    assert sum(b["char_count"] for b in data["breakdown"]) <= data["char_count"] + 50
    # En büyük katman başta olmalı
    sizes = [b["char_count"] for b in data["breakdown"]]
    assert sizes == sorted(sizes, reverse=True)


def test_scans_include_text_in_heading_entries(client, headers):
    """KRİTİK: metin Kısım/Alt Başlık girdilerinde de durabilir (içe
    aktarılan romanlarda olağan). Taramalar TÜR'e değil İÇERİĞE bakmalı -
    aksi halde romanın büyük kısmı hiç taranmıyordu."""
    from app.qwen_client import build_index_layer, build_whole_novel_layer
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app import models

    # Gerçek senaryo: bölüm olarak yazılmış metin sonradan başlığa çevrilir
    # (içe aktarma ya da kullanıcının yapıyı yeniden düzenlemesi). Backend
    # başlığa YENİ paragraf eklemeyi engeller ama mevcut metin orada kalır.
    part = client.post("/chapters/", json={"number": 1, "kind": "chapter", "title": "BİRİNCİ BÖLÜM"}, headers=headers).json()
    client.put(f"/chapters/{part['id']}/paragraphs/1", json={"number": 1, "text": "Kısımda duran gerçek metin."}, headers=headers)
    client.put(f"/chapters/{part['id']}", json={"summary": "ZAMAN: 2030. OLAY: Açılış.", "kind": "part"}, headers=headers)

    db = sessionmaker(bind=engine)()
    novel_id = int(headers["X-Novel-Id"])
    uid = db.query(models.Novel).filter(models.Novel.id == novel_id).first().universe_id

    # Fihrist katmanı: özeti olan başlık girdisi de görünmeli
    idx = build_index_layer(db, uid, novel_id)
    assert "ZAMAN: 2030" in idx

    # Tüm kitap katmanı: başlıktaki metin de kitabın parçası
    whole = build_whole_novel_layer(db, novel_id)
    assert "Kısımda duran gerçek metin." in whole
