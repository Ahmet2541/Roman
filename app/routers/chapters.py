from typing import List, Optional
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from .. import models, schemas
from ..mentions import detect_and_save_mentions
from ..entities import ENTITY_MODELS
from ..import_parser import parse_manuscript, split_paragraphs
from ..qwen_client import summarize_chapter, suggest_entities_for_chapter
from ..ratelimit import rate_limit

router = APIRouter(prefix="/chapters", tags=["Bölümler"])
logger = logging.getLogger("roman_api.chapters")


@router.get("/", response_model=List[schemas.ChapterListOut])
def list_chapters(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    return db.query(models.Chapter).order_by(models.Chapter.number).all()


@router.post("/", response_model=schemas.ChapterOut, status_code=201)
def create_chapter(payload: schemas.ChapterCreate, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    if db.query(models.Chapter).filter(models.Chapter.number == payload.number).first():
        raise HTTPException(400, "Bu numarada bir bölüm zaten var")
    chapter = models.Chapter(number=payload.number, title=payload.title)
    db.add(chapter)
    db.commit()
    db.refresh(chapter)
    return chapter


@router.get("/stats", response_model=schemas.WordCountStats)
def word_count_stats(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    """Toplam ve bölüm başına kelime sayısı."""
    chapters = db.query(models.Chapter).order_by(models.Chapter.number).all()
    per_chapter = []
    total = 0
    for c in chapters:
        count = sum(len(p.text.split()) for p in c.paragraphs)
        total += count
        per_chapter.append(schemas.ChapterWordCount(chapter_number=c.number, title=c.title, word_count=count))
    return schemas.WordCountStats(total_words=total, chapters=per_chapter)


@router.get("/search", response_model=List[dict])
def search(
    q: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
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

    Not: hem entity_name hem paragraf metni veritabanında şifreli tutulduğu
    için arama SQL ILIKE yerine kayıtlar çekilip ORM şeffaf şekilde şifreyi
    çözdükten sonra Python tarafında yapılır. Kişisel bir roman ölçeğinde bu
    fark edilmez."""

    results = []

    if entity_type and entity_id:
        rows = (
            db.query(models.Mention)
            .filter(models.Mention.entity_type == entity_type, models.Mention.entity_id == entity_id)
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
    mention_rows = db.query(models.Mention).order_by(models.Mention.id).all()
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
    all_paragraphs = db.query(models.Paragraph).order_by(models.Paragraph.id).all()
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


@router.post("/{chapter_id}/generate-summary", response_model=schemas.ChapterSummaryGenerateResponse)
def generate_chapter_summary(
    chapter_id: int, db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=15, window_seconds=60, label="bölüm özeti")),
):
    """Bölümün paragraflarından Qwen ile bir özet taslağı üretir. DOĞRUDAN
    kaydedilmez - kullanıcı beğenirse mevcut PUT /chapters/{chapter_id}
    (summary alanıyla) kaydeder. Kaydedilen özet, fihrist katmanı üzerinden
    tüm diğer AI isteklerine (assist, full-scan) otomatik olarak yansır."""
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
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


@router.post("/{chapter_id}/suggest-entities", response_model=List[schemas.AiSuggestion])
def suggest_chapter_entities(
    chapter_id: int, db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=10, window_seconds=60, label="varlık önerisi")),
):
    """Hazır yazılmış/içe aktarılmış bir bölümü tarayıp henüz menülerde
    kayıtlı olmayan karakter/mekan/olay/nesne/ipucu/terim adayları önerir.
    HİÇBİR ŞEY doğrudan kaydedilmez - dönen liste, /ai/assist'teki
    new_entity_suggestions ile AYNI formatta olduğu için mevcut
    /ai/approve-suggestions ile onaylanıp kaydedilir."""
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
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


@router.get("/{chapter_id}", response_model=schemas.ChapterOut)
def get_chapter(chapter_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    return chapter


@router.put("/{chapter_id}", response_model=schemas.ChapterOut)
def update_chapter(chapter_id: int, payload: schemas.ChapterUpdate, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(chapter, field, value)
    db.commit()
    db.refresh(chapter)
    return chapter


@router.delete("/{chapter_id}", status_code=204)
def delete_chapter(chapter_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    db.delete(chapter)
    db.commit()
    return None


@router.put("/{chapter_id}/paragraphs/{number}", response_model=schemas.ParagraphOut)
def upsert_paragraph(
    chapter_id: int, number: int, payload: schemas.ParagraphCreate,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
):
    """Paragrafı oluşturur ya da günceller, ardından o paragrafta geçen
    karakter/mekan/olay/nesne isimlerini otomatik tespit edip indeksler."""
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")

    paragraph = (
        db.query(models.Paragraph)
        .filter(models.Paragraph.chapter_id == chapter_id, models.Paragraph.number == number)
        .first()
    )
    if paragraph:
        if paragraph.text != payload.text:
            db.add(models.ParagraphVersion(paragraph_id=paragraph.id, text=paragraph.text))
        paragraph.text = payload.text
    else:
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
):
    """Bu paragrafın önceki (üzerine yazılmış) hallerini en yeniden en
    eskiye doğru listeler."""
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
):
    """Paragrafı geçmişteki bir versiyona geri döndürür. Şu anki hal de
    kaybolmasın diye önce mevcut metin geçmişe kaydedilir."""
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
):
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
):
    """Bu paragrafı 'yazarın kendi üslup örneği' olarak işaretler/işareti
    kaldırır. İşaretli paragraflar her AI isteğinde otomatik olarak stil
    referansı olarak Qwen'e gönderilir (bkz. qwen_client.build_style_layer)."""
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
    db: Session = Depends(get_db), _user=Depends(get_current_user),
):
    """Elinde zaten yazılmış bir metni (.txt) yükle - 'Bölüm N' başlıklarına
    göre otomatik bölüm/paragraf oluşturur ve o an menülerde kayıtlı
    karakter/mekan/olay/nesne isimlerini paragraflarda arar. Aynı numaralı
    bölüm/paragraf zaten varsa üzerine yazılır (idempotent import)."""
    raw = (await file.read()).decode("utf-8", errors="replace")
    parsed = parse_manuscript(raw)

    imported = []
    for chap in parsed:
        chapter = db.query(models.Chapter).filter(models.Chapter.number == chap["number"]).first()
        if chapter:
            if chap["title"]:
                chapter.title = chap["title"]
        else:
            chapter = models.Chapter(number=chap["number"], title=chap["title"])
            db.add(chapter)
        db.commit()
        db.refresh(chapter)

        paragraphs = split_paragraphs(chap["text"])
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
def reindex_mentions(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    """Yeni bir karakter/mekan/olay eklediğinde ya da bir menü kaydının
    ismini değiştirdiğinde, roman boyunca geçmişe dönük olarak tüm
    paragrafları yeniden tarayıp mentions indeksini günceller."""
    paragraphs = db.query(models.Paragraph).all()
    for p in paragraphs:
        detect_and_save_mentions(db, p)
    return {"reindexed_paragraphs": len(paragraphs)}
