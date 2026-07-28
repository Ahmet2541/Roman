#!/bin/bash
# .env dosyasını .env.example'dan oluşturur ve JWT_SECRET_KEY ile
# DB_ENCRYPTION_KEY'i kendi makinende, taze ve rastgele üretir - bu değerler
# hiçbir yere (sohbet geçmişi, log vb.) yazılmaz, doğrudan .env'e gider.
#
# Kullanım: ./init_env.sh

set -e
cd "$(dirname "$0")"

if [ -f .env ]; then
  echo ".env zaten var, üzerine yazmıyorum. Silip tekrar çalıştırabilirsin."
  exit 1
fi

cp .env.example .env

JWT_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
DB_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")

# macOS'ta sed -i farklı çalışır, bu yüzden uyumlu bir gecici dosya yöntemi kullanıyoruz
python3 - "$JWT_KEY" "$DB_KEY" << 'PYEOF'
import sys
jwt_key, db_key = sys.argv[1], sys.argv[2]
with open(".env") as f:
    content = f.read()
content = content.replace("JWT_SECRET_KEY=change-this-to-a-random-secret", f"JWT_SECRET_KEY={jwt_key}")
content = content.replace("DB_ENCRYPTION_KEY=", f"DB_ENCRYPTION_KEY={db_key}")
with open(".env", "w") as f:
    f.write(content)
PYEOF

echo "✅ .env oluşturuldu. JWT_SECRET_KEY ve DB_ENCRYPTION_KEY otomatik üretildi."
echo ""
echo "Hâlâ elle doldurman gerekenler:"
echo "  - DASHSCOPE_API_KEY   (kendi DashScope hesabından)"
echo "  - ADMIN_PASSWORD      (kendi belirleyeceğin güçlü bir şifre)"
echo ""
echo "DB_ENCRYPTION_KEY'i ayrıca güvenli bir yerde (parola yöneticisi gibi) yedekle -"
echo ".env dosyası kaybolursa roman verilerin kurtarılamaz olur."
