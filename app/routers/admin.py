"""Yedekleme / dışa aktarma ve içe aktarma (geri yükleme) uçları.

Railway gibi platformlarda sunucuya terminalle kolay erişemediğin için,
aktif kitabı tek tıkla JSON olarak indirip bilgisayarında saklayabilmen
için bu endpoint eklendi. İçerik EncryptedString alanlarından ORM üzerinden
okunduğu için JSON'da düz (okunabilir) metin olarak çıkar - yani export
dosyasını nereye koyarsan koy, DB_ENCRYPTION_KEY'e ihtiyaç duymadan
okuyabilirsin. Bu yüzden export dosyasını da güvenli bir yerde tut.

ÖNEMLİ (evren/kitap ayrımı): Karakterler/mekanlar/kurallar/ilişkiler/
gelişim çizelgesi/olaylar/faksiyonlar artık EVREN düzeyinde paylaşılıyor
(bkz. models.py). Export bu yüzden İKİ farklı kapsamı birleştirir:
  - Aktif KİTABIN (X-Novel-Id) bölüm/paragrafları
  - Aktif kitabın ait olduğu EVRENİN TÜM paylaşılan verisi (o evrendeki
    BAŞKA kitaplarda geçen karakterler dahil - çünkü bu kitabı doğru
    anlamak/geri yüklemek için o bağlam gerekli)
Import'ta da aynı ayrım geçerli: mode='wipe' SADECE bu kitabın bölüm/
paragraflarını siler - evren verisine (karakterler vb.) DOKUNMAZ, çünkü
onlar başka kitaplar tarafından da kullanılıyor olabilir. Paylaşılan
varlıklar import'ta HER ZAMAN 'merge' (yeni kayıt olarak eklenir)
davranışıyla geri yüklenir."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
import json

from ..database import get_db
from ..auth import get_current_user
from .. import models
from ..mentions import detect_and_save_mentions
from ..novel_context import get_novel_id, get_universe_id

router = APIRouter(prefix="/admin", tags=["Yönetim"])

_SIMPLE_FIELDS = ["id", "name", "description", "notes", "created_at", "updated_at"]


def _serialize(item, fields):
    out = {}
    for f in fields:
        v = getattr(item, f, None)
        out[f] = v.isoformat() if isinstance(v, datetime) else v
    return out


@router.get("/export")
def export_all(
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id), universe_id: int = Depends(get_universe_id),
):
    """Aktif kitabın bölüm/paragrafları + ait olduğu evrenin TÜM paylaşılan
    verisi (karakterler, mekanlar, olaylar vb.) tek bir JSON dosyası olarak
    indirilir."""
    novel = db.query(models.Novel).filter(models.Novel.id == novel_id).first()
    universe = db.query(models.Universe).filter(models.Universe.id == universe_id).first()

    data = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "format_version": 3,
        "novel_name": novel.name if novel else "",
        "universe_name": universe.name if universe else "",
        "characters": [_serialize(c, _SIMPLE_FIELDS + ["status", "aliases"]) for c in db.query(models.Character).filter(models.Character.universe_id == universe_id).all()],
        "places": [_serialize(p, _SIMPLE_FIELDS + ["aliases"]) for p in db.query(models.Place).filter(models.Place.universe_id == universe_id).all()],
        "objects": [_serialize(o, _SIMPLE_FIELDS) for o in db.query(models.Object).filter(models.Object.universe_id == universe_id).all()],
        "foreshadowings": [_serialize(f, _SIMPLE_FIELDS + ["status"]) for f in db.query(models.Foreshadowing).filter(models.Foreshadowing.universe_id == universe_id).all()],
        "glossary_terms": [_serialize(g, _SIMPLE_FIELDS) for g in db.query(models.GlossaryTerm).filter(models.GlossaryTerm.universe_id == universe_id).all()],
        "rules": [_serialize(r, ["id", "title", "description", "tags", "created_at", "updated_at"]) for r in db.query(models.Rule).filter(models.Rule.universe_id == universe_id).all()],
        "factions": [_serialize(f, _SIMPLE_FIELDS) for f in db.query(models.Faction).filter(models.Faction.universe_id == universe_id).all()],
        "events": [
            _serialize(e, ["id", "name", "description", "notes", "place_id", "story_date", "story_order", "character_ids", "created_at", "updated_at"])
            for e in db.query(models.Event).filter(models.Event.universe_id == universe_id).all()
        ],
        "relationships": [
            _serialize(r, ["id", "character_a_id", "character_b_id", "label", "notes", "created_at"])
            for r in db.query(models.CharacterRelationship).filter(models.CharacterRelationship.universe_id == universe_id).all()
        ],
        "progressions": [
            _serialize(p, ["id", "entity_type", "entity_id", "story_date", "note", "created_at"])
            for p in db.query(models.Progression).filter(models.Progression.universe_id == universe_id).all()
        ],
        "chapters": [],
    }

    for ch in db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id).order_by(models.Chapter.number).all():
        chapter_data = _serialize(ch, ["id", "number", "title", "kind", "summary", "created_at", "updated_at"])
        chapter_data["paragraphs"] = [
            _serialize(p, ["id", "number", "text", "is_style_sample", "created_at", "updated_at"])
            for p in ch.paragraphs
        ]
        data["chapters"].append(chapter_data)

    filename = f"roman-yedek-{datetime.now(timezone.utc):%Y%m%d-%H%M}.json"
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
async def import_all(
    file: UploadFile = File(...),
    mode: str = "merge",
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
    universe_id: int = Depends(get_universe_id),
):
    """/admin/export ile alınmış bir yedeği aktif kitaba/evrene geri yükler.

    mode="merge" (varsayılan): yedekteki her şeyi YENİ kayıt olarak ekler.
    mode="wipe": SADECE aktif kitabın bölüm/paragraflarını ÖNCE SİLER,
    sonra yedekteki bölümleri baştan oluşturur. Karakterler/mekanlar/
    kurallar gibi EVREN verisi wipe modunda bile SİLİNMEZ (başka kitaplar
    tarafından kullanılıyor olabilir) - paylaşılan varlıklar her zaman
    merge (ekleme) davranışıyla geri yüklenir.

    Orijinal ID'ler KORUNMAZ - id_map ile yeni ID'lere eşlenir (bkz. modül
    üstü açıklama)."""
    if mode not in ("merge", "wipe"):
        raise HTTPException(400, "mode 'merge' veya 'wipe' olmalı")

    try:
        payload = json.loads(await file.read())
    except json.JSONDecodeError:
        raise HTTPException(400, "Geçersiz JSON dosyası")

    if mode == "wipe":
        # SADECE bu kitabın bölüm/paragraf verisi - evren verisine dokunulmaz.
        chapter_ids = [c.id for c in db.query(models.Chapter.id).filter(models.Chapter.novel_id == novel_id)]
        if chapter_ids:
            paragraph_ids = [p.id for p in db.query(models.Paragraph.id).filter(models.Paragraph.chapter_id.in_(chapter_ids))]
            if paragraph_ids:
                db.query(models.ParagraphVersion).filter(models.ParagraphVersion.paragraph_id.in_(paragraph_ids)).delete(synchronize_session=False)
                db.query(models.Mention).filter(models.Mention.paragraph_id.in_(paragraph_ids)).delete(synchronize_session=False)
            db.query(models.Paragraph).filter(models.Paragraph.chapter_id.in_(chapter_ids)).delete(synchronize_session=False)
        db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id).delete(synchronize_session=False)
        db.commit()

    counts = {}
    # Eski ID -> yeni ID eşlemesi (karakter/mekan/nesne/ipucu/terim/faksiyon),
    # diğer tabloların referanslarını (event.place_id, relationship.
    # character_a_id vb.) düzeltmek için kullanılır.
    id_map = {"character": {}, "place": {}, "object": {}, "foreshadowing": {}, "term": {}, "faction": {}}

    def _restore_simple(model, key, entity_type, extra_fields=None):
        fields = ["name", "description", "notes"] + (extra_fields or [])
        n = 0
        for row in payload.get(key, []):
            obj = model(universe_id=universe_id, **{f: row.get(f, [] if f == "aliases" else "") for f in fields})
            db.add(obj)
            db.flush()
            id_map[entity_type][row.get("id")] = obj.id
            n += 1
        counts[key] = n

    _restore_simple(models.Character, "characters", "character", ["status", "aliases"])
    _restore_simple(models.Place, "places", "place", ["aliases"])
    _restore_simple(models.Object, "objects", "object")
    _restore_simple(models.Foreshadowing, "foreshadowings", "foreshadowing", ["status"])
    _restore_simple(models.GlossaryTerm, "glossary_terms", "term")
    _restore_simple(models.Faction, "factions", "faction")
    db.commit()

    n = 0
    for row in payload.get("rules", []):
        db.add(models.Rule(universe_id=universe_id, title=row.get("title", ""), description=row.get("description", ""), tags=row.get("tags", [])))
        n += 1
    counts["rules"] = n
    db.commit()

    n = 0
    for row in payload.get("events", []):
        old_char_ids = [int(x) for x in (row.get("character_ids") or "").split(",") if x.strip()]
        new_char_ids = [id_map["character"].get(cid) for cid in old_char_ids if id_map["character"].get(cid)]
        db.add(models.Event(
            universe_id=universe_id, source_novel_id=novel_id,
            name=row.get("name", ""), description=row.get("description", ""),
            notes=row.get("notes", ""), place_id=id_map["place"].get(row.get("place_id")),
            story_date=row.get("story_date", ""), story_order=row.get("story_order"),
            character_ids=",".join(str(x) for x in new_char_ids),
        ))
        n += 1
    counts["events"] = n
    db.commit()

    n = 0
    for row in payload.get("relationships", []):
        new_a = id_map["character"].get(row.get("character_a_id"))
        new_b = id_map["character"].get(row.get("character_b_id"))
        if not new_a or not new_b:
            continue
        db.add(models.CharacterRelationship(
            universe_id=universe_id, character_a_id=new_a, character_b_id=new_b,
            label=row.get("label", ""), notes=row.get("notes", ""),
        ))
        n += 1
    counts["relationships"] = n
    db.commit()

    n = 0
    for row in payload.get("progressions", []):
        entity_type = row.get("entity_type", "")
        new_entity_id = id_map.get(entity_type, {}).get(row.get("entity_id"))
        if not new_entity_id:
            continue
        db.add(models.Progression(
            universe_id=universe_id, source_novel_id=novel_id, entity_type=entity_type, entity_id=new_entity_id,
            story_date=row.get("story_date", ""), note=row.get("note", ""),
        ))
        n += 1
    counts["progressions"] = n
    db.commit()

    chapter_count, paragraph_count = 0, 0
    for ch_row in payload.get("chapters", []):
        existing = None
        if mode == "merge":
            existing = db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id, models.Chapter.number == ch_row["number"]).first()
        if existing:
            chapter = existing
        else:
            chapter = models.Chapter(
                novel_id=novel_id, number=ch_row["number"], title=ch_row.get("title", ""),
                kind=ch_row.get("kind", "chapter"), summary=ch_row.get("summary", ""),
            )
            db.add(chapter)
            db.commit()
            db.refresh(chapter)
            chapter_count += 1

        for p_row in ch_row.get("paragraphs", []):
            exists = db.query(models.Paragraph).filter(
                models.Paragraph.chapter_id == chapter.id, models.Paragraph.number == p_row["number"]
            ).first()
            if exists:
                continue
            db.add(models.Paragraph(
                chapter_id=chapter.id, number=p_row["number"], text=p_row.get("text", ""),
                is_style_sample=p_row.get("is_style_sample", False),
            ))
            paragraph_count += 1
        db.commit()
    counts["chapters"] = chapter_count
    counts["paragraphs"] = paragraph_count

    # İçe aktarılan/geri yüklenen tüm paragrafları mention indeksi için
    # yeniden tara - aksi halde "geçtiği yerler" araması boş döner.
    imported_paragraphs = (
        db.query(models.Paragraph)
        .join(models.Chapter, models.Paragraph.chapter_id == models.Chapter.id)
        .filter(models.Chapter.novel_id == novel_id)
        .all()
    )
    for p in imported_paragraphs:
        detect_and_save_mentions(db, p)

    return {"status": "ok", "mode": mode, "restored": counts}
