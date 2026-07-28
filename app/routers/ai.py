from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import logging

from ..database import get_db
from ..auth import get_current_user
from .. import schemas
from ..qwen_client import build_context, ask_qwen, full_scan
from ..entities import ENTITY_MODELS
from ..ratelimit import rate_limit

router = APIRouter(prefix="/ai", tags=["AI Destek"])
logger = logging.getLogger("roman_api.ai")


@router.post("/assist", response_model=schemas.AiAssistResponse)
def assist(
    payload: schemas.AiAssistRequest, db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=15, window_seconds=60, label="AI yazım")),
):
    """Seçilen karakter/mekan/olay/nesne kayıtlarını + roman kurallarını
    context olarak toplar, Qwen'e gönderir. Qwen'in ürettiği hiçbir şey
    burada veritabanına yazılmaz - onay için kullanıcıya döner."""

    context = build_context(db, payload.selected_entities, chapter_number=payload.chapter_number)
    try:
        result = ask_qwen(context, payload.instruction, payload.existing_text)
    except Exception as exc:
        logger.exception("Qwen (DashScope) isteği başarısız oldu")
        raise HTTPException(
            status_code=502,
            detail=f"Qwen API'ye ulaşılamadı: {exc}. DASHSCOPE_API_KEY doğru mu ve internet bağlantısı var mı kontrol et.",
        )

    return schemas.AiAssistResponse(
        generated_text=result.get("generated_text", ""),
        consistency_notes=result.get("consistency_notes", []),
        new_entity_suggestions=result.get("new_entity_suggestions", []),
    )


@router.post("/context-preview", response_model=schemas.ContextPreviewResponse)
def preview_context(
    payload: schemas.ContextPreviewRequest,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """/ai/assist'in Qwen'e GÖNDERMEDEN önce oluşturacağı tam context'i
    gösterir - Qwen'e hiç istek atmadığı için ücretsiz ve rate-limitsizdir.
    Amaç: 'AI'ya gerçekte ne gidiyor' sorusuna güvenle cevap bulabilmek
    (Novelcrafter'daki 'prompt preview' fikrinin karşılığı)."""
    context = build_context(db, payload.selected_entities, chapter_number=payload.chapter_number)
    return schemas.ContextPreviewResponse(
        context=context,
        char_count=len(context),
        approx_tokens=len(context) // 4,  # kabaca tahmin - kesin token sayımı değil
    )


@router.post("/approve-suggestions", status_code=201)
def approve_suggestions(
    payload: schemas.ApproveSuggestionsRequest,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
):
    """Kullanıcının onayladığı önerileri işler. İki durum var:
    - existing_entity_id boşsa: yeni bir kayıt oluşturulur.
    - existing_entity_id doluysa: var olan kaydın 'notes' alanına yeni bilgi
      EKLENİR (mevcut açıklama asla silinmez/üzerine yazılmaz) - bu sayede
      "Ahmet" için ikinci bir kopya kayıt oluşmaz."""
    created = []
    updated = []
    for suggestion in payload.suggestions:
        model = ENTITY_MODELS.get(suggestion.entity_type)
        if model is None:
            continue

        if suggestion.existing_entity_id:
            item = db.query(model).filter(model.id == suggestion.existing_entity_id).first()
            if item is None:
                continue
            extra = f"\n[Bölüm güncellemesi] {suggestion.description}"
            item.notes = (item.notes or "") + extra
            db.commit()
            updated.append({"entity_type": suggestion.entity_type, "id": item.id, "name": item.name})
        else:
            item = model(name=suggestion.name, description=suggestion.description)
            db.add(item)
            db.flush()
            db.commit()
            created.append({"entity_type": suggestion.entity_type, "id": item.id, "name": item.name})

    return {"created": created, "updated": updated}


@router.post("/full-scan", response_model=schemas.FullScanResponse)
def scan_full_novel(
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=3, window_seconds=600, label="tam roman taraması")),
):
    """Yazılmış TÜM bölümleri tek seferde Qwen'e gönderip roman geneli
    tutarsızlıkları arar (bölüm bazlı /ai/assist'ten farklı olarak). Uzun
    romanlarda tek istek büyük olabilir ve context penceresini aşabilir -
    böyle bir durumda Qwen hata döner, 502 olarak iletilir."""
    try:
        result = full_scan(db)
    except Exception as exc:
        logger.exception("Tam roman taraması başarısız oldu")
        raise HTTPException(
            status_code=502,
            detail=f"Tarama başarısız: {exc}. Roman çok uzunsa Qwen'in context penceresini aşmış olabilir.",
        )
    return schemas.FullScanResponse(
        issues=result.get("issues", []),
        summary=result.get("summary", ""),
    )
