"""Şema göçü testleri - Railway'deki gerçek eski veritabanını simüle eden
bir SQLite dosyası üzerinde çalışır (conftest'teki paylaşılan test DB'sini
DEĞİL, kendi izole geçici dosyasını kullanır - eski şema simülasyonu
paylaşılan DB'yi bozmasın diye)."""
import tempfile
from pathlib import Path

from sqlalchemy import create_engine, text, inspect

from app.encryption import get_fernet
from app import models  # noqa: F401 - import edilmezse Base.metadata modelleri tanımıyor, create_all boş tablo listesiyle çalışır


def _make_old_schema_db(db_path: Path):
    """universe_id/aliases/tags/source_novel_id/parent_place_id OLMADAN,
    sadece eski novel_id sütunlu bir şema kurar - gerçek Railway
    veritabanının göç öncesi hali budur."""
    engine = create_engine(f"sqlite:///{db_path}")
    enc = lambda s: get_fernet().encrypt(s.encode()).decode()

    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE novels (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMP)"))
        conn.execute(text("""
            CREATE TABLE characters (
                id INTEGER PRIMARY KEY, novel_id INTEGER, name TEXT NOT NULL,
                description TEXT, notes TEXT, status VARCHAR(30), sections TEXT,
                created_at TIMESTAMP, updated_at TIMESTAMP
            )
        """))
        conn.execute(text("""
            CREATE TABLE places (
                id INTEGER PRIMARY KEY, novel_id INTEGER, name TEXT NOT NULL,
                description TEXT, notes TEXT, sections TEXT, created_at TIMESTAMP, updated_at TIMESTAMP
            )
        """))
        conn.execute(text("""
            CREATE TABLE rules (
                id INTEGER PRIMARY KEY, novel_id INTEGER, title TEXT NOT NULL,
                description TEXT, created_at TIMESTAMP, updated_at TIMESTAMP
            )
        """))
        conn.execute(text("""
            CREATE TABLE chapters (
                id INTEGER PRIMARY KEY, novel_id INTEGER, number INTEGER NOT NULL,
                kind VARCHAR(20) NOT NULL DEFAULT 'chapter', title TEXT, summary TEXT,
                created_at TIMESTAMP, updated_at TIMESTAMP, UNIQUE(number)
            )
        """))
        conn.execute(text("INSERT INTO novels (id, name, created_at) VALUES (1, :n, CURRENT_TIMESTAMP)"), {"n": enc("Kitap 1")})
        conn.execute(text("INSERT INTO novels (id, name, created_at) VALUES (2, :n, CURRENT_TIMESTAMP)"), {"n": enc("Kitap 2")})
        conn.execute(text("INSERT INTO characters (id, novel_id, name, status) VALUES (1, 1, :n, 'aktif')"), {"n": enc("Ahmet")})
        conn.execute(text("INSERT INTO characters (id, novel_id, name, status) VALUES (2, 2, :n, 'aktif')"), {"n": enc("Zeynep")})
        conn.execute(text("INSERT INTO places (id, novel_id, name) VALUES (1, 1, :n)"), {"n": enc("Liman")})
    return engine


def test_migration_creates_one_universe_per_novel_and_backfills_universe_id():
    from app.migrations import run_startup_migrations
    from app.database import Base

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "old.db"
        engine = _make_old_schema_db(db_path)

        Base.metadata.create_all(bind=engine)  # eksik tabloları (universes, factions...) oluşturur
        run_startup_migrations(engine)

        with engine.begin() as conn:
            novels = conn.execute(text("SELECT id, universe_id FROM novels ORDER BY id")).fetchall()
            universes = conn.execute(text("SELECT id FROM universes")).fetchall()
            chars = conn.execute(text("SELECT id, universe_id FROM characters ORDER BY id")).fetchall()
            places = conn.execute(text("SELECT id, universe_id FROM places")).fetchall()

        assert len(universes) == 2, "Her roman kendi evrenine sahip olmalı"
        novel_to_universe = {n[0]: n[1] for n in novels}
        assert novel_to_universe[1] != novel_to_universe[2], "İki farklı roman aynı evrene düşmemeli"
        assert chars[0][1] == novel_to_universe[1]
        assert chars[1][1] == novel_to_universe[2]
        assert places[0][1] == novel_to_universe[1]


def test_migration_is_idempotent_across_repeated_runs():
    from app.migrations import run_startup_migrations
    from app.database import Base

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "old.db"
        engine = _make_old_schema_db(db_path)
        Base.metadata.create_all(bind=engine)

        run_startup_migrations(engine)
        run_startup_migrations(engine)
        run_startup_migrations(engine)

        with engine.begin() as conn:
            universe_count = conn.execute(text("SELECT COUNT(*) FROM universes")).scalar()
        assert universe_count == 2, "3 kez çalıştırmak yeni evren ÜRETMEMELİ (idempotent olmalı)"


def test_migration_backfills_null_to_empty_dict_or_list_not_none():
    """Migration sonrası eski satırlarda sections/aliases NULL kalır -
    ORM üzerinden okunduğunda None değil {}/[] dönmeli (bkz. test_encryption.py)."""
    from app.migrations import run_startup_migrations
    from app.database import Base
    from sqlalchemy.orm import sessionmaker
    from app import models

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "old.db"
        engine = _make_old_schema_db(db_path)
        Base.metadata.create_all(bind=engine)
        run_startup_migrations(engine)

        Session = sessionmaker(bind=engine)
        db = Session()
        ahmet = db.query(models.Character).filter(models.Character.id == 1).first()
        assert ahmet.aliases == []
        assert ahmet.sections == {}


def test_new_install_has_no_orphan_data_to_migrate():
    """Sıfırdan (eski novel_id sütunu hiç olmayan) bir kurulumda migration
    hiçbir şey bozmadan, hatasız sessizce geçmeli."""
    from app.migrations import run_startup_migrations
    from app.database import Base

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "fresh.db"
        engine = create_engine(f"sqlite:///{db_path}")
        Base.metadata.create_all(bind=engine)
        run_startup_migrations(engine)  # exception atmamalı

        with engine.begin() as conn:
            universe_count = conn.execute(text("SELECT COUNT(*) FROM universes")).scalar()
        assert universe_count == 0
