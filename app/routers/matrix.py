"""Plan Matrisi uçları.

Excel benzeri eşleştirme tablosu: kolonlar = kişiler/turlar, satırlar =
aşamalar, hücreler = o kesişimin madde madde planı. İki kritik özellik:

1. Hücre <-> Bölüm bağı: chapter_id dolu bir hücrenin içeriği, o bölüm
   yazılırken AI context'ine "BÖLÜM PLANI" olarak otomatik girer
   (bkz. qwen_client.build_plan_layer).
2. /generate-chapters: matristen fihristi tek seferde üretir - her kolon
   bir KISIM (part), her kolon×satır bir BÖLÜM olur ve hücreler otomatik
   bağlanır. 8×7'lik bir matris tek tıkla 8 kısım + 56 bölüm demektir.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from .. import models, schemas
from ..novel_context import get_novel_id
from ..migrations import _next_matrix_code
from ..ratelimit import rate_limit
from .. import qwen_client

router = APIRouter(prefix="/matrix", tags=["Plan Matrisi"])


def _get_matrix(db: Session, matrix_id: int, novel_id: int) -> models.PlanMatrix:
    m = (
        db.query(models.PlanMatrix)
        .filter(models.PlanMatrix.id == matrix_id, models.PlanMatrix.novel_id == novel_id)
        .first()
    )
    if not m:
        raise HTTPException(404, "Matris bulunamadı")
    return m


def _cell_out(db: Session, cell: models.MatrixCell) -> schemas.MatrixCellOut:
    chapter_number = None
    if cell.chapter_id:
        ch = db.query(models.Chapter).filter(models.Chapter.id == cell.chapter_id).first()
        chapter_number = ch.number if ch else None
    return schemas.MatrixCellOut(
        id=cell.id, column_id=cell.column_id, row_id=cell.row_id,
        content=cell.content or "", chapter_id=cell.chapter_id,
        chapter_number=chapter_number, code=cell.code,
    )


def _matrix_out(db: Session, m: models.PlanMatrix) -> schemas.MatrixOut:
    return schemas.MatrixOut(
        id=m.id, name=m.name, created_at=m.created_at,
        columns=[schemas.MatrixColumnOut(id=c.id, position=c.position, label=c.label, character_id=c.character_id) for c in m.columns],
        rows=[schemas.MatrixRowOut(id=r.id, position=r.position, kind=r.kind or "main", label=r.label) for r in m.rows],
        cells=[_cell_out(db, c) for c in m.cells],
    )


@router.get("/", response_model=List[schemas.MatrixSummaryOut])
def list_matrices(
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    out = []
    for m in db.query(models.PlanMatrix).filter(models.PlanMatrix.novel_id == novel_id).all():
        out.append(schemas.MatrixSummaryOut(
            id=m.id, name=m.name, created_at=m.created_at,
            column_count=len(m.columns), row_count=len(m.rows),
            filled_cell_count=sum(1 for c in m.cells if (c.content or "").strip()),
        ))
    return out


@router.post("/", response_model=schemas.MatrixOut, status_code=201)
def create_matrix(
    payload: schemas.MatrixCreate,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    m = models.PlanMatrix(novel_id=novel_id, name=payload.name)
    db.add(m)
    db.flush()  # id lazım
    for i, col in enumerate(payload.columns, start=1):
        db.add(models.MatrixColumn(matrix_id=m.id, position=i, label=col.label, character_id=col.character_id))
    for i, row in enumerate(payload.rows, start=1):
        db.add(models.MatrixRow(matrix_id=m.id, position=i, label=row.label))
    db.commit()
    db.refresh(m)
    return _matrix_out(db, m)


@router.get("/{matrix_id}", response_model=schemas.MatrixOut)
def get_matrix(
    matrix_id: int,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    return _matrix_out(db, _get_matrix(db, matrix_id, novel_id))


@router.put("/{matrix_id}", response_model=schemas.MatrixOut)
def rename_matrix(
    matrix_id: int, payload: schemas.MatrixRename,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    m = _get_matrix(db, matrix_id, novel_id)
    m.name = payload.name
    db.commit()
    db.refresh(m)
    return _matrix_out(db, m)


@router.delete("/{matrix_id}", status_code=204)
def delete_matrix(
    matrix_id: int,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    """Matrisi siler - bağlı BÖLÜMLERE dokunmaz (onlar fihristin malı),
    sadece plan tablosu ve hücreleri gider."""
    db.delete(_get_matrix(db, matrix_id, novel_id))
    db.commit()


# ---- Kolon / Satır ----------------------------------------------------------

@router.post("/{matrix_id}/columns", response_model=schemas.MatrixColumnOut, status_code=201)
def add_column(
    matrix_id: int, payload: schemas.MatrixColumnCreate,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    m = _get_matrix(db, matrix_id, novel_id)
    if payload.character_id is not None:
        novel = db.query(models.Novel).filter(models.Novel.id == novel_id).first()
        char = db.query(models.Character).filter(
            models.Character.id == payload.character_id,
            models.Character.universe_id == novel.universe_id,
        ).first()
        if not char:
            raise HTTPException(404, "Karakter bulunamadı")
    if payload.after_column_id is not None:
        # ARAYA ekleme: hedef kolonun sağındaki her şeyi bir kaydır (satır
        # eklemeyle aynı desen).
        anchor = next((c for c in m.columns if c.id == payload.after_column_id), None)
        if anchor is None:
            raise HTTPException(404, "after_column_id bu matriste yok")
        for c in m.columns:
            if c.position > anchor.position:
                c.position += 1
        position = anchor.position + 1
    else:
        position = max((c.position for c in m.columns), default=0) + 1
    col = models.MatrixColumn(matrix_id=m.id, position=position, label=payload.label, character_id=payload.character_id)
    db.add(col)
    db.commit()
    db.refresh(col)
    return schemas.MatrixColumnOut(id=col.id, position=col.position, label=col.label, character_id=col.character_id)


@router.put("/{matrix_id}/columns/{column_id}", response_model=schemas.MatrixColumnOut)
def rename_column(
    matrix_id: int, column_id: int, payload: schemas.MatrixColumnCreate,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    _get_matrix(db, matrix_id, novel_id)
    col = db.query(models.MatrixColumn).filter(
        models.MatrixColumn.id == column_id, models.MatrixColumn.matrix_id == matrix_id
    ).first()
    if not col:
        raise HTTPException(404, "Kolon bulunamadı")
    col.label = payload.label
    col.character_id = payload.character_id
    db.commit()
    return schemas.MatrixColumnOut(id=col.id, position=col.position, label=col.label, character_id=col.character_id)


@router.delete("/{matrix_id}/columns/{column_id}", status_code=204)
def delete_column(
    matrix_id: int, column_id: int,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    _get_matrix(db, matrix_id, novel_id)
    col = db.query(models.MatrixColumn).filter(
        models.MatrixColumn.id == column_id, models.MatrixColumn.matrix_id == matrix_id
    ).first()
    if not col:
        raise HTTPException(404, "Kolon bulunamadı")
    db.query(models.MatrixCell).filter(models.MatrixCell.column_id == column_id).delete()
    db.delete(col)
    db.commit()


@router.post("/{matrix_id}/rows", response_model=schemas.MatrixRowOut, status_code=201)
def add_row(
    matrix_id: int, payload: schemas.MatrixRowCreate,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    m = _get_matrix(db, matrix_id, novel_id)
    if payload.after_row_id is not None:
        # ARAYA ekleme: hedef satırın altındaki her şeyi bir kaydır, boşluğa gir.
        anchor = next((r for r in m.rows if r.id == payload.after_row_id), None)
        if anchor is None:
            raise HTTPException(404, "after_row_id bu matriste yok")
        for r in m.rows:
            if r.position > anchor.position:
                r.position += 1
        position = anchor.position + 1
    else:
        position = max((r.position for r in m.rows), default=0) + 1
    row = models.MatrixRow(matrix_id=m.id, position=position, kind=payload.kind, label=payload.label)
    db.add(row)
    db.commit()
    db.refresh(row)
    return schemas.MatrixRowOut(id=row.id, position=row.position, kind=row.kind, label=row.label)


@router.put("/{matrix_id}/rows/{row_id}", response_model=schemas.MatrixRowOut)
def rename_row(
    matrix_id: int, row_id: int, payload: schemas.MatrixRowCreate,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    _get_matrix(db, matrix_id, novel_id)
    row = db.query(models.MatrixRow).filter(
        models.MatrixRow.id == row_id, models.MatrixRow.matrix_id == matrix_id
    ).first()
    if not row:
        raise HTTPException(404, "Satır bulunamadı")
    row.label = payload.label
    row.kind = payload.kind
    db.commit()
    return schemas.MatrixRowOut(id=row.id, position=row.position, kind=row.kind, label=row.label)


@router.delete("/{matrix_id}/rows/{row_id}", status_code=204)
def delete_row(
    matrix_id: int, row_id: int,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    _get_matrix(db, matrix_id, novel_id)
    row = db.query(models.MatrixRow).filter(
        models.MatrixRow.id == row_id, models.MatrixRow.matrix_id == matrix_id
    ).first()
    if not row:
        raise HTTPException(404, "Satır bulunamadı")
    db.query(models.MatrixCell).filter(models.MatrixCell.row_id == row_id).delete()
    db.delete(row)
    db.commit()


# ---- Hücre ------------------------------------------------------------------

@router.put("/{matrix_id}/cells", response_model=schemas.MatrixCellOut)
def upsert_cell(
    matrix_id: int, payload: schemas.MatrixCellUpsert,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    """Hücre yoksa oluşturur, varsa günceller (Excel'deki gibi: hücreye yaz,
    kaydet). chapter_id verilirse bölüm bu KİTABA ait olmalı."""
    m = _get_matrix(db, matrix_id, novel_id)
    if not any(c.id == payload.column_id for c in m.columns):
        raise HTTPException(404, "Kolon bu matriste yok")
    if not any(r.id == payload.row_id for r in m.rows):
        raise HTTPException(404, "Satır bu matriste yok")
    if payload.chapter_id is not None:
        ch = db.query(models.Chapter).filter(
            models.Chapter.id == payload.chapter_id, models.Chapter.novel_id == novel_id
        ).first()
        if not ch:
            raise HTTPException(404, "Bölüm bu romanda bulunamadı")

    cell = db.query(models.MatrixCell).filter(
        models.MatrixCell.column_id == payload.column_id,
        models.MatrixCell.row_id == payload.row_id,
    ).first()
    if cell:
        cell.content = payload.content
        cell.chapter_id = payload.chapter_id
    else:
        cell = models.MatrixCell(
            matrix_id=m.id, column_id=payload.column_id, row_id=payload.row_id,
            content=payload.content, chapter_id=payload.chapter_id,
            code=_next_matrix_code(db, novel_id),
        )
        db.add(cell)
    db.commit()
    db.refresh(cell)
    return _cell_out(db, cell)


# ---- Fihrist üretimi --------------------------------------------------------

@router.post("/{matrix_id}/generate-chapters", response_model=schemas.GenerateChaptersResponse)
def generate_chapters(
    matrix_id: int,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    """Matristen fihristi üretir: her kolon bir KISIM, her kolon×satır bir
    BÖLÜM. Bölümler mevcut fihristin SONUNA eklenir (var olan hiçbir şey
    kaydırılmaz/silinmez). Her hücre kendi bölümüne otomatik bağlanır -
    hücre yoksa boş içerikle oluşturulup bağlanır, böylece 56 bağın hiçbiri
    elle kurulmaz. Herhangi bir hücre ZATEN bir bölüme bağlıysa 400 döner -
    ikinci kez basmak fihristi çiftlememeli."""
    m = _get_matrix(db, matrix_id, novel_id)
    if not m.columns or not m.rows:
        raise HTTPException(400, "Önce en az bir kolon ve bir satır ekle")
    if any(c.chapter_id for c in m.cells):
        raise HTTPException(400, "Bu matrisin hücreleri zaten bölümlere bağlı - fihrist yeniden üretilmez. Yeni bağ için hücreyi tek tek düzenle.")

    existing_cells = {(c.column_id, c.row_id): c for c in m.cells}
    next_number = (
        db.query(models.Chapter)
        .filter(models.Chapter.novel_id == novel_id)
        .count()
    )
    max_number = db.query(models.Chapter.number).filter(models.Chapter.novel_id == novel_id).all()
    next_number = max((n[0] for n in max_number), default=0) + 1

    created_parts = created_chapters = linked = 0
    for col in m.columns:
        db.add(models.Chapter(novel_id=novel_id, number=next_number, kind="part", title=col.label))
        next_number += 1
        created_parts += 1
        for row in m.rows:
            ch = models.Chapter(novel_id=novel_id, number=next_number, kind="chapter", title=row.label)
            db.add(ch)
            db.flush()  # id lazım
            next_number += 1
            created_chapters += 1
            cell = existing_cells.get((col.id, row.id))
            if cell:
                cell.chapter_id = ch.id
                if not cell.code:
                    cell.code = _next_matrix_code(db, novel_id)
            else:
                db.add(models.MatrixCell(
                    matrix_id=m.id, column_id=col.id, row_id=row.id,
                    content="", chapter_id=ch.id, code=_next_matrix_code(db, novel_id),
                ))
                db.flush()  # sıradaki kod hesabı yeni kodu görsün
            linked += 1
    db.commit()
    return schemas.GenerateChaptersResponse(
        created_parts=created_parts, created_chapters=created_chapters, linked_cells=linked,
    )


# ---- AI ile boş hücreleri doldurma ------------------------------------------

@router.post("/{matrix_id}/ai-fill", response_model=schemas.MatrixAiFillResponse)
def ai_fill(
    matrix_id: int, payload: schemas.MatrixAiFillRequest,
    db: Session = Depends(get_db),
    _user=Depends(rate_limit(max_calls=3, window_seconds=300, label="matris doldurma")),
    novel_id: int = Depends(get_novel_id),
):
    """Seçili kolonların BOŞ hücreleri için AI taslakları üretir - dolu
    hücrelerdeki kalıbı izleyerek ("aynı iskelet, farklı rol"). Kolon
    başına BİR Qwen çağrısı yapılır (8 kolon seçersen 8 istek - rate limit
    bu yüzden sıkı). HİÇBİR ŞEY kaydedilmez: öneriler döner, onayladıkların
    normal hücre kaydıyla (PUT /cells) yazılır - böylece kod atama, bölüm
    bağı koruma gibi tüm mevcut kurallar aynen işler."""
    m = _get_matrix(db, matrix_id, novel_id)
    if not payload.column_ids:
        raise HTTPException(400, "En az bir kolon seç")
    cols_by_id = {c.id: c for c in m.columns}
    unknown = [cid for cid in payload.column_ids if cid not in cols_by_id]
    if unknown:
        raise HTTPException(404, f"Kolon(lar) bu matriste yok: {unknown}")

    filled = {}
    for cell in m.cells:
        if (cell.content or "").strip():
            filled[(cell.column_id, cell.row_id)] = True

    proposals, skipped = [], []
    for cid in payload.column_ids:
        column = cols_by_id[cid]
        empty_rows = [r for r in m.rows if (cid, r.id) not in filled]
        if not empty_rows:
            skipped.append(column.label)
            continue
        try:
            suggestions = qwen_client.suggest_matrix_cell_fills(db, m, column, empty_rows)
        except Exception as exc:
            raise HTTPException(502, f"Qwen API'ye ulaşılamadı: {exc}")
        rows_by_id = {r.id: r for r in m.rows}
        for sug in suggestions:
            row = rows_by_id[sug["row_id"]]
            proposals.append(schemas.MatrixAiFillProposal(
                column_id=cid, row_id=row.id,
                column_label=column.label, row_label=row.label,
                content=sug["content"],
            ))
    return schemas.MatrixAiFillResponse(proposals=proposals, skipped_columns=skipped)


@router.get("/plan-for-chapter/{chapter_id}", response_model=List[schemas.ChapterPlanCell])
def plan_for_chapter(
    chapter_id: int,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    """Bir bölüme bağlı plan hücreleri - Roman menüsündeki 'Bölüm Planı'
    kutusu için. AI'ya build_plan_layer ile giden içeriğin aynısı: yazar,
    yazarken planını görebilsin (dolu hücre yoksa boş liste)."""
    chapter = db.query(models.Chapter).filter(
        models.Chapter.id == chapter_id, models.Chapter.novel_id == novel_id
    ).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")
    cells = db.query(models.MatrixCell).filter(models.MatrixCell.chapter_id == chapter.id).all()
    out = []
    for cell in cells:
        if not (cell.content or "").strip():
            continue
        matrix = db.query(models.PlanMatrix).filter(models.PlanMatrix.id == cell.matrix_id).first()
        col = db.query(models.MatrixColumn).filter(models.MatrixColumn.id == cell.column_id).first()
        row = db.query(models.MatrixRow).filter(models.MatrixRow.id == cell.row_id).first()
        out.append(schemas.ChapterPlanCell(
            code=cell.code, matrix_name=matrix.name if matrix else "",
            column_label=col.label if col else "", row_label=row.label if row else "",
            content=cell.content,
        ))
    return out


QUICK_MATRIX_NAME = "Hızlı Planlar"


@router.post("/quick-plan", response_model=schemas.QuickPlanResponse)
def quick_plan(
    payload: schemas.QuickPlanRequest,
    db: Session = Depends(get_db), _user=Depends(get_current_user),
    novel_id: int = Depends(get_novel_id),
):
    """Matris ekranına hiç girmeden, bölümün İÇİNDEN plan yazma kestirmesi.
    Ayrı bir sistem DEĞİL: bölüme zaten bağlı bir hücre varsa onun içeriği
    güncellenir (hücre hangi matristeyse orada kalır); yoksa "Hızlı Planlar"
    adlı tek kolonlu bir matriste bölüme bir satır+hücre açılır. Her iki
    durumda da MP kodu, plan kutusu, "Plandan Taslak", context enjeksiyonu -
    tüm mevcut mekanizma aynen işler; hızlı plan sonradan matris ekranından
    da düzenlenebilir."""
    chapter = db.query(models.Chapter).filter(
        models.Chapter.id == payload.chapter_id, models.Chapter.novel_id == novel_id
    ).first()
    if not chapter:
        raise HTTPException(404, "Bölüm bulunamadı")

    linked = db.query(models.MatrixCell).filter(models.MatrixCell.chapter_id == chapter.id).all()
    if len(linked) > 1:
        raise HTTPException(409, "Bu bölüme birden fazla plan hücresi bağlı - hangisini düzenleyeceğini Plan Matrisi ekranından seç.")
    if linked:
        cell = linked[0]
        cell.content = payload.content
        db.commit()
        matrix = db.query(models.PlanMatrix).filter(models.PlanMatrix.id == cell.matrix_id).first()
        return schemas.QuickPlanResponse(code=cell.code, matrix_name=matrix.name if matrix else "", content=cell.content)

    # Hızlı matris + tek kolonu (yoksa oluştur - isim şifreli olduğundan
    # SQL ile filtrelenemez, Python'da aranır; roman başına birkaç matris
    # olacağı için maliyet önemsiz)
    matrix = next(
        (m for m in db.query(models.PlanMatrix).filter(models.PlanMatrix.novel_id == novel_id).all()
         if m.name == QUICK_MATRIX_NAME),
        None,
    )
    if matrix is None:
        matrix = models.PlanMatrix(novel_id=novel_id, name=QUICK_MATRIX_NAME)
        db.add(matrix)
        db.flush()
        db.add(models.MatrixColumn(matrix_id=matrix.id, position=1, label="Plan"))
        db.flush()
    column = matrix.columns[0]
    row_label = f"Bölüm {chapter.number}" + (f" — {chapter.title}" if chapter.title else "")
    position = max((r.position for r in matrix.rows), default=0) + 1
    row = models.MatrixRow(matrix_id=matrix.id, position=position, label=row_label)
    db.add(row)
    db.flush()
    cell = models.MatrixCell(
        matrix_id=matrix.id, column_id=column.id, row_id=row.id,
        content=payload.content, chapter_id=chapter.id,
        code=_next_matrix_code(db, novel_id),
    )
    db.add(cell)
    db.commit()
    return schemas.QuickPlanResponse(code=cell.code, matrix_name=matrix.name, content=cell.content)
