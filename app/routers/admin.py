"""Yedekleme / dışa aktarma ve içe aktarma (geri yükleme) uçları.

Railway gibi platformlarda sunucuya terminalle kolay erişemediğin için,
tüm romanı tek tıkla JSON olarak indirip bilgisayarında saklayabilmen için
bu endpoint eklendi. İçerik EncryptedString alanlarından ORM üzerinden
okunduğu için JSON'da düz (okunabilir) metin olarak çıkar - yani export
dosyasını nereye koyarsan koy, DB_ENCRYPTION_KEY'e ihtiyaç duymadan
okuyabilirsin. Bu yüzden export dosyasını da güvenli bir yerde tut.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
import json

from ..database import get_db
from ..auth import get_current_user
from .. import models
from ..mentions import detect_and_save_mentions

router = APIRouter(prefix="/admin", tags=["Yönetim"])

_SIMPLE_FIELDS = ["id", "name", "description", "notes", "created_at", "updated_at"]


def _serialize(item, fields):
    out = {}
    for f in fields:
        v = getattr(item, f, None)
        out[f] = v.isoformat() if isinstance(v, datetime) else v
    return out


@router.get("/export")
def export_all(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    """Tüm romanı (karakterler, mekanlar, olaylar, bölümler, paragraflar,
    ilişkiler, kurallar vb.) tek bir JSON dosyası olarak indirir."""
    data = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "format_version": 1,
        "characters": [_serialize(c, _SIMPLE_FIELDS + ["status"]) for c in db.query(models.Character).all()],
        "places": [_serialize(p, _SIMPLE_FIELDS) for p in db.query(models.Place).all()],
        "objects": [_serialize(o, _SIMPLE_FIELDS) for o in db.query(models.Object).all()],
        "foreshadowings": [_serialize(f, _SIMPLE_FIELDS + ["status"]) for f in db.query(models.Foreshadowing).all()],
        "glossary_terms": [_serialize(g, _SIMPLE_FIELDS) for g in db.query(models.GlossaryTerm).all()],
        "rules": [_serialize(r, ["id", "title", "description", "created_at", "updated_at"]) for r in db.query(models.Rule).all()],
        "events": [
            _serialize(e, ["id", "name", "description", "notes", "place_id", "story_date", "story_order", "character_ids", "created_at", "updated_at"])
            for e in db.query(models.Event).all()
        ],
        "relationships": [
            _serialize(r, ["id", "character_a_id", "character_b_id", "label", "notes", "created_at"])
            for r in db.query(models.CharacterRelationship).all()
        ],
        "progressions": [
            _serialize(p, ["id", "entity_type", "entity_id", "chapter_number", "note", "created_at"])
            for p in db.query(models.Progression).all()
        ],
        "chapters": [],
    }

    for ch in db.query(models.Chapter).order_by(models.Chapter.number).all():
        chapter_data = _serialize(ch, ["id", "number", "title", "summary", "created_at", "updated_at"])
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
):
    """/admin/export ile alınmış bir yedeği geri yükler.

    mode="merge" (varsayılan): sadece eksik kayıtları ekler, var olanlara dokunmaz.
    mode="wipe": ÖNCE TÜM VERİYİ SİLER, sonra yedekteki her şeyi yeniden oluşturur.
    Bu ikinci mod geri alınamaz - sadece bilerek kullan.
    """
    if mode not in ("merge", "wipe"):
        raise HTTPException(400, "mode 'merge' veya 'wipe' olmalı")

    try:
        payload = json.loads(await file.read())
    except json.JSONDecodeError:
        raise HTTPException(400, "Geçersiz JSON dosyası")

    if mode == "wipe":
        for model in [models.Mention, models.Paragraph, models.Chapter, models.Progression, models.Event,
                      models.CharacterRelationship, models.Character, models.Place,
                      models.Object, models.Foreshadowing, models.GlossaryTerm, models.Rule]:
            db.query(model).delete()
        db.commit()

    counts = {}

    def _restore_simple(model, key, extra_fields=None):
        fields = ["name", "description", "notes"] + (extra_fields or [])
        n = 0
        for row in payload.get(key, []):
            if mode == "merge":
                exists = db.query(model).filter(model.id == row.get("id")).first()
                if exists:
                    continue
            obj = model(id=row.get("id"), **{f: row.get(f, "") for f in fields})
            db.add(obj)
            n += 1
        counts[key] = n

    _restore_simple(models.Character, "characters", ["status"])
    _restore_simple(models.Place, "places")
    _restore_simple(models.Object, "objects")
    _restore_simple(models.Foreshadowing, "foreshadowings", ["status"])
    _restore_simple(models.GlossaryTerm, "glossary_terms")
    db.commit()

    n = 0
    for row in payload.get("rules", []):
        if mode == "merge" and db.query(models.Rule).filter(models.Rule.id == row.get("id")).first():
            continue
        db.add(models.Rule(id=row.get("id"), title=row.get("title", ""), description=row.get("description", "")))
        n += 1
    counts["rules"] = n
    db.commit()

    n = 0
    for row in payload.get("events", []):
        if mode == "merge" and db.query(models.Event).filter(models.Event.id == row.get("id")).first():
            continue
        db.add(models.Event(
            id=row.get("id"), name=row.get("name", ""), description=row.get("description", ""),
            notes=row.get("notes", ""), place_id=row.get("place_id"), story_date=row.get("story_date", ""),
            story_order=row.get("story_order"), character_ids=row.get("character_ids", ""),
        ))
        n += 1
    counts["events"] = n
    db.commit()

    n = 0
    for row in payload.get("relationships", []):
        if mode == "merge" and db.query(models.CharacterRelationship).filter(models.CharacterRelationship.id == row.get("id")).first():
            continue
        db.add(models.CharacterRelationship(
            id=row.get("id"), character_a_id=row["character_a_id"], character_b_id=row["character_b_id"],
            label=row.get("label", ""), notes=row.get("notes", ""),
        ))
        n += 1
    counts["relationships"] = n
    db.commit()

    n = 0
    for row in payload.get("progressions", []):
        if mode == "merge" and db.query(models.Progression).filter(models.Progression.id == row.get("id")).first():
            continue
        db.add(models.Progression(
            id=row.get("id"), entity_type=row.get("entity_type", ""), entity_id=row.get("entity_id"),
            chapter_number=row.get("chapter_number"), note=row.get("note", ""),
        ))
        n += 1
    counts["progressions"] = n
    db.commit()

    chapter_count, paragraph_count = 0, 0
    for ch_row in payload.get("chapters", []):
        chapter = db.query(models.Chapter).filter(models.Chapter.number == ch_row["number"]).first()
        if not chapter:
            chapter = models.Chapter(number=ch_row["number"], title=ch_row.get("title", ""), summary=ch_row.get("summary", ""))
            db.add(chapter)
            db.commit()
            db.refresh(chapter)
            chapter_count += 1
        for p_row in ch_row.get("paragraphs", []):
            exists = db.query(models.Paragraph).filter(
                models.Paragraph.chapter_id == chapter.id, models.Paragraph.number == p_row["number"]
            ).first()
            if exists and mode == "merge":
                continue
            if exists and mode == "wipe":
                exists.text = p_row.get("text", "")
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
    for p in db.query(models.Paragraph).all():
        detect_and_save_mentions(db, p)

    return {"status": "ok", "mode": mode, "restored": counts}
