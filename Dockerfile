# Roman Yazım Asistanı API - üretim imajı
#
# Notlar:
# - psycopg2-binary çalışma zamanında libpq5'e ihtiyaç duyar, bu yüzden
#   runtime imajına ekleniyor (derleme başlıklarına gerek yok, "binary"
#   paket zaten derlenmiş halde geliyor).
# - Uygulama app/main.py içinde açılışta ./logs klasörünü kendisi oluşturuyor
#   (LOG_DIR.mkdir(exist_ok=True)) - burada ayrıca mkdir etmeye gerek yok,
#   ama container'ın bu dizine yazabilmesi için WORKDIR altında kalmalı.
# - Non-root kullanıcıyla çalıştırılıyor (güvenlik iyi pratiği).

FROM python:3.12-slim

# Python çıktısını buffer'lamadan logla (docker compose logs'ta anında görünsün)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# psycopg2-binary'nin çalışma zamanında ihtiyaç duyduğu paylaşılan kütüphane
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Önce sadece requirements.txt kopyalanıyor ki kod değiştiğinde
# (requirements değişmediği sürece) pip install adımı cache'ten gelsin.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Uygulama kodu
COPY app ./app
COPY frontend ./frontend
COPY alembic.ini .

# logs/ ve backups/ - docker-compose.yml bunları host'tan volume olarak
# bağlıyor (./logs:/app/logs, ./backups:/app/backups); burada da baştan
# oluşturulup non-root kullanıcıya devrediliyor ki volume mount olmadan
# (ör. Railway/Render gibi PaaS'larda) da uygulama açılışta patlamasın.
RUN mkdir -p logs backups \
    && useradd --create-home --shell /bin/bash appuser \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

# Railway/Render gibi platformlar $PORT env değişkeni verir; yerelde ve
# docker-compose'da bu tanımlı olmadığından 8000'e düşüyoruz.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
