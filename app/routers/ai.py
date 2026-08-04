from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import logging

from ..database import get_db
from ..auth import get_current_user
from .. import schemas, models
from ..qwen_client import (
    build_context, ask_qwen, full_scan, chat_with_qwen, reader_test_chapter,
    suggest_paragraph_entities, trim_chat_history, estimate_context_size, literary_review,
)
from ..entities import ENTITY_MODELS
from ..sections import SECTIONS_BY_ENTITY_TYPE, _tr_lower
from ..ratelimit import rate_limit
from ..novel_context import get_novel_id, get_universe_id

router = APIRouter(prefix="/ai", tags=["AI Destek"])
logger = logging.getLogger("roman_api.ai")


@router.post("/assist", response_model=schemas.AiAssistResponse)
def assist(
    payload: schemas.AiAssistRequest, db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=15, window_seconds=60, label="AI yazım")),
    novel_id: int = Depends(get_novel_id), universe_id: int = Depends(get_universe_id),
):
    """Seçilen karakter/mekan/olay/nesne kayıtlarını + roman kurallarını
    context olarak toplar, Qwen'e gönderir. Qwen'in ürettiği hiçbir şey
    burada veritabanına yazılmaz - onay için kullanıcıya döner."""

    context = build_context(
        db, novel_id, universe_id, payload.selected_entities,
        chapter_number=payload.chapter_number, instruction_text=payload.instruction,
        include_hidden=payload.include_hidden,
    )
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
    novel_id: int = Depends(get_novel_id), universe_id: int = Depends(get_universe_id),
):
    """/ai/assist'in Qwen'e GÖNDERMEDEN önce oluşturacağı tam context'i
    gösterir - Qwen'e hiç istek atmadığı için ücretsiz ve rate-limitsizdir.
    Amaç: 'AI'ya gerçekte ne gidiyor' sorusuna güvenle cevap bulabilmek
    (Novelcrafter'daki 'prompt preview' fikrinin karşılığı)."""
    context = build_context(
        db, novel_id, universe_id, payload.selected_entities,
        chapter_number=payload.chapter_number, instruction_text=payload.instruction,
        include_hidden=payload.include_hidden,
        include_chapter_text=payload.include_chapter_text,
        text_scope=payload.text_scope,
    )
    chars, tokens, breakdown = estimate_context_size(context)
    return schemas.ContextPreviewResponse(
        context=context, char_count=chars, approx_tokens=tokens,
        breakdown=[schemas.ContextLayerSize(**b) for b in breakdown],
    )


@router.post("/chat", response_model=schemas.AiChatResponse)
def chat(
    payload: schemas.AiChatRequest, db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=25, window_seconds=60, label="AI sohbet")),
    novel_id: int = Depends(get_novel_id), universe_id: int = Depends(get_universe_id),
):
    """Tek seferlik 'talimat -> yapılandırılmış sonuç' akışının aksine,
    kullanıcıyla ileri-geri mesajlaşan sohbet modu (bkz. qwen_client.
    chat_with_qwen). Qwen'in kendi hafızası olmadığı için tüm konuşma
    geçmişi (payload.messages) her istekte yeniden gönderilir - context
    (fihrist+kurallar+seçili varlıklar) da her seferinde build_context ile
    taze üretilir, böylece sohbet sırasında menülerde yapılan değişiklikler
    de anında yansır."""
    if not payload.messages:
        raise HTTPException(400, "En az bir mesaj gerekli")

    last_user_message = next((m.content for m in reversed(payload.messages) if getattr(m, "role", None) == "user"), "")
    context = build_context(
        db, novel_id, universe_id, payload.selected_entities,
        chapter_number=payload.chapter_number, instruction_text=last_user_message,
        include_hidden=payload.include_hidden,
        # Sohbette bölümün METNİ de gitmeli: "bu bölümü konuşalım",
        # "P12'yi tartışalım" gibi istekler ancak metin varsa anlamlı.
        include_chapter_text=True,
        text_scope=payload.text_scope,
    )
    try:
        # GEÇMİŞ BUDAMA: son turlar tam, öncesi özet (bkz. trim_chat_history).
        # Uzun sohbetlerde hem maliyet hem kalite kaybını önler.
        trimmed = trim_chat_history([m.model_dump() for m in payload.messages])
        reply, actions_taken, pending_entity_updates, draft_result = chat_with_qwen(
            db, novel_id, universe_id, context, trimmed,
            current_result=payload.current_result,
        )
    except Exception as exc:
        logger.exception("AI sohbet isteği başarısız oldu")
        raise HTTPException(
            status_code=502,
            detail=f"Qwen API'ye ulaşılamadı: {exc}. DASHSCOPE_API_KEY doğru mu ve internet bağlantısı var mı kontrol et.",
        )
    return schemas.AiChatResponse(
        reply=reply, actions_taken=actions_taken,
        pending_entity_updates=pending_entity_updates, draft_result=draft_result,
    )


@router.post("/approve-suggestions", status_code=201)
def approve_suggestions(
    payload: schemas.ApproveSuggestionsRequest,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    universe_id: int = Depends(get_universe_id),
):
    """Kullanıcının onayladığı önerileri işler. İki durum var:
    - existing_entity_id boşsa: yeni bir kayıt oluşturulur (aktif evrene bağlı).
    - existing_entity_id doluysa: var olan kaydın 'notes' alanına yeni bilgi
      EKLENİR (mevcut açıklama asla silinmez/üzerine yazılmaz) - bu sayede
      "Ahmet" için ikinci bir kopya kayıt oluşmaz."""
    created = []
    updated = []
    for suggestion in payload.suggestions:
        model = ENTITY_MODELS.get(suggestion.entity_type)
        if model is None:
            continue

        # AI'dan gelen sections anahtarları önce SANİTİZE edilir (geçerli
        # olmayan atılır, meta asla) - 422 yerine temizleme: kullanıcının
        # onayladığı iyi kısımlar, modelin bir uydurma anahtarı yüzünden
        # boşa düşmesin.
        valid_keys = set(SECTIONS_BY_ENTITY_TYPE.get(suggestion.entity_type, {})) - {"meta"}
        clean_sections = {
            k: v.strip() for k, v in (suggestion.sections or {}).items()
            if k in valid_keys and isinstance(v, str) and v.strip()
        }
        clean_aliases = [a.strip() for a in (suggestion.aliases or []) if a and a.strip()]

        if suggestion.existing_entity_id:
            item = db.query(model).filter(model.id == suggestion.existing_entity_id, model.universe_id == universe_id).first()
            if item is None:
                continue
            extra = f"\n[Bölüm güncellemesi] {suggestion.description}"
            item.notes = (item.notes or "") + extra
            # Alias birleştirme: sadece eksik olanlar eklenir (yeni liste
            # ATANIR - EncryptedJSON in-place mutasyonu fark etmeyebilir).
            if clean_aliases and hasattr(item, "aliases"):
                # Türkçe İ/ı tuzağı: "SİSTEM".lower() != "sistem" (İ -> i+nokta).
                # Karşılaştırma _tr_lower ile - "SİSTEM", kayıtlı "sistem"in
                # kopyası olarak doğru şekilde elenir.
                current = list(item.aliases or [])
                current_lower = {_tr_lower(a) for a in current} | {_tr_lower(item.name or "")}
                merged = current + [a for a in clean_aliases if _tr_lower(a) not in current_lower]
                if merged != current:
                    item.aliases = merged
            # Profil ekleme: ilgili bölümün SONUNA, kaynağı belli etiketle.
            if clean_sections and hasattr(item, "sections"):
                merged_sections = dict(item.sections or {})
                for k, v in clean_sections.items():
                    existing_val = (merged_sections.get(k) or "").strip()
                    merged_sections[k] = f"{existing_val}\n\n[Bölümden] {v}".strip() if existing_val else v
                item.sections = merged_sections
            db.commit()
            updated.append({"entity_type": suggestion.entity_type, "id": item.id, "name": item.name})
        else:
            item = model(universe_id=universe_id, name=suggestion.name, description=suggestion.description)
            if clean_aliases and hasattr(model, "aliases"):
                item.aliases = clean_aliases
            if clean_sections and hasattr(model, "sections"):
                item.sections = clean_sections
            db.add(item)
            db.flush()
            db.commit()
            created.append({"entity_type": suggestion.entity_type, "id": item.id, "name": item.name})

    return {"created": created, "updated": updated}


@router.post("/approve-entity-update")
def approve_entity_update(
    payload: schemas.EntityUpdateApproval,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    universe_id: int = Depends(get_universe_id),
):
    """Sohbette AI'nın önerdiği bir varlık güncellemesini (bkz.
    propose_entity_update / EntityUpdateProposal) kullanıcı onayladığında
    çağrılır. mode='append' (varsayılan) ise mevcut metnin SONUNA eklenir -
    hiçbir zaman sessizce üzerine yazılmaz. mode='replace' sadece kullanıcı
    BİLEREK seçtiğinde (ör. AI bir çelişki tespit ettiğinde ve kullanıcı
    'eskiyi değiştir' dediğinde) kullanılır."""
    model = ENTITY_MODELS.get(payload.entity_type)
    if model is None or not hasattr(model, "sections"):
        raise HTTPException(400, f"'{payload.entity_type}' için bölüm güncellemesi desteklenmiyor")

    item = db.query(model).filter(model.id == payload.entity_id, model.universe_id == universe_id).first()
    if not item:
        raise HTTPException(404, f"{payload.entity_type} id={payload.entity_id} bulunamadı")

    new_content = payload.content.strip()
    if not new_content:
        raise HTTPException(400, "content boş olamaz")

    if payload.section == "notes":
        existing = item.notes or ""
        item.notes = new_content if (payload.mode == "replace" or not existing) else f"{existing}\n{new_content}"
        result_text = item.notes
    else:
        allowed = SECTIONS_BY_ENTITY_TYPE.get(payload.entity_type)
        if allowed is None or payload.section == "meta" or payload.section not in allowed:
            raise HTTPException(400, f"Geçersiz section '{payload.section}' ({payload.entity_type} için)")
        current_sections = dict(item.sections or {})
        existing = current_sections.get(payload.section, "")
        current_sections[payload.section] = new_content if (payload.mode == "replace" or not existing) else f"{existing}\n{new_content}"
        item.sections = current_sections
        result_text = current_sections[payload.section]

    db.commit()
    db.refresh(item)
    return {
        "entity_type": payload.entity_type, "id": item.id, "name": item.name,
        "section": payload.section, "new_content": result_text,
    }


@router.post("/full-scan", response_model=schemas.FullScanResponse)
def scan_full_novel(
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=3, window_seconds=600, label="tam roman taraması")),
    novel_id: int = Depends(get_novel_id), universe_id: int = Depends(get_universe_id),
):
    """Yazılmış TÜM bölümleri tek seferde Qwen'e gönderip roman geneli
    tutarsızlıkları arar (bölüm bazlı /ai/assist'ten farklı olarak). Çok
    uzun romanlarda (bkz. qwen_client.full_scan) otomatik olarak ardışık
    parçalara bölünür - context penceresini aşma riski böylece büyük ölçüde
    azalır, ama sıfıra inmez (bkz. full_scan docstring)."""
    try:
        result = full_scan(db, novel_id, universe_id)
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


@router.post("/reader-test/{chapter_id}", response_model=schemas.ReaderTestResponse)
def reader_test(
    chapter_id: int,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=6, window_seconds=60, label="okur testi")),
    novel_id: int = Depends(get_novel_id),
):
    """Bölümü "okuru düşürecek nokta" taramasından geçirir (tempo, bilgi
    bocası, klişe, anlaşılmazlık, gerilim kırılması, inandırıcılık).
    SADECE uyarır - metne dokunmaz, hiçbir şey kaydetmez."""
    chapter = db.query(models.Chapter).filter(
        models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id
    ).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    try:
        findings = reader_test_chapter(db, chapter)
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")
    return schemas.ReaderTestResponse(
        chapter_number=chapter.number,
        findings=[schemas.ReaderTestFinding(**f) for f in findings],
    )


@router.post("/paragraph-entities", response_model=schemas.ParagraphEntitiesResponse)
def paragraph_entities(
    payload: schemas.ParagraphEntitiesRequest,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=20, window_seconds=60, label="paragraf tarama")),
    universe_id: int = Depends(get_universe_id),
):
    """Tek paragraf için K/M/N balonu adayları. Her paragraf kaydında bir
    kez çağrılır - bu yüzden limit geniş (20/dk) ama var: metin editöründe
    seri kayıtlar DashScope faturasına dönüşmesin."""
    try:
        suggestions = suggest_paragraph_entities(db, universe_id, payload.text)
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")
    return schemas.ParagraphEntitiesResponse(
        suggestions=[schemas.AiSuggestion(**s) for s in suggestions]
    )


@router.post("/literary-review/{chapter_id}", response_model=schemas.LiteraryReviewResponse)
def literary_review_endpoint(
    chapter_id: int,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=6, window_seconds=60, label="edebî değerlendirme")),
    novel_id: int = Depends(get_novel_id),
):
    """Bölümü 10 edebî ölçüte göre değerlendirir (betimleme, atmosfer,
    imgesellik, yapısal akış, alt metin, dil ekonomisi, ritim, sembolizm,
    karakterizasyon, üslup). Puanlar tek başına amaç değil - asıl çıktı en
    zayıf başlıklar için verilen SOMUT düzeltmelerdir. Metne dokunmaz."""
    chapter = db.query(models.Chapter).filter(
        models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id
    ).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    try:
        result = literary_review(db, chapter)
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")
    scores = [schemas.LiteraryScore(**s) for s in result["scores"]]
    ortalama = round(sum(s.score for s in scores) / len(scores), 2) if scores else 0
    return schemas.LiteraryReviewResponse(
        chapter_number=chapter.number, scores=scores, strongest=result["strongest"],
        fixes=[schemas.LiteraryFix(**f) for f in result["fixes"]], average=ortalama,
    )
