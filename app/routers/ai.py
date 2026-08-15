from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import logging

from ..database import get_db
from ..auth import get_current_user
from .. import schemas, models
from ..qwen_client import (
    build_context, ask_qwen, full_scan, chat_with_qwen, reader_test_chapter,
    suggest_paragraph_entities, trim_chat_history, estimate_context_size, literary_review, structure_scan, verify_paragraph_rewrite, retest_paragraph, motif_map, paragraph_roles, fuse_diagnoses, evaluate_tradeoff, paragraph_necessity, plan_from_text, micro_edit, extract_knowledge_map, review_arc, scan_voice, review_options, strip_tool_leaks,
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
        include_own_summary=getattr(payload, 'include_own_summary', False),
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
        include_own_summary=payload.include_own_summary,
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
        reply=strip_tool_leaks(reply), actions_taken=actions_taken,
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
        scanned=result.get("scanned", 0), total=result.get("total", 0),
        chunks=result.get("chunks", 1),
    )


@router.post("/structure-scan", response_model=schemas.StructureScanResponse)
def structure_scan_endpoint(
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=4, window_seconds=120, label="yapısal tarama")),
    novel_id: int = Depends(get_novel_id),
):
    """Bölümler ARASI yapısal akış denetimi: nedensellik ("bu yüzden" mi
    "ve sonra" mı), tekrar eden çatışma, bahis eğrisi, ölü bölgeler, bölüm
    kapanışları. Özetlerle çalışır - bölüm metinlerini göndermez (ucuz)."""
    try:
        result = structure_scan(db, novel_id)
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")
    return schemas.StructureScanResponse(
        summary=result.get("summary", ""),
        causality=[schemas.CausalityLink(**c) for c in result.get("causality", []) if isinstance(c, dict) and "from" in c and "to" in c],
        repetition=[schemas.RepetitionFinding(**r) for r in result.get("repetition", []) if isinstance(r, dict)],
        stakes=schemas.StakesTrend(**(result.get("stakes") or {})),
        dead_zones=[schemas.ChapterNote(**d) for d in result.get("dead_zones", []) if isinstance(d, dict)],
        endings=[schemas.ChapterNote(**e) for e in result.get("endings", []) if isinstance(e, dict)],
        missing_summaries=result.get("missing_summaries", []),
    )


@router.post("/verify-rewrite", response_model=schemas.VerifyRewriteResponse)
def verify_rewrite(
    payload: schemas.VerifyRewriteRequest,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=30, window_seconds=60, label="kabul kontrolü")),
    universe_id: int = Depends(get_universe_id),
):
    """Yeni paragraf versiyonunu KABUL ETMEDEN ÖNCE denetler: işlevini
    yerine getiriyor mu, somut detay düştü mü, komşularla çelişiyor mu,
    yasak üslup kalıbı girdi mi. Sayı/isim kaybı ve yasak kalıp kontrolü
    deterministiktir (AI'ya sorulmaz)."""
    try:
        result = verify_paragraph_rewrite(
            db, universe_id, payload.old_text, payload.new_text,
            purpose=payload.purpose, neighbors=payload.neighbors,
            proposal_goal=payload.proposal_goal, expected_effect=payload.expected_effect,
            accepted_changes=payload.accepted_changes,
        )
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")
    return schemas.VerifyRewriteResponse(**result)


@router.post("/retest-paragraph", response_model=schemas.RetestResponse)
def retest_paragraph_endpoint(
    payload: schemas.RetestRequest,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=20, window_seconds=60, label="yeniden test")),
    universe_id: int = Depends(get_universe_id),
):
    """Düzeltilen paragrafı, giderilmesi istenen BULGULARA karşı sınar:
    hangisi giderildi, hangisi kısmen, yeni sorun doğdu mu. Kabul kontrolü
    'detay düştü mü' diye bakar; bu 'klişe kalktı mı' diye bakar."""
    try:
        return schemas.RetestResponse(**retest_paragraph(
            db, payload.old_text, payload.new_text, payload.findings,
            proposal_goal=payload.proposal_goal, expected_effect=payload.expected_effect,
        ))
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")


@router.post("/motif-map/{chapter_id}", response_model=schemas.MotifMapResponse)
def motif_map_endpoint(
    chapter_id: int,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=4, window_seconds=120, label="imge haritası")),
    novel_id: int = Depends(get_novel_id),
):
    """Bölümün İMGE/MOTİF haritası: tüm paragrafların imgeleri çıkarılır,
    sonra SADECE liste değerlendirilir - böylece 12. paragrafla 78. paragraf
    aynı bakışta kıyaslanır (dilimleme sınırı aşılır). Leitmotif (bilinçli,
    anlam biriktiren tekrar) ile TEKRAR (aynı imge aynı işlevle) ayrılır."""
    chapter = db.query(models.Chapter).filter(
        models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id
    ).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    try:
        return schemas.MotifMapResponse(**motif_map(db, chapter))
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")


@router.post("/paragraph-roles/{chapter_id}", response_model=schemas.ParagraphRolesResponse)
def paragraph_roles_endpoint(
    chapter_id: int,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=6, window_seconds=120, label="paragraf işlevleri")),
    novel_id: int = Depends(get_novel_id),
):
    """Her paragrafın sahnedeki GÖREVİNİ çıkarır ("olay mahalli tanıtılıyor",
    "dijital doğum hazırlığı"). İşlev, yeniden yazımın ölçüsüdür; 100
    paragrafa tek tek elle yazmak gerçekçi değildi. Bölüm özeti ve planı
    kullanılır. Kullanıcı üzerine yazabilir."""
    chapter = db.query(models.Chapter).filter(
        models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id
    ).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    try:
        return schemas.ParagraphRolesResponse(roles=[schemas.ParagraphRole(**r) for r in paragraph_roles(db, chapter)])
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")


@router.post("/fuse-diagnoses", response_model=schemas.FusionResponse)
def fuse_diagnoses_endpoint(
    payload: schemas.FusionRequest,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=30, window_seconds=60, label="teşhis füzyonu")),
    universe_id: int = Depends(get_universe_id),
):
    """Farklı testlerden gelen ham bulguları TEK teşhiste birleştirir ve
    sınıflandırır: hata / zayif / tercih / belirsiz. 'tercih' için öneri
    üretilmez (yazarın bilinçli tercihi olabilir); kanıtsız teşhis
    'belirsiz'e çekilir."""
    try:
        return schemas.FusionResponse(diagnoses=[
            schemas.Diagnosis(**d) for d in fuse_diagnoses(
                db, payload.paragraph_text,
                [f.model_dump() for f in payload.findings],
                purpose=payload.purpose, neighbors=payload.neighbors,
            )
        ])
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")


@router.post("/tradeoff", response_model=schemas.TradeoffResponse)
def tradeoff_endpoint(
    payload: schemas.TradeoffRequest,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=30, window_seconds=60, label="kazanç-kayıp")),
    universe_id: int = Depends(get_universe_id),
):
    """Öneriyi kazanç-kayıp dengesiyle ölçer ve KARŞI ARGÜMAN üretir:
    "tempo +2, atmosfer -3 → net -1, reddet"."""
    try:
        return schemas.TradeoffResponse(**evaluate_tradeoff(db, payload.old_text, payload.new_text, payload.purpose))
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")


@router.post("/necessity/{chapter_id}", response_model=schemas.NecessityResponse)
def necessity_endpoint(
    chapter_id: int, payload: schemas.NecessityRequest,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=30, window_seconds=60, label="gereklilik testi")),
    novel_id: int = Depends(get_novel_id),
):
    """Silme testi + edebî kalite/anlatısal gereklilik ayrımı. Karakter
    değişimi ya da ön sezdirme taşıyan paragraf için silme önerilmez."""
    chapter = db.query(models.Chapter).filter(
        models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id
    ).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    try:
        return schemas.NecessityResponse(**paragraph_necessity(db, chapter, payload.paragraph_text, payload.purpose))
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")


@router.post("/plan-from-text/{chapter_id}", response_model=schemas.PlanFromTextResponse)
def plan_from_text_endpoint(
    chapter_id: int,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=6, window_seconds=120, label="metinden plan")),
    novel_id: int = Depends(get_novel_id),
):
    """Yazılmış bölümden GERİYE DÖNÜK plan çıkarır. Önce yazıp sonra
    planlayan bir yazar için şart: plan yoksa paragrafların işlevi tanımsız
    kalıyor ve işlev mirası çalışmıyor. Öneri döner, kaydetmez."""
    chapter = db.query(models.Chapter).filter(
        models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id
    ).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    try:
        return schemas.PlanFromTextResponse(plan=plan_from_text(db, chapter))
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")


@router.post("/micro-edit", response_model=schemas.MicroEditResponse)
def micro_edit_endpoint(
    payload: schemas.MicroEditRequest,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=40, window_seconds=60, label="mikro düzenleme")),
    universe_id: int = Depends(get_universe_id),
):
    """MİKRO DÜZENLEME: paragrafın yalnızca HEDEF PARÇASINI değiştirir,
    gerisine dokunmaz. Tek bir ifade takıldığında paragrafı baştan
    yazdırmak hem gereksiz hem riskli - iyi cümleler kayboluyordu."""
    try:
        return schemas.MicroEditResponse(options=[
            schemas.MicroEditOption(**o) for o in micro_edit(
                db, payload.paragraph_text, payload.target, payload.request, payload.purpose)
        ])
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")


@router.post("/knowledge-scan", response_model=schemas.KnowledgeScanResponse)
def knowledge_scan(
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=4, window_seconds=120, label="bilgi haritası taraması")),
    novel_id: int = Depends(get_novel_id),
):
    """Bölüm ÖZETLERİNİ tarayarak bilgi haritasını önerir ve TUTARSIZLIKLARI
    bildirir: bilgi sızması (karakter bilmediği şeye göre davranıyor), erken
    ifşa, ödenmemiş kurulum (kurulup unutulmuş bilgi), çelişki. Kaydetmez."""
    try:
        return schemas.KnowledgeScanResponse(**extract_knowledge_map(db, novel_id))
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")


@router.post("/arc-review/{chapter_id}", response_model=schemas.ArcReviewResponse)
def arc_review_endpoint(
    chapter_id: int,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=6, window_seconds=120, label="tur değerlendirmesi")),
    novel_id: int = Depends(get_novel_id),
):
    """TUR DEĞERLENDİRMESİ: bir üst başlık altındaki tüm alt sahneleri bir
    bütün olarak denetler - iç yay yükseliyor mu, sahne uzunlukları
    işlevleriyle uyumlu mu, sahneler arası tekrar var mı, kapanış eşik
    bırakıyor mu, hacim dengeli mi. Özetlerle çalışır (ucuz)."""
    try:
        return schemas.ArcReviewResponse(**review_arc(db, novel_id, chapter_id))
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")


@router.post("/voice-scan/{chapter_id}", response_model=schemas.VoiceScanResponse)
def voice_scan_endpoint(
    chapter_id: int,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=6, window_seconds=120, label="anlatıcı taraması")),
    novel_id: int = Depends(get_novel_id),
    universe_id: int = Depends(get_universe_id),
):
    """ANLATICI/ODAK DENETİMİ: bakış açısı kayması (aynı sahnede iki
    karakterin zihnine girme), anlatıcının bilemeyeceği bilgiyi vermesi,
    mesafe/zaman kayması, yorum sızması. Aynı paragraf anlatıcıya göre
    tamamen farklı okunur - bu katman yoktu."""
    chapter = db.query(models.Chapter).filter(
        models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id
    ).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    try:
        return schemas.VoiceScanResponse(**scan_voice(db, chapter, universe_id))
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")


@router.post("/review-options", response_model=schemas.ReviewOptionsResponse)
def review_options_endpoint(
    payload: schemas.ReviewOptionsRequest,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=20, window_seconds=60, label="aday değerlendirme")),
    universe_id: int = Depends(get_universe_id),
):
    """Üretilen ADAYLARI BİRLİKTE değerlendirir: her biri hangi bulguyu
    giderdi, hangisi duruyor, yeni sorun doğdu mu, hangisi en iyi. Tek
    istekte (her adayı ayrı denetlemekten ucuz) ve kıyaslamalı.

    Otomatik yeniden üretim YOK: kontrol sık sık fazla katı davranıyor;
    otomatik ret, kullanıcıyı sistemin katılığına hapseden bir döngü kurar.
    Sistem "hepsi yetersiz, sebebi bu" der - kararı kullanıcı verir."""
    try:
        return schemas.ReviewOptionsResponse(**review_options(
            db, payload.original, payload.options, payload.findings, payload.purpose))
    except Exception as exc:
        raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")
