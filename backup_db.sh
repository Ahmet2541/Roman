#!/bin/bash
# Roman veritabanının zaman damgalı bir yedeğini alır.
# Kullanım: ./backup_db.sh
# Düzenli otomatik yedek için (ör. her gece) crontab'a ekleyebilirsin:
#   0 3 * * * cd /yol/roman-api && ./backup_db.sh

set -e
cd "$(dirname "$0")"

DB_FILE="roman.db"
BACKUP_DIR="backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

if [ ! -f "$DB_FILE" ]; then
  echo "Hata: $DB_FILE bulunamadı. Bu betiği proje kök dizininde çalıştır."
  exit 1
fi

mkdir -p "$BACKUP_DIR"
cp "$DB_FILE" "$BACKUP_DIR/roman_${TIMESTAMP}.db"
echo "Yedek alındı: $BACKUP_DIR/roman_${TIMESTAMP}.db"

# 30 günden eski yedekleri temizle
find "$BACKUP_DIR" -name "roman_*.db" -mtime +30 -delete
