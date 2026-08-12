"""Uygulama açılışında çalışan HAFİF, idempotent bir şema göçü.

Bu proje daha önce TEK roman varsayımıyla yazılmıştı. Artık birden fazla
roman desteklendiği için her içerik tablosuna bir novel_id sütunu eklendi
(bkz. models.py). Ama Railway'de ZATEN VERİSİ OLAN bir Postgres veritabanı
var - Base.metadata.create_all() sadece EKSİK TABLOLARI oluşturur, var olan
bir tabloya yeni sütun EKLEMEZ. Bu yüzden burada:

1. Eksikse novel_id/kind sütunlarını ALTER TABLE ile ekliyoruz.
2. Eğer hiç roman kaydı yoksa ama içerik varsa (eski tek-roman verisi),
   otomatik bir "Roman 1" oluşturup TÜM eski satırları ona bağlıyoruz -
   böylece mevcut roman kaybolmaz, sadece "Roman 1" adıyla listede belirir.
3. chapters tablosundaki eski (sadece 'number' üzerinde) unique kısıtını
   kaldırıp yerine (novel_id, number) kısıtını koyuyoruz - yoksa ikinci
   romanda "Bölüm 1" oluşturmak eski kısıtla çakışırdı.

Her adım try/except ile korunuyor ve zaten uygulanmışsa sessizce atlanıyor
- bu script her başlangıçta çalışsa da ikinci ve sonraki çalıştırmalarda
  hiçbir şey yapmaz (idempotent)."""
import logging

from sqlalchemy import inspect, text

logger = logging.getLogger("roman_api.migrations")

_NOVEL_ID_TABLES = [
    "characters", "character_relationships", "places", "events", "objects",
    "foreshadowings", "glossary_terms", "rules", "chapters", "progressions",
]


def run_startup_migrations(engine):
    try:
        _add_missing_columns(engine)
        _add_sections_columns(engine)
        _add_universe_columns(engine)
        _backfill_default_novel(engine)
        _backfill_universes(engine)
        _fix_chapter_unique_constraint(engine)
        _merge_legacy_sections(engine)
        _upgrade_matrix_tables(engine)
        _add_style_refrain_column(engine)
        _add_rule_scope_columns(engine)
        _add_matrix_row_instructions(engine)
        _add_event_occurred_at(engine)
        _create_knowledge_facts(engine)
    except Exception:
        logger.exception("Şema göçü sırasında beklenmeyen bir hata oluştu - uygulama yine de başlatılıyor")


def _add_missing_columns(engine):
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table in _NOVEL_ID_TABLES:
            if table not in existing_tables:
                continue  # create_all zaten oluşturmuştur, sütun da yeni gelir
            columns = {c["name"] for c in inspector.get_columns(table)}
            if "novel_id" not in columns:
                logger.info(f"Göç: {table}.novel_id ekleniyor")
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN novel_id INTEGER"))

        if "chapters" in existing_tables:
            columns = {c["name"] for c in inspector.get_columns("chapters")}
            if "kind" not in columns:
                logger.info("Göç: chapters.kind ekleniyor")
                conn.execute(text(
                    "ALTER TABLE chapters ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'chapter'"
                ))


def _add_sections_columns(engine):
    """Karakter/Mekan'a sonradan eklenen 'sections' (bölüm bazlı derin
    profil - bkz. app/sections.py) sütunu. EncryptedJSON altta Text olarak
    saklandığı için sütun tipi diğer şifreli alanlarla aynı (TEXT)."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table in ("characters", "places", "objects"):
            if table not in existing_tables:
                continue  # create_all zaten oluşturmuştur, sütun da yeni gelir
            columns = {c["name"] for c in inspector.get_columns(table)}
            if "sections" not in columns:
                logger.info(f"Göç: {table}.sections ekleniyor")
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN sections TEXT"))


# Universe (evren/seri) katmanı: bu tablolar artık novel_id DEĞİL,
# universe_id ile scope ediliyor - bir serinin tüm kitapları aynı
# karakter/mekan/kural/... havuzunu paylaşsın diye (bkz. models.py
# Universe/Novel yorumu).
_UNIVERSE_ID_TABLES = [
    "characters", "character_relationships", "places", "events", "objects",
    "foreshadowings", "glossary_terms", "rules", "progressions",
]


def _add_universe_columns(engine):
    """universe_id (+ book_number, aliases, tags, source_novel_id gibi
    evren katmanıyla birlikte gelen yeni sütunlar) ekler. factions /
    faction_memberships tamamen YENİ tablolar olduğu için burada değil,
    create_all() tarafından otomatik oluşturulur - onlar için ayrı bir
    ALTER TABLE adımına gerek yok."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        if "novels" in existing_tables:
            columns = {c["name"] for c in inspector.get_columns("novels")}
            if "universe_id" not in columns:
                logger.info("Göç: novels.universe_id ekleniyor")
                conn.execute(text("ALTER TABLE novels ADD COLUMN universe_id INTEGER"))
            if "book_number" not in columns:
                logger.info("Göç: novels.book_number ekleniyor")
                conn.execute(text("ALTER TABLE novels ADD COLUMN book_number INTEGER"))

        for table in _UNIVERSE_ID_TABLES:
            if table not in existing_tables:
                continue
            columns = {c["name"] for c in inspector.get_columns(table)}
            if "universe_id" not in columns:
                logger.info(f"Göç: {table}.universe_id ekleniyor")
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN universe_id INTEGER"))

        for table in ("characters", "places", "objects"):
            if table not in existing_tables:
                continue
            columns = {c["name"] for c in inspector.get_columns(table)}
            if "aliases" not in columns:
                logger.info(f"Göç: {table}.aliases ekleniyor")
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN aliases TEXT"))

        if "rules" in existing_tables:
            columns = {c["name"] for c in inspector.get_columns("rules")}
            if "tags" not in columns:
                logger.info("Göç: rules.tags ekleniyor")
                conn.execute(text("ALTER TABLE rules ADD COLUMN tags TEXT"))

        for table in ("events", "progressions"):
            if table not in existing_tables:
                continue
            columns = {c["name"] for c in inspector.get_columns(table)}
            if "source_novel_id" not in columns:
                logger.info(f"Göç: {table}.source_novel_id ekleniyor")
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN source_novel_id INTEGER"))

        if "places" in existing_tables:
            columns = {c["name"] for c in inspector.get_columns("places")}
            if "parent_place_id" not in columns:
                logger.info("Göç: places.parent_place_id ekleniyor")
                conn.execute(text("ALTER TABLE places ADD COLUMN parent_place_id INTEGER"))


def _backfill_universes(engine):
    """Her Roman (Novel) için, henüz bir evreni yoksa YENİ bir Universe
    oluşturup bağlar - eski veriler kaybolmaz, her roman kendi (aynı adı
    taşıyan) evreninde devam eder. Sonra karakterler/mekanlar/kurallar/...
    tablolarının universe_id'sini, o satırların ESKİ novel_id sütunundan
    (varsa) novels.universe_id'ye bakarak doldurur.

    ÖNEMLİ SINIR: Bu migration iki farklı Roman'ı OTOMATİK olarak aynı
    evrende birleştirmez - her biri ayrı evren olarak kalır. Aynı serinin
    farklı kitaplarını sonradan aynı evrende toplamak istersen, bunu
    /universes ve /novels uçlarından ELLE yapman gerekir (novel'in
    universe_id'sini güncelleyerek) - veriyi kaybetmeden bunu otomatik
    tahmin etmenin güvenli bir yolu yok."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    if "novels" not in existing_tables or "universes" not in existing_tables:
        return  # create_all henüz çalışmamış olabilir - bir sonraki başlangıçta halledilir

    novel_columns = {c["name"] for c in inspector.get_columns("novels")}
    if "universe_id" not in novel_columns:
        return  # _add_universe_columns henüz çalışmadı

    with engine.begin() as conn:
        novels_needing_universe = conn.execute(
            text("SELECT id, name FROM novels WHERE universe_id IS NULL")
        ).fetchall()

        for novel_id, encrypted_name in novels_needing_universe:
            # Universe.name de EncryptedString - romanın zaten şifreli olan
            # adını AYNEN kopyalıyoruz (aynı Fernet anahtarıyla şifreli
            # olduğu için tekrar şifrelemeye gerek yok, ORM okurken zaten
            # doğru çözecek).
            result = conn.execute(
                text("INSERT INTO universes (name, created_at) VALUES (:name, NOW()) RETURNING id")
                if engine.dialect.name == "postgresql"
                else text("INSERT INTO universes (name, created_at) VALUES (:name, CURRENT_TIMESTAMP)"),
                {"name": encrypted_name},
            )
            if engine.dialect.name == "postgresql":
                new_universe_id = result.first()[0]
            else:
                new_universe_id = conn.execute(text("SELECT last_insert_rowid()")).first()[0]

            conn.execute(
                text("UPDATE novels SET universe_id = :uid WHERE id = :nid"),
                {"uid": new_universe_id, "nid": novel_id},
            )
            logger.info(f"Göç: Roman id={novel_id} için yeni Universe id={new_universe_id} oluşturuldu")

        for table in _UNIVERSE_ID_TABLES:
            if table not in existing_tables:
                continue
            columns = {c["name"] for c in inspector.get_columns(table)}
            if "novel_id" not in columns or "universe_id" not in columns:
                continue  # eski novel_id sütunu hiç yoktu (yepyeni kurulum) - dolduracak bir şey yok
            conn.execute(text(f"""
                UPDATE {table}
                SET universe_id = (SELECT universe_id FROM novels WHERE novels.id = {table}.novel_id)
                WHERE universe_id IS NULL AND novel_id IS NOT NULL
            """))
            logger.info(f"Göç: {table}.universe_id, eski novel_id üzerinden dolduruldu")


def _backfill_default_novel(engine):
    inspector = inspect(engine)
    if "novels" not in inspector.get_table_names():
        return  # create_all henüz çalışmamış olabilir - bir sonraki başlangıçta halledilir

    with engine.begin() as conn:
        existing_novel = conn.execute(text("SELECT id FROM novels ORDER BY id LIMIT 1")).first()

        # Eski (novel_id'siz) veri var mı diye bak
        has_orphan_data = False
        for table in _NOVEL_ID_TABLES:
            if table not in inspector.get_table_names():
                continue
            row = conn.execute(text(f"SELECT id FROM {table} WHERE novel_id IS NULL LIMIT 1")).first()
            if row:
                has_orphan_data = True
                break

        if not has_orphan_data:
            return

        if existing_novel:
            default_novel_id = existing_novel[0]
        else:
            logger.info("Göç: eski tek-roman verisi için 'Roman 1' oluşturuluyor")
            # name sütunu şifreli (EncryptedString) tutuluyor - ORM dışında
            # ham SQL ile şifrelenmemiş yazarsak uygulama bunu okuyamaz.
            # Bu yüzden burada Fernet ile aynı şekilde şifreliyoruz.
            from .encryption import get_fernet
            encrypted_name = get_fernet().encrypt("Roman 1".encode()).decode()
            result = conn.execute(
                text("INSERT INTO novels (name, created_at) VALUES (:name, NOW()) RETURNING id")
                if engine.dialect.name == "postgresql"
                else text("INSERT INTO novels (name, created_at) VALUES (:name, CURRENT_TIMESTAMP)"),
                {"name": encrypted_name},
            )
            if engine.dialect.name == "postgresql":
                default_novel_id = result.first()[0]
            else:
                default_novel_id = conn.execute(text("SELECT last_insert_rowid()")).first()[0]

        for table in _NOVEL_ID_TABLES:
            if table not in inspector.get_table_names():
                continue
            conn.execute(
                text(f"UPDATE {table} SET novel_id = :nid WHERE novel_id IS NULL"),
                {"nid": default_novel_id},
            )
        logger.info(f"Göç: eski veriler novel_id={default_novel_id} olarak etiketlendi")


def _fix_chapter_unique_constraint(engine):
    inspector = inspect(engine)
    if "chapters" not in inspector.get_table_names():
        return

    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            constraints = inspector.get_unique_constraints("chapters")
            for c in constraints:
                if c["column_names"] == ["number"]:
                    logger.info(f"Göç: eski chapters unique kısıtı kaldırılıyor ({c['name']})")
                    conn.execute(text(f'ALTER TABLE chapters DROP CONSTRAINT "{c["name"]}"'))

            has_new_constraint = any(
                set(c["column_names"]) == {"novel_id", "number"} for c in inspector.get_unique_constraints("chapters")
            )
            if not has_new_constraint:
                logger.info("Göç: yeni (novel_id, number) unique kısıtı ekleniyor")
                conn.execute(text(
                    "ALTER TABLE chapters ADD CONSTRAINT uq_novel_chapter_number UNIQUE (novel_id, number)"
                ))
        return

    # SQLite: UNIQUE kısıtı doğrudan DROP edilemez (autoindex'e bağlı) -
    # tek yol tabloyu yeniden oluşturmak. Sadece eski (sadece 'number'
    # üzerinde) bir unique index varsa bu maliyetli işlemi yap.
    with engine.begin() as conn:
        unique_indexes = inspector.get_unique_constraints("chapters") + [
            {"column_names": idx["column_names"]} for idx in inspector.get_indexes("chapters") if idx.get("unique")
        ]
        needs_rebuild = any(set(u["column_names"]) == {"number"} for u in unique_indexes)
        if not needs_rebuild:
            return

        logger.info("Göç (SQLite): chapters tablosu (novel_id, number) kısıtıyla yeniden oluşturuluyor")
        conn.execute(text("""
            CREATE TABLE chapters_migrated (
                id INTEGER PRIMARY KEY,
                novel_id INTEGER,
                number INTEGER NOT NULL,
                kind VARCHAR(20) NOT NULL DEFAULT 'chapter',
                title TEXT,
                summary TEXT,
                created_at TIMESTAMP,
                updated_at TIMESTAMP,
                UNIQUE (novel_id, number)
            )
        """))
        conn.execute(text(
            "INSERT INTO chapters_migrated (id, novel_id, number, kind, title, summary, created_at, updated_at) "
            "SELECT id, novel_id, number, kind, title, summary, created_at, updated_at FROM chapters"
        ))
        conn.execute(text("DROP TABLE chapters"))
        conn.execute(text("ALTER TABLE chapters_migrated RENAME TO chapters"))


def _merge_legacy_sections(engine):
    """Derin profil 7 başlıktan 6'ya indirildi (bkz. app/sections.py):
    Kişilerde "kariyer" -> "gecmis" içine, Mekanlarda "zamansal_degisim" ->
    "atmosfer" içine katlandı. Eski anahtarlarla kaydedilmiş veri varsa
    (şifreli JSON olduğu için SQL ile değil, ORM üzerinden) içeriği yeni
    başlığın SONUNA etiketle ekler ve eski anahtarı siler - hiçbir metin
    kaybolmaz. İdempotent: eski anahtar kalmayınca hiçbir şey yapmaz.

    NOT: Yeni bir dict ATANIR (in-place mutasyon değil) - SQLAlchemy'nin
    özel EncryptedJSON tipi in-place değişikliği fark etmeyebilir."""
    from sqlalchemy.orm import sessionmaker
    from . import models

    MERGES = {
        models.Character: [("kariyer", "gecmis", "Kariyer")],
        models.Place: [("zamansal_degisim", "atmosfer", "Zamansal değişim")],
    }
    Session = sessionmaker(bind=engine)
    with Session() as db:
        moved = 0
        for model, merges in MERGES.items():
            for record in db.query(model).all():
                sections = dict(record.sections or {})
                changed = False
                for old_key, new_key, label in merges:
                    old_val = (sections.get(old_key) or "").strip()
                    if not old_val and old_key not in sections:
                        continue
                    if old_val:
                        existing = (sections.get(new_key) or "").strip()
                        sections[new_key] = f"{existing}\n\n[{label}] {old_val}".strip() if existing else old_val
                    sections.pop(old_key, None)
                    changed = True
                if changed:
                    record.sections = sections
                    moved += 1
        if moved:
            db.commit()
            logger.info("Göç: %s kayıtta eski derin profil başlıkları yeni yapıya taşındı", moved)


def _upgrade_matrix_tables(engine):
    """Plan Matrisi'ne sonradan eklenen sütunlar: matrix_rows.kind (ana/ara
    başlık) ve matrix_cells.code (MP1, MP2... sabit referans kodu). Kod
    olmayan eski hücrelere roman bazında sıralı kod atanır - idempotent."""
    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    with engine.begin() as conn:
        if "matrix_rows" in existing:
            cols = {c["name"] for c in inspector.get_columns("matrix_rows")}
            if "kind" not in cols:
                logger.info("Göç: matrix_rows.kind ekleniyor")
                conn.execute(text("ALTER TABLE matrix_rows ADD COLUMN kind VARCHAR(10) DEFAULT 'main'"))
                conn.execute(text("UPDATE matrix_rows SET kind = 'main' WHERE kind IS NULL"))
        if "matrix_cells" in existing:
            cols = {c["name"] for c in inspector.get_columns("matrix_cells")}
            if "code" not in cols:
                logger.info("Göç: matrix_cells.code ekleniyor")
                conn.execute(text("ALTER TABLE matrix_cells ADD COLUMN code VARCHAR(20)"))
    # Kod geri doldurma (ORM ile - roman bazında sayaç)
    from sqlalchemy.orm import sessionmaker
    from . import models
    Session = sessionmaker(bind=engine)
    with Session() as db:
        codeless = db.query(models.MatrixCell).filter(models.MatrixCell.code == None).all()  # noqa: E711
        if not codeless:
            return
        for cell in codeless:
            matrix = db.query(models.PlanMatrix).filter(models.PlanMatrix.id == cell.matrix_id).first()
            if matrix:
                cell.code = _next_matrix_code(db, matrix.novel_id)
        db.commit()
        logger.info("Göç: %s matris hücresine referans kodu atandı", len(codeless))


def _next_matrix_code(db, novel_id):
    """Roman genelinde bir sonraki MP kodu. routers/matrix.py da kullanır -
    tek kaynak burada dursun."""
    import re as _re
    from . import models
    max_n = 0
    rows = (
        db.query(models.MatrixCell.code)
        .join(models.PlanMatrix, models.MatrixCell.matrix_id == models.PlanMatrix.id)
        .filter(models.PlanMatrix.novel_id == novel_id, models.MatrixCell.code != None)  # noqa: E711
        .all()
    )
    for (code,) in rows:
        m = _re.fullmatch(r"MP(\d+)", code or "")
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"MP{max_n + 1}"


def _add_style_refrain_column(engine):
    """style_patterns.is_refrain (nakarat koruması) - idempotent."""
    inspector = inspect(engine)
    if "style_patterns" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("style_patterns")}
    if "is_refrain" not in cols:
        with engine.begin() as conn:
            logger.info("Göç: style_patterns.is_refrain ekleniyor")
            conn.execute(text("ALTER TABLE style_patterns ADD COLUMN is_refrain BOOLEAN DEFAULT 0"))


def _add_rule_scope_columns(engine):
    """rules.entity_type + rules.entity_id (kayda özel kural kapsamı)."""
    inspector = inspect(engine)
    if "rules" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("rules")}
    with engine.begin() as conn:
        if "entity_type" not in cols:
            logger.info("Göç: rules.entity_type ekleniyor")
            conn.execute(text("ALTER TABLE rules ADD COLUMN entity_type VARCHAR(20)"))
        if "entity_id" not in cols:
            logger.info("Göç: rules.entity_id ekleniyor")
            conn.execute(text("ALTER TABLE rules ADD COLUMN entity_id INTEGER"))


def _add_matrix_row_instructions(engine):
    """matrix_rows.instructions (Talimat Kasası) - idempotent."""
    inspector = inspect(engine)
    if "matrix_rows" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("matrix_rows")}
    if "instructions" not in cols:
        with engine.begin() as conn:
            logger.info("Göç: matrix_rows.instructions ekleniyor")
            conn.execute(text("ALTER TABLE matrix_rows ADD COLUMN instructions TEXT"))


def _add_event_occurred_at(engine):
    """events.occurred_at (sıralanabilir gerçekleşme zamanı) - idempotent."""
    inspector = inspect(engine)
    if "events" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("events")}
    if "occurred_at" not in cols:
        with engine.begin() as conn:
            logger.info("Göç: events.occurred_at ekleniyor")
            conn.execute(text("ALTER TABLE events ADD COLUMN occurred_at TEXT"))


def _create_knowledge_facts(engine):
    """knowledge_facts tablosu (Bilgi/İfşa Haritası) - idempotent."""
    inspector = inspect(engine)
    if "knowledge_facts" not in inspector.get_table_names():
        logger.info("Göç: knowledge_facts tablosu oluşturuluyor")
        models.KnowledgeFact.__table__.create(bind=engine, checkfirst=True)
