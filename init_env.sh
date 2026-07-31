#!/bin/bash
# .env dosyasını oluşturur ve JWT_SECRET_KEY + DB_ENCRYPTION_KEY'i bu
# makinede rastgele üretir (hiçbir yere gönderilmez/yazılmaz, sadece yerel
# .env dosyasına yazılır). Diğer alanları (DASHSCOPE_API_KEY, ADMIN_PASSWORD
# vb.) sen elle dolduracaksın - bkz. README.md "Kurulum" bölümü.
#
# Kullanım:
#   ./init_env.sh          -> .env yoksa oluşturur
#   ./init_env.sh --force   -> .env zaten varsa bile üzerine yazar (DİKKAT:
#                              DB_ENCRYPTION_KEY değişirse eski veritabanı
#                              okunamaz hale gelir - bkz. README "Şifreleme")

set -e
cd "$(dirname "$0")"

ENV_FILE=".env"
FORCE=0
if [ "$1" = "--force" ]; then
  FORCE=1
fi

if [ -f "$ENV_FILE" ] && [ "$FORCE" -ne 1 ]; then
  echo "Hata: $ENV_FILE zaten var, üzerine yazılmadı."
  echo "Bilerek yeniden oluşturmak istiyorsan: ./init_env.sh --force"
  echo "(DİKKAT: DB_ENCRYPTION_KEY'i değiştirmek, o ana kadar şifrelenmiş"
  echo " tüm veriyi okunamaz hale getirir.)"
  exit 1
fi

# Python3 gerekli (secrets + cryptography.Fernet için)
if ! command -v python3 >/dev/null 2>&1; then
  echo "Hata: python3 bulunamadı. Önce Python 3 kurmalısın."
  exit 1
fi

JWT_SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")

# DB_ENCRYPTION_KEY için 'cryptography' paketi gerekiyor. Henüz sanal ortam
# kurulup requirements.txt yüklenmediyse bu adım başarısız olabilir - bu
# durumda kullanıcıyı yönlendiriyoruz.
DB_ENCRYPTION_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>/dev/null) || {
  echo "Hata: DB_ENCRYPTION_KEY üretilemedi ('cryptography' paketi python3 için"
  echo "bulunamadı). Önce şunu çalıştır:"
  echo "  python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
  echo "sonra ./init_env.sh'i tekrar çalıştır."
  exit 1
}

# docker-compose.yml için rastgele bir Postgres şifresi de üretelim (SQLite
# kullanacaksan bu alanı görmezden gelebilirsin, zararı olmaz).
POSTGRES_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))")

cat > "$ENV_FILE" << ENVEOF
# Bu dosya ./init_env.sh tarafından otomatik oluşturuldu.
# JWT_SECRET_KEY ve DB_ENCRYPTION_KEY bu makinede rastgele üretildi ve
# hiçbir yere gönderilmedi - sadece burada duruyor. Aşağıdaki üç alanı
# ELLE doldurman gerekiyor: DASHSCOPE_API_KEY, ADMIN_USERNAME, ADMIN_PASSWORD.
#
# ÖNEMLİ: DB_ENCRYPTION_KEY'i bir kere üret, sonra hiç değiştirme -
# değiştirirsen o ana kadarki tüm veriler okunamaz hale gelir. Bu anahtarı
# ayrıca güvenli bir yerde de sakla (parola yöneticisi gibi) - bu dosya
# kaybolursa/silinirse veritabanındaki hiçbir şeyi geri okuyamazsın.

# ---- Veritabanı ----
# SQLite (varsayılan, tek makinede kurulum için yeterli):
DATABASE_URL=sqlite:///./roman.db
# PostgreSQL kullanacaksan (Docker Compose / Railway / VPS) yukarıdaki
# satırı yorum satırı yap ve aşağıdakini kendi bağlantı bilgilerinle
# doldur (Docker Compose zaten bunu docker-compose.yml üzerinden otomatik
# override ediyor, elle dokunmana gerek yok):
# DATABASE_URL=postgresql://roman:${POSTGRES_PASSWORD}@localhost:5432/roman

# docker-compose.yml bu değişkeni Postgres container'ının şifresi olarak kullanır.
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

# ---- Qwen (DashScope) ----
DASHSCOPE_API_KEY=
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus

# ---- Şifreleme (rastgele üretildi - DEĞİŞTİRME, bkz. yukarıdaki uyarı) ----
DB_ENCRYPTION_KEY=${DB_ENCRYPTION_KEY}

# ---- JWT (rastgele üretildi) ----
JWT_SECRET_KEY=${JWT_SECRET_KEY}
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440

# ---- İlk admin kullanıcı ----
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
ENVEOF

chmod 600 "$ENV_FILE"

echo "$ENV_FILE oluşturuldu (izinler 600 olarak ayarlandı)."
echo "Şimdi şunu aç ve elle doldur: DASHSCOPE_API_KEY, ADMIN_PASSWORD"
echo "  (ADMIN_USERNAME'i de değiştirebilirsin, 'admin' varsayılan olarak bırakıldı)"
