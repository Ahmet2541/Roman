from typing import List, Optional
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..database import get_db
from ..auth import get_current_user
from .. import models, schemas
from ..mentions import detect_and_save_mentions
from ..entities import ENTITY_MODELS
from ..import_parser import parse_manuscript, split_paragraphs
from ..qwen_client import (
    summarize_chapter, suggest_entities_for_chapter, suggest_progressions_for_chapter,
    suggest_entities_for_chapters, suggest_progressions_for_chapters,
    suggest_relationships_for_chapter, suggest_relationships_for_chapters,
    suggest_events_for_chapter, suggest_events_for_chapters,
    split_paragraphs_with_ai,
)
from ..ratelimit import rate_limit
from ..novel_context import get_novel_id

router = APIRouter(prefix="/chapters", tags=["Bölümler"])
logger = logging.getLogger("roman_api.chapters")


@router.get("/", response_model=List[schemas.ChapterListOut])
def list_chapters(db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    chapters = db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id).order_by(models.Chapter.number).all()
    # Kısım/Alt Başlık normalde paragrafsız olur (sadece ayraç) - ama backend
    # bunu hiçbir yerde ENGELLEMİYOR, yani yanlışlıkla (ör. "Yeni Bölüm"
    # yerine "Yeni Başlık (Kısım)" seçilip metin yazılmışsa) bir Kısım'ın
    # KENDİSİNDE paragraf birikmiş olabilir - bu durumda o içerik fihristten
    # "buraya git" ile hiç erişilemez hale gelirdi. paragraph_count bunu
    # frontend'in tespit edip doğrudan açılabilir kılması için var.
    counts = dict(
        db.query(models.Paragraph.chapter_id, func.count(models.Paragraph.id))
        .join(models.Chapter, models.Paragraph.chapter_id == models.Chapter.id)
        .filter(models.Chapter.novel_id == novel_id)
        .group_by(models.Paragraph.chapter_id)
        .all()
    )
    result = []
    for c in chapters:
        out = schemas.ChapterListOut.model_validate(c)
        out.paragraph_count = counts.get(c.id, 0)
        result.append(out)
    return result


@router.post("/", response_model=schemas.ChapterOut, status_code=201)
def create_chapter(payload: schemas.ChapterCreate, db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    if payload.kind not in ("chapter", "part", "subtitle"):
        raise HTTPException(400, "kind sadece 'chapter', 'part' ya da 'subtitle' olabilir")
    if db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id, models.Chapter.number == payload.number).first():
        raise HTTPException(400, "Bu numarada bir bölüm/başlık zaten var")
    chapter = models.Chapter(novel_id=novel_id, number=payload.number, title=payload.title, kind=payload.kind)
    db.add(chapter)
    db.commit()
    db.refresh(chapter)
    return chapter


@router.get("/stats", response_model=schemas.WordCountStats)
def word_count_stats(db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    """Toplam ve bölüm başına kelime sayısı. Başlık/alt başlık girdileri
    (kind != 'chapter') paragrafsız olduğu için doğal olarak 0 kelime
    katkısı yapar - ayrıca filtrelemeye gerek yok."""
    chapters = db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id).order_by(models.Chapter.number).all()
    per_chapter = []
    total = 0
    for c in chapters:
        count = sum(len(p.text.split()) for p in c.paragraphs)
        total += count
        per_chapter.append(schemas.ChapterWordCount(chapter_number=c.number, title=c.title, word_count=count))
    return schemas.WordCountStats(total_words=total, chapters=per_chapter)


@router.get("/paragraph/{paragraph_id}", response_model=dict)
def find_paragraph_by_global_id(
    paragraph_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    """Paragrafın kendi veritabanı id'si zaten roman genelinde benzersiz ve
    kalıcı - bunu 'P{id}' şeklinde bir global paragraf numarası olarak
    kullanıyoruz (okuyucuda her paragrafın başında görünür). Bu uç nokta,
    'P2367' gibi bir referans verildiğinde hangi bölümde/kaçıncı paragrafta
    olduğunu bulup okuyucuyu doğrudan oraya götürmek için kullanılır."""
    paragraph = (
        db.query(models.Paragraph)
        .join(models.Chapter, models.Paragraph.chapter_id == models.Chapter.id)
        .filter(models.Paragraph.id == paragraph_id, models.Chapter.novel_id == novel_id)
        .first()
    )
    if not paragraph:
        raise HTTPException(404, f"P{paragraph_id} bulunamadı")
    return {
        "paragraph_id": paragraph.id,
        "chapter_id": paragraph.chapter_id,
        "chapter_number": paragraph.chapter.number,
        "chapter_title": paragraph.chapter.title,
        "paragraph_number": paragraph.number,
        "text": paragraph.text,
    }


@router.get("/search", response_model=List[dict])
def search(
    q: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    """'Ahmet' yazınca ya da bir karakter/mekan/olay id'si vererek, o varlığın
    geçtiği tüm (bölüm, paragraf) konumlarını bulur - solda arama kutusunun
    ve karakter kartındaki 'geçtiği paragraflar' listesinin temeli budur.

    ÖNEMLİ - bu route /{chapter_id} route'larından ÖNCE tanımlı olmak
    ZORUNDA: FastAPI/Starlette route'ları kayıt sırasına göre eşleştirir ve
    /{chapter_id} deseni tip kontrolünden ÖNCE herhangi bir string'i
    (ör. "search") yakalar - bu route sonra tanımlanmış olsaydı hiçbir
    zaman çalışmazdı (chapter_id="search" int'e çevrilemediği için 422
    dönerdi). Aynı sebeple /stats de yukarıda, /{chapter_id}'den önce.

    ÖNEMLİ (2): q ile arama SADECE Mention tablosuna (yani menülerde
    KAYITLI varlık isimlerine) bağlı değildir - aşağıda ayrıca TÜM
    paragrafların ham metni üzerinde de arama yapılır (entity_type="metin"
    olarak işaretlenir). Böylece menüde hiç kaydı olmayan herhangi bir
    kelime/ifade de bulunabilir; mentions sistemi sadece "bu isim hangi
    varlığa ait" bilgisini ekler, arama kapsamını SINIRLAMAZ.

    ÖNEMLİ (3): tüm sonuçlar aktif romana (novel_id) göre filtrelenir -
    hem mention hem serbest metin taraması SADECE bu romanın bölümlerine
    bakar, başka romanların içeriği asla sızmaz.

    Not: hem entity_name hem paragraf metni veritabanında şifreli tutulduğu
    için arama SQL ILIKE yerine kayıtlar çekilip ORM şeffaf şekilde şifreyi
    çözdükten sonra Python tarafında yapılır. Kişisel bir roman ölçeğinde bu
    fark edilmez."""

    results = []

    if entity_type and entity_id:
        rows = (
            db.query(models.Mention)
            .join(models.Paragraph, models.Mention.paragraph_id == models.Paragraph.id)
            .join(models.Chapter, models.Paragraph.chapter_id == models.Chapter.id)
            .filter(models.Mention.entity_type == entity_type, models.Mention.entity_id == entity_id, models.Chapter.novel_id == novel_id)
            .order_by(models.Mention.id)
            .all()
        )
        for m in rows:
            para = m.paragraph
            results.append({
                "entity_type": m.entity_type,
                "entity_name": m.entity_name,
                "chapter_number": para.chapter.number,
                "paragraph_number": para.number,
                "paragraph_id": para.id,
                "text_preview": para.text[:200],
            })
        return results

    if not q:
        raise HTTPException(400, "q ya da entity_type+entity_id parametrelerinden biri gerekli")

    q_lower = q.lower()

    # 1) Kayıtlı varlık isimleriyle eşleşen mention'lar (ör. "Ahmet" -> KİŞİ)
    mention_rows = (
        db.query(models.Mention)
        .join(models.Paragraph, models.Mention.paragraph_id == models.Paragraph.id)
        .join(models.Chapter, models.Paragraph.chapter_id == models.Chapter.id)
        .filter(models.Chapter.novel_id == novel_id)
        .order_by(models.Mention.id)
        .all()
    )
    seen_paragraph_entity = set()
    for m in mention_rows:
        if q_lower not in m.entity_name.lower():
            continue
        para = m.paragraph
        key = (para.id, m.entity_type, m.entity_id)
        if key in seen_paragraph_entity:
            continue
        seen_paragraph_entity.add(key)
        results.append({
            "entity_type": m.entity_type,
            "entity_name": m.entity_name,
            "chapter_number": para.chapter.number,
            "paragraph_number": para.number,
            "paragraph_id": para.id,
            "text_preview": para.text[:200],
        })

    # 2) SERBEST METİN araması: menüde hiç kaydı olmasa bile, arananın
    # geçtiği HER paragraf bulunur - bu sayede aramanın kapsamı sadece
    # "isim" listesiyle sınırlı kalmaz. Zaten yukarıda entity eşleşmesi
    # olarak listelenmiş bir paragraf burada TEKRAR gösterilmez.
    already_flagged_paragraphs = {pid for (pid, _, _) in seen_paragraph_entity}
    all_paragraphs = (
        db.query(models.Paragraph)
        .join(models.Chapter, models.Paragraph.chapter_id == models.Chapter.id)
        .filter(models.Chapter.novel_id == novel_id)
        .order_by(models.Paragraph.id)
        .all()
    )
    for para in all_paragraphs:
        if para.id in already_flagged_paragraphs:
            continue
        if q_lower not in para.text.lower():
            continue
        results.append({
            "entity_type": "metin",
            "entity_name": None,
            "chapter_number": para.chapter.number,
            "paragraph_number": para.number,
            "paragraph_id": para.id,
            "text_preview": para.text[:200],
        })

    return results


@router.post("/{chapter_id}/ai-split-paragraphs", response_model=schemas.AiSplitParagraphsResponse)
def ai_split_paragraphs(
    chapter_id: int, payload: schemas.AiSplitParagraphsRequest, db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=10, window_seconds=60, label="AI paragraf bölme")),
    novel_id: int = Depends(get_novel_id),
):
    """Paragraf araları net olmayan (boş satırla ayrılmamış) büyük bir
    metni AI ile mantıklı paragraflara böler ve DOĞRUDAN kaydeder - burada
    onay adımı yok çünkü metnin kendisi zaten kullanıcının kendi yazdığı/
    yapıştırdığı metin, AI sadece nereye paragraf arası koyacağına karar
    veriyor (tek kelime değiştirmiyor).

    mode='append': mevcut paragrafların ardına, sıradaki numaralardan
    devam ederek ekler. mode='replace': bölümün TÜM mevcut paragraflarının
    yerine geçer (eskiler silinir - geri alınamaz, dikkatli kullan)."""
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    if not payload.text.strip():
        raise HTTPException(400, "Bölünecek metin boş olamaz")
    if payload.mode not in ("append", "replace"):
        raise HTTPException(400, "mode 'append' ya da 'replace' olmalı")

    try:
        split_texts = split_paragraphs_with_ai(payload.text)
    except Exception as exc:
        logger.exception("AI paragraf bölme başarısız oldu")
        raise HTTPException(
            status_code=502,
            detail=f"Qwen API'ye ulaşılamadı: {exc}. DASHSCOPE_API_KEY doğru mu ve internet bağlantısı var mı kontrol et.",
        )
    if not split_texts:
        raise HTTPException(502, "AI hiçbir paragraf üretmedi, tekrar dener misin?")

    if payload.mode == "replace":
        for p in list(chapter.paragraphs):
            db.delete(p)
        db.commit()
        start_number = 1
    else:
        start_number = (max((p.number for p in chapter.paragraphs), default=0)) + 1

    created = []
    for offset, text in enumerate(split_texts):
        paragraph = models.Paragraph(chapter_id=chapter.id, number=start_number + offset, text=text)
        db.add(paragraph)
        db.commit()
        db.refresh(paragraph)
        detect_and_save_mentions(db, paragraph)
        db.refresh(paragraph)
        created.append(paragraph)

    return schemas.AiSplitParagraphsResponse(paragraph_count=len(created), paragraphs=created)


@router.post("/{chapter_id}/generate-summary", response_model=schemas.ChapterSummaryGenerateResponse)
def generate_chapter_summary(
    chapter_id: int, db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=15, window_seconds=60, label="bölüm özeti")),
    novel_id: int = Depends(get_novel_id),
):
    """Bölümün paragraflarından Qwen ile bir özet taslağı üretir. DOĞRUDAN
    kaydedilmez - kullanıcı beğenirse mevcut PUT /chapters/{chapter_id}
    (summary alanıyla) kaydeder. Kaydedilen özet, fihrist katmanı üzerinden
    tüm diğer AI isteklerine (assist, full-scan) otomatik olarak yansır."""
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    if not chapter.paragraphs:
        raise HTTPException(400, "Bu bölümde henüz özetlenecek paragraf yok")

    try:
        generated = summarize_chapter(db, chapter)
    except Exception as exc:
        logger.exception("Bölüm özeti üretimi başarısız oldu")
        raise HTTPException(
            status_code=502,
            detail=f"Qwen API'ye ulaşılamadı: {exc}. DASHSCOPE_API_KEY doğru mu ve internet bağlantısı var mı kontrol et.",
        )
    return schemas.ChapterSummaryGenerateResponse(chapter_id=chapter.id, generated_summary=generated)


def resolve_chapters_for_part(db: Session, novel_id: int, part_id: int) -> list:
    """Fihristteki bir Kısım'ın (kind='part') altına düşen TÜM gerçek
    bölümleri (kind='chapter') bulur - aradaki Alt Başlıklar (subtitle)
    şeffaftır, onların altındaki bölümler de bu Kısım'a ait sayılır.
    Frontend'deki buildChapterHierarchy ile BİREBİR aynı mantık - fihrist
    görünümünde hangi bölümler bir Kısım'ın altında görünüyorsa, toplu
    tarama da tam onları kapsar."""
    entries = db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id).order_by(models.Chapter.number).all()
    result = []
    current_part_id = None
    for e in entries:
        if e.kind == "part":
            current_part_id = e.id
        elif e.kind == "chapter" and current_part_id == part_id:
            result.append(e)
    return result


@router.post("/suggest-entities-bulk", response_model=List[schemas.AiSuggestion])
def suggest_entities_bulk(
    payload: schemas.BulkSuggestRequest, db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=10, window_seconds=60, label="toplu varlık önerisi")),
    novel_id: int = Depends(get_novel_id),
):
    """suggest-entities'in TOPLU hali - bir Kısım'ın (part_id) TAMAMINI ya
    da elle seçilmiş bir bölüm grubunu (chapter_ids) TEK bir taramada
    işler, aynı isim birden fazla bölümde geçse bile öneride sadece bir
    kez görünür. Fihristteki 'Kısım' seviyesiyle senkron çalışır - bir
    Kısım'ı yeni bitirdiğinde tek tek her bölümü taramak yerine Kısım'ın
    tamamını bir kerede tarayabilirsin."""
    chapters = _resolve_bulk_chapters(db, novel_id, payload)
    if not chapters:
        return []
    try:
        return suggest_entities_for_chapters(db, chapters)
    except Exception as exc:
        logger.exception("Toplu varlık önerisi üretimi başarısız oldu")
        raise HTTPException(
            status_code=502,
            detail=f"Qwen API'ye ulaşılamadı: {exc}. DASHSCOPE_API_KEY doğru mu ve internet bağlantısı var mı kontrol et.",
        )


@router.post("/suggest-progressions-bulk", response_model=List[schemas.ProgressionSuggestion])
def suggest_progressions_bulk(
    payload: schemas.BulkSuggestRequest, db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=10, window_seconds=60, label="toplu gelişim önerisi")),
    novel_id: int = Depends(get_novel_id),
):
    """suggest-progressions'ın TOPLU hali - bkz. suggest_entities_bulk
    docstring'i, aynı mantık gelişim çizelgesi notları için."""
    chapters = _resolve_bulk_chapters(db, novel_id, payload)
    if not chapters:
        return []
    try:
        return suggest_progressions_for_chapters(db, chapters)
    except Exception as exc:
        logger.exception("Toplu gelişim önerisi üretimi başarısız oldu")
        raise HTTPException(
            status_code=502,
            detail=f"Qwen API'ye ulaşılamadı: {exc}. DASHSCOPE_API_KEY doğru mu ve internet bağlantısı var mı kontrol et.",
        )


def _resolve_bulk_chapters(db: Session, novel_id: int, payload: schemas.BulkSuggestRequest) -> list:
    if payload.part_id is not None:
        part = db.query(models.Chapter).filter(
            models.Chapter.id == payload.part_id, models.Chapter.novel_id == novel_id, models.Chapter.kind == "part"
        ).first()
        if not part:
            raise HTTPException(404, "Kısım bulunamadı")
        chapters = resolve_chapters_for_part(db, novel_id, part.id)
    elif payload.chapter_ids:
        chapters = db.query(models.Chapter).filter(
            models.Chapter.id.in_(payload.chapter_ids), models.Chapter.novel_id == novel_id, models.Chapter.kind == "chapter"
        ).all()
    else:
        raise HTTPException(400, "part_id ya da chapter_ids parametrelerinden biri gerekli")
    return [c for c in chapters if c.paragraphs]



def suggest_chapter_entities(
    chapter_id: int, db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=10, window_seconds=60, label="varlık önerisi")),
    novel_id: int = Depends(get_novel_id),
):
    """Hazır yazılmış/içe aktarılmış bir bölümü tarayıp henüz menülerde
    kayıtlı olmayan karakter/mekan/olay/nesne/ipucu/terim adayları önerir.
    HİÇBİR ŞEY doğrudan kaydedilmez - dönen liste, /ai/assist'teki
    new_entity_suggestions ile AYNI formatta olduğu için mevcut
    /ai/approve-suggestions ile onaylanıp kaydedilir."""
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    if not chapter.paragraphs:
        raise HTTPException(400, "Bu bölümde henüz taranacak paragraf yok")

    try:
        suggestions = suggest_entities_for_chapter(db, chapter)
    except Exception as exc:
        logger.exception("Varlık önerisi üretimi başarısız oldu")
        raise HTTPException(
            status_code=502,
            detail=f"Qwen API'ye ulaşılamadı: {exc}. DASHSCOPE_API_KEY doğru mu ve internet bağlantısı var mı kontrol et.",
        )
    return suggestions


@router.post("/{chapter_id}/suggest-progressions", response_model=List[schemas.ProgressionSuggestion])
def suggest_chapter_progressions(
    chapter_id: int, db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=10, window_seconds=60, label="gelişim önerisi")),
    novel_id: int = Depends(get_novel_id),
):
    """Bu bölümde geçen kişi/mekan/olay/nesne/ipucu kayıtları hakkında
    öğrenilen YENİ ya da DEĞİŞEN bilgiyi tespit edip Gelişim Çizelgesi
    (Progressions) taslağı olarak önerir - romanın kronolojik 'haritasını'
    otomatik oluşturan mekanizma budur. HİÇBİR ŞEY doğrudan kaydedilmez;
    kullanıcı onayladığı öneriler mevcut POST /progressions/ ile kaydedilir."""
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    if not chapter.paragraphs:
        raise HTTPException(400, "Bu bölümde henüz taranacak paragraf yok")

    try:
        suggestions = suggest_progressions_for_chapter(db, chapter)
    except Exception as exc:
        logger.exception("Gelişim önerisi üretimi başarısız oldu")
        raise HTTPException(
            status_code=502,
            detail=f"Qwen API'ye ulaşılamadı: {exc}. DASHSCOPE_API_KEY doğru mu ve internet bağlantısı var mı kontrol et.",
        )
    return suggestions


@router.post("/{chapter_id}/suggest-relationships", response_model=List[schemas.RelationshipSuggestion])
def suggest_chapter_relationships(
    chapter_id: int, db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=10, window_seconds=60, label="ilişki önerisi")),
    novel_id: int = Depends(get_novel_id),
):
    """Bu bölümde ortaya çıkan, henüz İlişki Haritası'nda kayıtlı olmayan
    YENİ karakter ilişkilerini önerir. HİÇBİR ŞEY doğrudan kaydedilmez;
    kullanıcı onayladığı öneriler mevcut POST /relationships/ ile kaydedilir."""
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    if not chapter.paragraphs:
        raise HTTPException(400, "Bu bölümde henüz taranacak paragraf yok")
    try:
        return suggest_relationships_for_chapter(db, chapter)
    except Exception as exc:
        logger.exception("İlişki önerisi üretimi başarısız oldu")
        raise HTTPException(
            status_code=502,
            detail=f"Qwen API'ye ulaşılamadı: {exc}. DASHSCOPE_API_KEY doğru mu ve internet bağlantısı var mı kontrol et.",
        )


@router.post("/{chapter_id}/suggest-events", response_model=List[schemas.EventSuggestion])
def suggest_chapter_events(
    chapter_id: int, db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=10, window_seconds=60, label="olay önerisi")),
    novel_id: int = Depends(get_novel_id),
):
    """Bu bölümde geçen, Olaylar/Zaman Çizelgesi'ne eklenmeye değer önemli
    olayları önerir (yer/karakter bağlantılarıyla birlikte, yapılandırılmış).
    HİÇBİR ŞEY doğrudan kaydedilmez; kullanıcı onayladığı öneriler mevcut
    POST /events/ ile kaydedilir."""
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    if not chapter.paragraphs:
        raise HTTPException(400, "Bu bölümde henüz taranacak paragraf yok")
    try:
        return suggest_events_for_chapter(db, chapter)
    except Exception as exc:
        logger.exception("Olay önerisi üretimi başarısız oldu")
        raise HTTPException(
            status_code=502,
            detail=f"Qwen API'ye ulaşılamadı: {exc}. DASHSCOPE_API_KEY doğru mu ve internet bağlantısı var mı kontrol et.",
        )


@router.post("/suggest-relationships-bulk", response_model=List[schemas.RelationshipSuggestion])
def suggest_relationships_bulk(
    payload: schemas.BulkSuggestRequest, db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=10, window_seconds=60, label="toplu ilişki önerisi")),
    novel_id: int = Depends(get_novel_id),
):
    """suggest-relationships'in TOPLU hali - bkz. suggest_entities_bulk
    docstring'i, aynı mantık karakter ilişkileri için."""
    chapters = _resolve_bulk_chapters(db, novel_id, payload)
    if not chapters:
        return []
    try:
        return suggest_relationships_for_chapters(db, chapters)
    except Exception as exc:
        logger.exception("Toplu ilişki önerisi üretimi başarısız oldu")
        raise HTTPException(
            status_code=502,
            detail=f"Qwen API'ye ulaşılamadı: {exc}. DASHSCOPE_API_KEY doğru mu ve internet bağlantısı var mı kontrol et.",
        )


@router.post("/suggest-events-bulk", response_model=List[schemas.EventSuggestion])
def suggest_events_bulk(
    payload: schemas.BulkSuggestRequest, db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=10, window_seconds=60, label="toplu olay önerisi")),
    novel_id: int = Depends(get_novel_id),
):
    """suggest-events'in TOPLU hali - bkz. suggest_entities_bulk docstring'i,
    aynı mantık olaylar/zaman çizelgesi için."""
    chapters = _resolve_bulk_chapters(db, novel_id, payload)
    if not chapters:
        return []
    try:
        return suggest_events_for_chapters(db, chapters)
    except Exception as exc:
        logger.exception("Toplu olay önerisi üretimi başarısız oldu")
        raise HTTPException(
            status_code=502,
            detail=f"Qwen API'ye ulaşılamadı: {exc}. DASHSCOPE_API_KEY doğru mu ve internet bağlantısı var mı kontrol et.",
        )


@router.get("/{chapter_id}", response_model=schemas.ChapterOut)
def get_chapter(chapter_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    return chapter


@router.put("/{chapter_id}", response_model=schemas.ChapterOut)
def update_chapter(chapter_id: int, payload: schemas.ChapterUpdate, db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    data = payload.model_dump(exclude_unset=True)
    if "kind" in data and data["kind"] not in ("chapter", "part", "subtitle"):
        raise HTTPException(400, "kind sadece 'chapter', 'part' ya da 'subtitle' olabilir")
    for field, value in data.items():
        setattr(chapter, field, value)
    db.commit()
    db.refresh(chapter)
    return chapter


@router.delete("/{chapter_id}", status_code=204)
def delete_chapter(chapter_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    db.delete(chapter)
    db.commit()
    return None


@router.put("/{chapter_id}/paragraphs/{number}", response_model=schemas.ParagraphOut)
def upsert_paragraph(
    chapter_id: int, number: int, payload: schemas.ParagraphCreate,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    """Paragrafı oluşturur ya da günceller, ardından o paragrafta geçen
    karakter/mekan/olay/nesne isimlerini otomatik tespit edip indeksler."""
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")

    paragraph = (
        db.query(models.Paragraph)
        .filter(models.Paragraph.chapter_id == chapter_id, models.Paragraph.number == number)
        .first()
    )
    if paragraph:
        # Var olan bir paragrafı düzenlemek HER ZAMAN serbest - kind='part'/
        # 'subtitle' altında yanlışlıkla oluşmuş eski paragraflar bile
        # (bkz. aşağıdaki YENİ paragraf kısıtı) düzeltilebilir/taşınabilir
        # olsun diye burada engel YOK.
        if paragraph.text != payload.text:
            db.add(models.ParagraphVersion(paragraph_id=paragraph.id, text=paragraph.text))
        paragraph.text = payload.text
    else:
        # YENİ bir paragraf sadece gerçek bir Bölüm'e eklenebilir - Kısım/
        # Alt Başlık sadece yapısal bir ayraç, içerik tutmamalı. Bu kontrol
        # olmadan (önceki halimiz) "Yeni Başlık (Kısım)" yanlışlıkla seçilip
        # metin yazılırsa, o içerik fihristten hiç erişilemez hale
        # geliyordu (Kısım satırları "ilk alt bölüme git" davranışına
        # sahip, kendi paragrafını göstermiyordu).
        if chapter.kind != "chapter":
            kind_label = "Kısım" if chapter.kind == "part" else "Alt Başlık"
            raise HTTPException(
                400,
                f"Bu bir {kind_label} - sadece yapısal bir ayraç, paragraf tutamaz. "
                f"Metin yazmak için önce '+ Yeni' > 'Yeni Bölüm' ile gerçek bir bölüm oluştur.",
            )
        paragraph = models.Paragraph(chapter_id=chapter_id, number=number, text=payload.text)
        db.add(paragraph)
    db.commit()
    db.refresh(paragraph)

    detect_and_save_mentions(db, paragraph)
    db.refresh(paragraph)
    return paragraph


@router.get("/{chapter_id}/paragraphs/{number}/history", response_model=List[schemas.ParagraphVersionOut])
def paragraph_history(
    chapter_id: int, number: int,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    """Bu paragrafın önceki (üzerine yazılmış) hallerini en yeniden en
    eskiye doğru listeler."""
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    paragraph = (
        db.query(models.Paragraph)
        .filter(models.Paragraph.chapter_id == chapter_id, models.Paragraph.number == number)
        .first()
    )
    if not paragraph:
        raise HTTPException(404, "Paragraf bulunamadı")
    return paragraph.versions


@router.post("/{chapter_id}/paragraphs/{number}/restore/{version_id}", response_model=schemas.ParagraphOut)
def restore_paragraph_version(
    chapter_id: int, number: int, version_id: int,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    """Paragrafı geçmişteki bir versiyona geri döndürür. Şu anki hal de
    kaybolmasın diye önce mevcut metin geçmişe kaydedilir."""
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    paragraph = (
        db.query(models.Paragraph)
        .filter(models.Paragraph.chapter_id == chapter_id, models.Paragraph.number == number)
        .first()
    )
    if not paragraph:
        raise HTTPException(404, "Paragraf bulunamadı")
    version = db.query(models.ParagraphVersion).filter(
        models.ParagraphVersion.id == version_id, models.ParagraphVersion.paragraph_id == paragraph.id
    ).first()
    if not version:
        raise HTTPException(404, "Versiyon bulunamadı")

    db.add(models.ParagraphVersion(paragraph_id=paragraph.id, text=paragraph.text))
    paragraph.text = version.text
    db.commit()
    db.refresh(paragraph)
    detect_and_save_mentions(db, paragraph)
    db.refresh(paragraph)
    return paragraph


@router.delete("/{chapter_id}/paragraphs/{number}", status_code=204)
def delete_paragraph(
    chapter_id: int, number: int,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    paragraph = (
        db.query(models.Paragraph)
        .filter(models.Paragraph.chapter_id == chapter_id, models.Paragraph.number == number)
        .first()
    )
    if not paragraph:
        raise HTTPException(404, "Paragraf bulunamadı")
    db.delete(paragraph)
    db.commit()
    return None


@router.post("/{chapter_id}/paragraphs/{number}/toggle-style-sample", response_model=schemas.ParagraphOut)
def toggle_style_sample(
    chapter_id: int, number: int,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    """Bu paragrafı 'yazarın kendi üslup örneği' olarak işaretler/işareti
    kaldırır. İşaretli paragraflar her AI isteğinde otomatik olarak stil
    referansı olarak Qwen'e gönderilir (bkz. qwen_client.build_style_layer)."""
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    paragraph = (
        db.query(models.Paragraph)
        .filter(models.Paragraph.chapter_id == chapter_id, models.Paragraph.number == number)
        .first()
    )
    if not paragraph:
        raise HTTPException(404, "Paragraf bulunamadı")
    paragraph.is_style_sample = not paragraph.is_style_sample
    db.commit()
    db.refresh(paragraph)
    return paragraph


@router.post("/import")
async def import_manuscript(
    file: UploadFile = File(...),
    ai_split_long_chapters: bool = False,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    """Elinde zaten yazılmış bir metni (.txt) yükle - 'Bölüm N' başlıklarına
    göre otomatik bölüm/paragraf oluşturur ve o an menülerde kayıtlı
    karakter/mekan/olay/nesne isimlerini paragraflarda arar. Aynı numaralı
    bölüm/paragraf zaten varsa üzerine yazılır (idempotent import).

    ai_split_long_chapters=true verilirse: boş satırla paragraflara
    ayrılamamış (tek blok hâlinde gelen, 600+ karakterlik) bölümler için
    basit boş-satır ayracı yerine AI ile anlamlı paragraf bölme kullanılır
    (bkz. qwen_client.split_paragraphs_with_ai). Daha yavaştır (her böyle
    bölüm için bir Qwen isteği gerekir) ama düzensiz yapıştırılmış/OCR'lı
    metinlerde çok daha iyi sonuç verir."""
    raw = (await file.read()).decode("utf-8", errors="replace")
    parsed = parse_manuscript(raw)

    imported = []
    for chap in parsed:
        chapter = db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id, models.Chapter.number == chap["number"]).first()
        if chapter:
            if chap["title"]:
                chapter.title = chap["title"]
        else:
            chapter = models.Chapter(novel_id=novel_id, number=chap["number"], title=chap["title"])
            db.add(chapter)
        db.commit()
        db.refresh(chapter)

        paragraphs = split_paragraphs(chap["text"])
        if ai_split_long_chapters and len(paragraphs) <= 1 and len(chap["text"]) > 600:
            try:
                paragraphs = split_paragraphs_with_ai(chap["text"])
            except Exception:
                logger.exception(f"Bölüm {chap['number']} için AI bölme başarısız oldu, boş-satır ayracına geri dönülüyor")
                # AI başarısız olursa sessizce eski (blank-line) sonuca devam et - import'u durdurma

        for idx, text in enumerate(paragraphs, start=1):
            paragraph = (
                db.query(models.Paragraph)
                .filter(models.Paragraph.chapter_id == chapter.id, models.Paragraph.number == idx)
                .first()
            )
            if paragraph:
                paragraph.text = text
            else:
                paragraph = models.Paragraph(chapter_id=chapter.id, number=idx, text=text)
                db.add(paragraph)
            db.commit()
            db.refresh(paragraph)
            detect_and_save_mentions(db, paragraph)

        imported.append({"chapter_id": chapter.id, "chapter_number": chapter.number, "title": chapter.title, "paragraph_count": len(paragraphs)})

    return {"imported_chapters": imported}


@router.post("/reindex-mentions")
def reindex_mentions(db: Session = Depends(get_db), _user=Depends(get_current_user), novel_id: int = Depends(get_novel_id)):
    """Yeni bir karakter/mekan/olay eklediğinde ya da bir menü kaydının
    ismini değiştirdiğinde, roman boyunca geçmişe dönük olarak tüm
    paragrafları yeniden tarayıp mentions indeksini günceller."""
    paragraphs = (
        db.query(models.Paragraph)
        .join(models.Chapter, models.Paragraph.chapter_id == models.Chapter.id)
        .filter(models.Chapter.novel_id == novel_id)
        .all()
    )
    for p in paragraphs:
        detect_and_save_mentions(db, p)
    return {"reindexed_paragraphs": len(paragraphs)}
