"""Derin profil (sections) SEÇİCİ gönderim testleri.

Kullanıcı gereksinimi: "bir kişinin bir özelliği gerekli olduğu durumda
BÜTÜN bilgisi gönderilmesin". Bu dosya bunun uçtan uca kanıtı:
  - Talimat "görünüş" diyorsa SADECE fiziksel_yapi içeriği gider,
    geçmiş/ilişkiler gitmez (isim olarak listelenir).
  - Talimat alakasızsa HİÇBİR bölüm içeriği gitmez (eski davranış korunur).
  - 'meta' hiçbir koşulda gitmez - "sembolizm" kelimesi bile geçse.
  - Eski 7 başlıklı veriler (kariyer / zamansal_degisim) açılış göçüyle
    yeni başlıkların içine kayıpsız taşınır.
"""
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.qwen_client import build_dynamic_layer
from app import schemas


def _db():
    Session = sessionmaker(bind=engine)
    return Session()


def _make_character(client, headers, name="Aeron"):
    r = client.post("/characters/", json={
        "name": name,
        "description": "Kuzeyli bir komutan.",
        "sections": {
            "fiziksel_yapi": "Uzun boylu, sol yanağında yara izi, gri gözler.",
            "gecmis": "Buz Savaşı'nda ailesini kaybetti; eski bir paralı asker.",
            "iliskiler": "Kardeşi Maren'e karşı suçluluk duyar.",
            "meta": "Aeron, kaybedilmiş onurun sembolü - okuyucu ona acımalı.",
        },
    }, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def test_only_relevant_section_content_is_injected(client, headers, novel):
    char = _make_character(client, headers)
    db = _db()
    ref = schemas.EntityRef(entity_type="character", entity_id=char["id"])

    ctx = build_dynamic_layer(db, novel["universe_id"], [ref],
                              instruction_text="Aeron'un görünüşünü betimle")
    assert "yara izi" in ctx                      # fiziksel_yapi İÇERİĞİ girdi
    assert "Buz Savaşı" not in ctx                # gecmis içeriği GİRMEDİ
    assert "suçluluk" not in ctx                  # iliskiler içeriği GİRMEDİ
    # Girmeyenler isim olarak listelenmeli (sohbet modu tool'u için ipucu)
    assert "gecmis" in ctx and "iliskiler" in ctx
    # Enjekte edilen bölüm artık "mevcut bölümler" listesinde TEKRAR anılmaz
    assert ctx.count("fiziksel_yapi") == 1


def test_irrelevant_instruction_injects_nothing(client, headers, novel):
    char = _make_character(client, headers, name="Toren")
    db = _db()
    ref = schemas.EntityRef(entity_type="character", entity_id=char["id"])
    ctx = build_dynamic_layer(db, novel["universe_id"], [ref],
                              instruction_text="Bir savaş sahnesi yaz")
    assert "yara izi" not in ctx and "Buz Savaşı" not in ctx
    assert "get_entity_section ile çek" in ctx    # eski davranış korunuyor


def test_meta_never_leaks_even_with_keyword(client, headers, novel):
    char = _make_character(client, headers, name="Sira")
    db = _db()
    ref = schemas.EntityRef(entity_type="character", entity_id=char["id"])
    ctx = build_dynamic_layer(db, novel["universe_id"], [ref],
                              instruction_text="Sira'nın sembolizmini ve görünüşünü anlat")
    assert "kaybedilmiş onurun sembolü" not in ctx  # meta İÇERİĞİ asla
    assert "meta" not in ctx                        # adı bile listelenmez
    assert "yara izi" in ctx                        # ilgili bölüm yine çalışıyor


def test_multiple_relevant_sections(client, headers, novel):
    char = _make_character(client, headers, name="Veyra")
    db = _db()
    ref = schemas.EntityRef(entity_type="character", entity_id=char["id"])
    ctx = build_dynamic_layer(db, novel["universe_id"], [ref],
                              instruction_text="Veyra'nın geçmişini ve kardeşiyle ilişkisini işle")
    assert "Buz Savaşı" in ctx and "suçluluk" in ctx
    assert "yara izi" not in ctx


def test_context_preview_reflects_instruction(client, headers):
    """Frontend'in 'AI'ya gerçekte ne gidiyor' ekranı da talimatı hesaba
    katmalı - önizleme ile gerçek assist context'i birebir aynı olmalı."""
    char = _make_character(client, headers, name="Deren")
    ref = {"entity_type": "character", "entity_id": char["id"]}
    r = client.post("/ai/context-preview",
                    json={"selected_entities": [ref], "instruction": "Deren'in görünüşünü yaz"},
                    headers=headers)
    assert "yara izi" in r.json()["context"]
    r = client.post("/ai/context-preview",
                    json={"selected_entities": [ref]}, headers=headers)
    assert "yara izi" not in r.json()["context"]


def test_place_sections_selective(client, headers, novel):
    r = client.post("/places/", json={
        "name": "Kraliyet Sarayı",
        "sections": {
            "atmosfer": "Koridorlarda hep soğuk bir mum kokusu asılıdır.",
            "kurallar": "Tahta sırtını dönmek ölümle cezalandırılır.",
        },
    }, headers=headers)
    place = r.json()
    db = _db()
    ref = schemas.EntityRef(entity_type="place", entity_id=place["id"])
    ctx = build_dynamic_layer(db, novel["universe_id"], [ref],
                              instruction_text="sarayın kokusunu ve gece atmosferini yaz")
    assert "mum kokusu" in ctx
    assert "ölümle cezalandırılır" not in ctx


def test_legacy_keys_rejected_by_api(client, headers):
    """7 başlıklı eski yapıdan kalan anahtarlar API'den artık kabul edilmez
    - sessizce kaydedilip kaybolmak yerine net 422 alınır."""
    r = client.post("/characters/", json={
        "name": "Eski", "sections": {"kariyer": "asker"},
    }, headers=headers)
    assert r.status_code == 422
    r = client.post("/places/", json={
        "name": "Eski Mekan", "sections": {"zamansal_degisim": "kışın donar"},
    }, headers=headers)
    assert r.status_code == 422


def test_legacy_sections_migrated_losslessly(client, headers):
    """Açılış göçü: DB'de duran eski 'kariyer' içeriği 'gecmis'in sonuna
    etiketle eklenir, eski anahtar silinir - metin kaybolmaz."""
    from app import models
    from app.migrations import _merge_legacy_sections

    char = _make_character(client, headers, name="Miras")
    db = _db()
    record = db.query(models.Character).filter(models.Character.id == char["id"]).first()
    sections = dict(record.sections)
    sections["kariyer"] = "Kraliyet muhafızı olarak 10 yıl."  # eski veriyi simüle et
    record.sections = sections
    db.commit()
    db.close()

    _merge_legacy_sections(engine)

    db = _db()
    record = db.query(models.Character).filter(models.Character.id == char["id"]).first()
    assert "kariyer" not in record.sections
    assert "Kraliyet muhafızı olarak 10 yıl." in record.sections["gecmis"]
    assert "Buz Savaşı" in record.sections["gecmis"]  # eski gecmis içeriği de duruyor
    # İkinci çalıştırma hiçbir şeyi bozmamalı (idempotent)
    before = dict(record.sections)
    db.close()
    _merge_legacy_sections(engine)
    db = _db()
    record = db.query(models.Character).filter(models.Character.id == char["id"]).first()
    assert dict(record.sections) == before


# ---- Nesneler (kompakt 4+meta derin profil) --------------------------------

def _make_object(client, headers):
    r = client.post("/objects/", json={
        "name": "Kül Kılıcı",
        "sections": {
            "fiziksel_yapi": "Kabzasında çatlak bir yakut, ağzı isle kararmış.",
            "islev": "Kestiği yarayı yakar; her kullanım taşıyıcısını bir gün yaşlandırır.",
            "sahiplik": "Şu an Aeron'da, pelerinin altında taşıyor.",
            "meta": "Kılıç, intikamın bedelinin metaforu.",
        },
    }, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def test_object_sections_saved_and_returned(client, headers):
    obj = _make_object(client, headers)
    assert obj["sections"]["islev"].startswith("Kestiği")
    # merge davranışı nesnelerde de aynı: tek anahtar göndermek diğerlerini silmez
    r = client.put(f"/objects/{obj['id']}", json={"sections": {"gecmis": "Buz Savaşı'ndan önce dövüldü."}}, headers=headers)
    assert r.json()["sections"]["islev"].startswith("Kestiği")
    assert r.json()["sections"]["gecmis"].startswith("Buz Savaşı")


def test_object_selective_injection(client, headers, novel):
    obj = _make_object(client, headers)
    db = _db()
    ref = schemas.EntityRef(entity_type="object", entity_id=obj["id"])
    ctx = build_dynamic_layer(db, novel["universe_id"], [ref],
                              instruction_text="Kül Kılıcı'nın gücünü ve bedelini anlat")
    assert "yaşlandırır" in ctx                    # islev içeriği girdi
    assert "pelerinin altında" not in ctx          # sahiplik girmedi
    assert "intikamın bedelinin metaforu" not in ctx  # meta asla
    assert "sahiplik" in ctx                       # ama isim olarak listelendi


def test_object_unknown_section_rejected(client, headers):
    r = client.post("/objects/", json={"name": "Hatalı", "sections": {"atmosfer": "x"}}, headers=headers)
    assert r.status_code == 422  # atmosfer mekan başlığı, nesnede yok


def test_other_simple_menus_unaffected(client, headers):
    """Terimler SimpleEntity şemasında kaldı - sections göndermek onlarda
    kabul edilmemeli (sessizce yutulmamalı ya da patlamamalı, alan yok
    sayılır) ve çıktıda sections alanı olmamalı."""
    r = client.post("/glossary/", json={"name": "Buzçelik", "description": "Kuzey alaşımı"}, headers=headers)
    assert r.status_code == 201
    assert "sections" not in r.json()


# ---- 🔒 Gizli Katman -------------------------------------------------------

def test_hidden_layer_never_leaks_by_default(client, headers, novel):
    """Varsayılan akışta gizli katman AI'ya HİÇBİR yoldan gitmez: içerik
    olarak girmez, isim listesinde anılmaz, anahtar kelimeyle seçilemez."""
    char = client.post("/characters/", json={
        "name": "Baş Tabip",
        "sections": {
            "fiziksel_yapi": "Hep ütülü önlük.",
            "gizli": "Lümen'in suçlarını biliyor ama yüklü para aldığı için susuyor.",
        },
    }, headers=headers).json()
    db = _db()
    ref = schemas.EntityRef(entity_type="character", entity_id=char["id"])
    # Alakalı talimat + "sır" kelimesi bile geçse gizli seçilemez
    ctx = build_dynamic_layer(db, novel["universe_id"], [ref],
                              instruction_text="Baş Tabip'in sırrını ve görünüşünü anlat")
    assert "Lümen'in suçlarını" not in ctx
    assert "gizli" not in ctx                       # adı bile listelenmez
    assert "ütülü önlük" in ctx                     # normal profil çalışıyor
    # Önizleme ucu da varsayılanda sızdırmaz
    r = client.post("/ai/context-preview", json={
        "selected_entities": [{"entity_type": "character", "entity_id": char["id"]}],
    }, headers=headers)
    assert "Lümen'in suçlarını" not in r.json()["context"]


def test_hidden_layer_injected_with_directive_when_enabled(client, headers, novel):
    char = client.post("/characters/", json={
        "name": "Tabip2",
        "sections": {"gizli": "Gizli yapılanmanın üyesi."},
    }, headers=headers).json()
    db = _db()
    ref = schemas.EntityRef(entity_type="character", entity_id=char["id"])
    ctx = build_dynamic_layer(db, novel["universe_id"], [ref], include_hidden=True)
    assert "Gizli yapılanmanın üyesi." in ctx
    assert "ASLA açıkça yazma" in ctx               # sızdırmama direktifi bitişik
    # Uçtan uca: önizlemede bayrakla görünür
    r = client.post("/ai/context-preview", json={
        "selected_entities": [{"entity_type": "character", "entity_id": char["id"]}],
        "include_hidden": True,
    }, headers=headers)
    assert "Gizli yapılanmanın üyesi." in r.json()["context"]


def test_hidden_key_valid_for_all_three_types(client, headers):
    for endpoint, name in (("/characters/", "GK1"), ("/places/", "GM1"), ("/objects/", "GN1")):
        r = client.post(endpoint, json={"name": name, "sections": {"gizli": "sır"}}, headers=headers)
        assert r.status_code == 201, f"{endpoint}: {r.text}"
        assert r.json()["sections"]["gizli"] == "sır"
