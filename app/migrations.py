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
        _backfill_default_novel(engine)
        _fix_chapter_unique_constraint(engine)
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
