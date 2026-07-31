"""Test ortamı kurulumu.

ÖNEMLİ: app.config.settings ve app.database.engine, İLGİLİ MODÜL İLK
IMPORT EDİLDİĞİNDE (module-level) oluşturuluyor - yani ortam değişkenlerini
(DATABASE_URL, DB_ENCRYPTION_KEY vb.) `app` paketinin herhangi bir alt
modülü import edilmeden ÖNCE ayarlamamız gerekiyor. pytest conftest.py'yi
her zaman test dosyalarından ÖNCE import ettiği için, bu ayarı burada en
üstte (başka hiçbir 'app.*' import'undan önce) yapıyoruz."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

TEST_DB_PATH = Path(__file__).resolve().parent / "_test_roman.db"

os.environ.setdefault("DATABASE_URL", f"sqlite:///{TEST_DB_PATH}")
os.environ.setdefault("DASHSCOPE_API_KEY", "test-dummy-key")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-pytest")
os.environ.setdefault("ADMIN_USERNAME", "admin")
os.environ.setdefault("ADMIN_PASSWORD", "test12345")

if "DB_ENCRYPTION_KEY" not in os.environ:
    from cryptography.fernet import Fernet
    os.environ["DB_ENCRYPTION_KEY"] = Fernet.generate_key().decode()

import pytest  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _fresh_test_db():
    """Test paketi başlamadan önce eski test DB dosyasını temizler, bitince
    de siler - her `pytest` çalıştırması sıfırdan, önceki çalıştırmanın
    kalıntısından etkilenmeden başlar."""
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()
    yield
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


@pytest.fixture(scope="session")
def auth_headers(client):
    r = client.post("/auth/token", data={"username": "admin", "password": "test12345"})
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def novel(client, auth_headers):
    """Her test için YENİ bir Roman (dolayısıyla yeni bir Universe)
    oluşturur - testler aynı DB dosyasını paylaşsa da birbirinin verisine
    hiç karışmaz (her testin kendi izole evreni olur)."""
    r = client.post("/novels/", json={"name": "Test Roman"}, headers=auth_headers)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def headers(auth_headers, novel):
    """auth_headers + bu teste özel X-Novel-Id - çoğu test bunu kullanır."""
    h = dict(auth_headers)
    h["X-Novel-Id"] = str(novel["id"])
    return h
