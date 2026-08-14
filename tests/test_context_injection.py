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
    assert "BİRİNCİ KISIM" in outline and "seviye 1" in outline
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


def test_entry_numbers_resolve_entries(client, headers):
    """Atıf artık EKRANDAKİ NUMARAYLA yapılır ("1", "1-1", "1.1").
    Kullanıcının başlık adları ("BİRİNCİ BÖLÜM" bir üst başlık olabilir)
    hiyerarşiyi belirlemez - numara belirler."""
    from app.qwen_client import build_outline_layer, build_referenced_entries_layer, build_context
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app import models

    ch = client.post("/chapters/", json={"number": 1, "kind": "chapter", "title": "Küllerin Sesi"}, headers=headers).json()
    client.put(f"/chapters/{ch['id']}/paragraphs/1", json={"number": 1, "text": "Kule uzaktan görünüyordu."}, headers=headers)
    client.put(f"/chapters/{ch['id']}", json={"summary": "ZAMAN: 2030. OLAY: Açılış."}, headers=headers)
    client.post("/chapters/", json={"number": 2, "kind": "part", "title": "DİJİTAL DOĞUM"}, headers=headers)
    ch2 = client.post("/chapters/", json={"number": 3, "kind": "chapter", "title": "İkinci"}, headers=headers).json()
    client.put(f"/chapters/{ch2['id']}/paragraphs/1", json={"number": 1, "text": "İkinci bölümün metni."}, headers=headers)

    db = sessionmaker(bind=engine)()
    novel_id = int(headers["X-Novel-Id"])
    uid = db.query(models.Novel).filter(models.Novel.id == novel_id).first().universe_id

    outline = build_outline_layer(db, uid, novel_id)
    assert "FİHRİST HARİTASI" in outline
    assert "NUMARADAN ve seviyeden çöz" in outline   # AI'ya yönerge
    assert outline.count("sistem no:") >= 3

    ref = build_referenced_entries_layer(db, uid, novel_id, "1 numaralı bölümü özetler misin?")
    assert "Kule uzaktan görünüyordu" in ref and "ZAMAN: 2030" in ref
    assert "İkinci bölümün metni" not in ref

    # Nokta ve tire iki biçim de çalışır
    for atif in ("2-1 nasıl?", "2.1 nasıl?"):
        r = build_referenced_entries_layer(db, uid, novel_id, atif)
        assert "İkinci bölümün metni" in r, atif

    # Numara geçmiyorsa katman hiç oluşmaz
    assert build_referenced_entries_layer(db, uid, novel_id, "genel bir soru") == ""
    ctx = build_context(db, novel_id, uid, [], instruction_text="bölüm 1 ile 2-1'i karşılaştır")
    assert "Kule uzaktan görünüyordu" in ctx and "İkinci bölümün metni" in ctx


def test_missing_number_suggests_children(client, headers):
    """Olmayan numarada uydurma yok: alt girdiler varsa onları önerir."""
    from app.qwen_client import build_referenced_entries_layer
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app import models

    client.post("/chapters/", json={"number": 1, "kind": "part", "title": "BİRİNCİ BÖLÜM"}, headers=headers)
    c = client.post("/chapters/", json={"number": 2, "kind": "chapter", "title": "Alt"}, headers=headers).json()
    client.put(f"/chapters/{c['id']}/paragraphs/1", json={"number": 1, "text": "Alt girdinin metni."}, headers=headers)

    db = sessionmaker(bind=engine)()
    novel_id = int(headers["X-Novel-Id"])
    uid = db.query(models.Novel).filter(models.Novel.id == novel_id).first().universe_id

    ref = build_referenced_entries_layer(db, uid, novel_id, "5-9 hakkında ne düşünüyorsun?")
    assert "'5-9' numaralı bir girdi YOK" in ref
    assert "Uydurma" in ref


def test_paragraph_reference_code(client, headers):
    """'1-2P3' = 1-2 numaralı girdinin 3. paragrafı. Hedef paragraf
    komşularıyla birlikte gelir; olmayan paragrafta uydurma yapılmaz."""
    from app.qwen_client import build_referenced_entries_layer
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app import models

    client.post("/chapters/", json={"number": 1, "kind": "part", "title": "ÜST BAŞLIK"}, headers=headers)
    ch = client.post("/chapters/", json={"number": 2, "kind": "chapter", "title": "Sahne"}, headers=headers).json()
    for i, t in enumerate(["Birinci cümle.", "İkinci cümle.", "Üçüncü cümle.", "Dördüncü cümle."], start=1):
        client.put(f"/chapters/{ch['id']}/paragraphs/{i}", json={"number": i, "text": t}, headers=headers)

    db = sessionmaker(bind=engine)()
    novel_id = int(headers["X-Novel-Id"])
    uid = db.query(models.Novel).filter(models.Novel.id == novel_id).first().universe_id

    ref = build_referenced_entries_layer(db, uid, novel_id, "1-1P3'ü daha gergin yazar mısın?")
    assert "1-1P3" in ref and "← ATIF YAPILAN" in ref
    assert "Üçüncü cümle." in ref
    assert "İkinci cümle." in ref and "Dördüncü cümle." in ref   # komşular bağlam için
    # Nokta biçimi ve boşluklu yazım da çalışır
    assert "Üçüncü cümle." in build_referenced_entries_layer(db, uid, novel_id, "1.1 P 3 nasıl?")

    # Olmayan paragraf: uyarı, uydurma yok
    yok = build_referenced_entries_layer(db, uid, novel_id, "1-1P99 hakkında ne dersin?")
    assert "99. paragraf yok" in yok and "4 paragraf var" in yok


def test_forward_layer_shows_next_chapter(client, headers):
    """İLERİ BAKIŞ: sonraki bölümün özeti/planı bağlama girer - "bu sahne
    oraya nasıl bağlanıyor" sorusu ancak böyle sorulabilir. Özet zinciri
    hep geriye bakıyordu."""
    from app.qwen_client import build_forward_layer
    from sqlalchemy.orm import sessionmaker
    from app.database import engine

    ch1 = client.post("/chapters/", json={"number": 1, "kind": "chapter", "title": "Şimdi"}, headers=headers).json()
    ch2 = client.post("/chapters/", json={"number": 2, "kind": "chapter", "title": "Sonra"}, headers=headers).json()
    client.put(f"/chapters/{ch2['id']}", json={"summary": "OLAY: Başkan çöker."}, headers=headers)

    db = sessionmaker(bind=engine)()
    novel_id = int(headers["X-Novel-Id"])
    ileri = build_forward_layer(db, novel_id, 1)
    assert "İLERİ BAKIŞ" in ileri
    assert "Başkan çöker" in ileri
    assert "ÖNDEN VERME" in ileri          # sızdırma uyarısı
    # Son bölümde ileri bakış YOK (boşuna maliyet ödenmez)
    assert build_forward_layer(db, novel_id, 2) == ""


def test_knowledge_layer_prevents_leaks(client, headers):
    """BİLGİ DURUMU katmanı: okur ne biliyor, ne SIZDIRILMAMALI. Bilgi
    Haritası menüde duruyordu ama hiçbir prompta girmiyordu - yani sızdırma
    koruması hiç çalışmıyordu."""
    from app.qwen_client import build_knowledge_layer
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    from app import models

    baskan = client.post("/characters/", json={"name": "Başkan"}, headers=headers).json()
    # Bölüm 12'de ifşa olacak bir sır - Bölüm 3 yazılırken sızmamalı
    client.post("/knowledge/", json={
        "information": "Başkan imzayı attı", "reveal_chapter": 12,
        "known_by_characters": [baskan["id"]], "reader_state": "hayir",
    }, headers=headers)
    # Dramatik ironi: okur bilir, kimse bilmez
    client.post("/knowledge/", json={
        "information": "Vicdan yedinci timi göremiyor", "reader_state": "evet",
        "known_by_characters": [],
    }, headers=headers)

    db = sessionmaker(bind=engine)()
    novel_id = int(headers["X-Novel-Id"])
    uid = db.query(models.Novel).filter(models.Novel.id == novel_id).first().universe_id

    katman = build_knowledge_layer(db, uid, 3)
    assert "SIZDIRMA YASAĞI" in katman
    assert "Başkan imzayı attı" in katman and "Bölüm 12" in katman
    assert "DRAMATİK İRONİ" in katman
    assert "yedinci timi" in katman

    # Kayıt yoksa katman hiç oluşmaz (boşuna maliyet yok)
    bos_uid = 999999
    assert build_knowledge_layer(db, bos_uid, 3) == ""


def test_verify_knows_proposal_goal(client, headers):
    """Doğrulama artık "metin değişti mi" değil "önerinin HEDEFİ gerçekleşti
    mi" diye soruyor - amaç prompta giriyor."""
    from unittest.mock import patch
    from tests.test_reviewer_tools import _fake_qwen

    captured = {}
    def fake_create(**kwargs):
        captured["user"] = kwargs["messages"][1]["content"]
        captured["system"] = kwargs["messages"][0]["content"]
        return _fake_qwen({"verdict": "kabul", "issues": [], "note": "Hedef tuttu."})
    with patch("app.qwen_client.get_client") as mc:
        mc.return_value.chat.completions.create.side_effect = fake_create
        client.post("/ai/verify-rewrite", json={
            "old_text": "Sıradan bir mahalle.", "new_text": "Tozlar güneşte asılı kaldı.",
            "proposal_goal": "Yargı sıfatlarını gözlemlenebilir detayla değiştir",
            "expected_effect": "Alt metin güçlensin",
        }, headers=headers)
    assert "ÖNERİNİN AMACI" in captured["user"]
    assert "Yargı sıfatlarını" in captured["user"]
    assert "BEKLENEN ETKİ" in captured["user"]
    assert "HEDEFİ gerçekleşti mi" in captured["system"]
    assert "KANON" in captured["system"]          # kanon dışı ekleme kontrolü


def test_rewrite_context_has_own_summary_and_entity_profile(client, headers):
    """PARAGRAF YENİDEN YAZIM BAĞLAMI - iki kritik boşluk kapatıldı:
    (1) bölümün KENDİ özeti (ZAMAN/ATMOSFER/DUYGU) gelmiyordu; fihrist
    katmanı onu bilerek dışlıyor (yeni bölüm yazarken doğru, düzenlerken
    yanlış). (2) paragrafta geçen karakterlerin profili gelmiyordu -
    Vicdan'ın konuşma tarzını bilmeden onun sahnesi yeniden yazılıyordu."""
    v = client.post("/characters/", json={
        "name": "Vicdan", "description": "Yargıç değil arşiv.",
        "sections": {"konusma_tarzi": "Sakin, kısa cümleler. Bağırmaz."},
    }, headers=headers).json()
    ch = client.post("/chapters/", json={"number": 1, "kind": "chapter", "title": "Salon"}, headers=headers).json()
    client.put(f"/chapters/{ch['id']}/paragraphs/1", json={"number": 1, "text": "Vicdan konuştu."}, headers=headers)
    client.put(f"/chapters/{ch['id']}", json={
        "summary": "ZAMAN: 2030. ATMOSFER: Zifiri karanlık. KAPANIŞ TONU: tedirginlik.",
    }, headers=headers)

    ctx = client.post("/ai/context-preview", json={
        "selected_entities": [{"entity_type": "character", "entity_id": v["id"]}],
        "chapter_number": 1,
        "instruction": "P1'i yeniden yaz. Diyalog: alt metin yok bulgusunu gider.",
        "include_own_summary": True,
    }, headers=headers).json()["context"]

    assert "ÜZERİNDE ÇALIŞILAN BÖLÜMÜN ÖZETİ" in ctx
    assert "ATMOSFER: Zifiri karanlık" in ctx      # ton bilgisi geldi
    assert "Bağırmaz" in ctx                        # konuşma tarzı (diyalog anahtarı)
    assert "Yargıç değil arşiv" in ctx              # kısa tanım

    # Bayrak KAPALIYKEN kendi özeti GELMEZ - yeni bölüm yazarken model
    # kendi özetini kopyalamasın diye bu davranış korunmalı
    ctx2 = client.post("/ai/context-preview", json={
        "selected_entities": [], "chapter_number": 1, "instruction": "yaz",
    }, headers=headers).json()["context"]
    assert "ÜZERİNDE ÇALIŞILAN BÖLÜMÜN ÖZETİ" not in ctx2


def test_tool_names_never_leak_to_user():
    """Araç adları kullanıcıya SIZMAMALI: "set_draft_result ile
    kaydedebilirim" gibi cümleler iç mekanizmadır, ekranda anlamsızdır ve
    kullanıcıya gereksiz bir onay turu ekletir."""
    from app.qwen_client import strip_tool_leaks, CHAT_SYSTEM_PROMPT

    metin = ("Bu versiyon tematik bütünlüğü koruyor.\n\n"
             "İstersen bu versiyonu doğrudan set_draft_result ile taslak olarak "
             "kaydedebilirim — senin onayını bekliyorum.")
    temiz = strip_tool_leaks(metin)
    assert "set_draft_result" not in temiz
    assert "tematik bütünlüğü koruyor" in temiz      # asıl içerik korunur

    assert strip_tool_leaks("write_paragraph ile ekleyeyim mi?") .strip() == ""
    assert strip_tool_leaks("") == ""
    assert strip_tool_leaks("Normal cevap.") == "Normal cevap."

    # Prompt seviyesinde de yasak
    assert "ARAÇ ADLARINI KULLANICIYA ASLA SÖYLEME" in CHAT_SYSTEM_PROMPT
    assert "İZİN İSTEME, ÜRET" in CHAT_SYSTEM_PROMPT
