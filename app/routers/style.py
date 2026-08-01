"""Üslup taraması uçları.

- /style/patterns  : kalıp CRUD'u (regex geçerliliği kayıt ANINDA doğrulanır
  - bozuk bir regex'in sessizce kaydedilip taramada atlanmasındansa 400 ile
  anında reddedilmesi daha dürüst)
- /style/scan      : tam taramayı çalıştırır + önbelleğe yazar. AI çağrısı
  YOK (saf regex, DashScope maliyeti sıfır) ama büyük seride CPU/şifre çözme
  maliyeti var - hafif bir rate limit yeterli.
- /style/report    : son taramanın önbellekten okunması (ücretsiz/anlık).
"""
import re as _re
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from .. import models, schemas
from ..novel_context import get_universe_id
from ..ratelimit import rate_limit
from .. import style_scan

router = APIRouter(prefix="/style", tags=["Üslup Taraması"])


def _validate_regex(pattern: str) -> None:
    try:
        _re.compile(pattern)
    except _re.error as exc:
        raise HTTPException(400, f"Geçersiz regex: {exc}")


def _to_out(p: models.StylePattern) -> schemas.StylePatternOut:
    return schemas.StylePatternOut(
        id=p.id, name=p.name, pattern=p.pattern,
        threshold_per_1000=p.threshold_per_1000, min_count=p.min_count,
        enabled=p.enabled, is_refrain=bool(p.is_refrain), notes=p.notes or "",
        created_at=p.created_at, updated_at=p.updated_at,
    )


@router.get("/patterns", response_model=List[schemas.StylePatternOut])
def list_patterns(
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    universe_id: int = Depends(get_universe_id),
):
    # İlk açılışta varsayılan kalıplar otomatik tohumlanır - kullanıcı boş
    # bir listeyle değil, düzenleyebileceği makul bir başlangıçla karşılaşır.
    style_scan.seed_default_patterns(db, universe_id)
    patterns = (
        db.query(models.StylePattern)
        .filter(models.StylePattern.universe_id == universe_id)
        .all()
    )
    return sorted((_to_out(p) for p in patterns), key=lambda p: p.name.lower())


@router.post("/patterns", response_model=schemas.StylePatternOut, status_code=201)
def create_pattern(
    payload: schemas.StylePatternCreate,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    universe_id: int = Depends(get_universe_id),
):
    _validate_regex(payload.pattern)
    p = models.StylePattern(universe_id=universe_id, **payload.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return _to_out(p)


@router.put("/patterns/{pattern_id}", response_model=schemas.StylePatternOut)
def update_pattern(
    pattern_id: int, payload: schemas.StylePatternUpdate,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    universe_id: int = Depends(get_universe_id),
):
    p = (
        db.query(models.StylePattern)
        .filter(models.StylePattern.id == pattern_id, models.StylePattern.universe_id == universe_id)
        .first()
    )
    if not p:
        raise HTTPException(404, "Kalıp bulunamadı")
    data = payload.model_dump(exclude_unset=True)
    if "pattern" in data:
        _validate_regex(data["pattern"])
    for k, v in data.items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return _to_out(p)


@router.delete("/patterns/{pattern_id}", status_code=204)
def delete_pattern(
    pattern_id: int,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    universe_id: int = Depends(get_universe_id),
):
    p = (
        db.query(models.StylePattern)
        .filter(models.StylePattern.id == pattern_id, models.StylePattern.universe_id == universe_id)
        .first()
    )
    if not p:
        raise HTTPException(404, "Kalıp bulunamadı")
    db.delete(p)
    db.commit()


def _report_to_schema(report: dict) -> schemas.StyleScanReport:
    return schemas.StyleScanReport(
        scanned=True,
        scanned_at=report.get("scanned_at"),
        total_words=report.get("total_words", 0),
        chapter_count=report.get("chapter_count", 0),
        patterns=[schemas.StylePatternResult(**p) for p in report.get("patterns", [])],
        invalid_patterns=[schemas.StyleInvalidPattern(**p) for p in report.get("invalid_patterns", [])],
    )


@router.post("/scan", response_model=schemas.StyleScanReport)
def run_scan(
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=4, window_seconds=60, label="üslup taraması")),
    universe_id: int = Depends(get_universe_id),
):
    """Tam taramayı ŞİMDİ çalıştırır ve önbelleğe yazar. Kişisel roman
    ölçeğinde saniyeler sürer (saf regex + alan şifresi çözme); çok büyük
    serilerde uzarsa arka plan işine taşınabilir - şimdilik senkron."""
    report = style_scan.run_scan_and_cache(db, universe_id)
    return _report_to_schema(report)


@router.get("/report", response_model=schemas.StyleScanReport)
def get_report(
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    universe_id: int = Depends(get_universe_id),
):
    report = style_scan.load_scan_result(db, universe_id)
    if report is None:
        return schemas.StyleScanReport(scanned=False)
    return _report_to_schema(report)
