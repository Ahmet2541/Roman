"""Alan düzeyinde (field-level) şifreleme.

Roman metni, karakter/mekan/olay bilgileri gibi içerik alanları veritabanında
ŞİFRELİ tutulur. `.env`'deki DB_ENCRYPTION_KEY olmadan, veritabanı dosyasının
kendisi tek başına ele geçirilse bile hiçbir isim/metin okunamaz.

ÖNEMLİ SINIRLAMA - dürüstçe söylemek gerekirse:
Bu, "veritabanı DOSYASININ çalınması/sızması" senaryosuna karşı korur -
örneğin bir yedek dosyasının yanlışlıkla halka açık kalması, diskin
çalınması, ya da bir SQL injection ile ham veri dökümü alınması gibi.

Bunu KORUMAZ: sunucunun kendisi (uygulamanın çalıştığı makine/konteyner)
tamamen ele geçirilirse. Çünkü uygulamanın şifreyi çözebilmesi için
DB_ENCRYPTION_KEY'e ihtiyacı var ve o anahtar da sunucuda (.env'de) duruyor.
"Uygulama çalışıyorken her şey okunabilir olsun ama sadece DB dosyası tek
başına işe yaramasın" - istediğin şey tam olarak bu, ve bu modül tam olarak
bunu sağlıyor. Sunucunun kendisinin güvenliği için ayrıca: güçlü
JWT_SECRET_KEY, güncel bağımlılıklar, güvenlik duvarı, düzenli yedekleme."""

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

from .config import settings

_fernet = None


def get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        if not settings.db_encryption_key:
            raise RuntimeError(
                "DB_ENCRYPTION_KEY .env dosyasında tanımlı değil. Üretmek için:\n"
                '  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"\n'
                "çıkan değeri .env dosyasındaki DB_ENCRYPTION_KEY satırına yapıştır."
            )
        _fernet = Fernet(settings.db_encryption_key.encode("utf-8"))
    return _fernet


class EncryptedString(TypeDecorator):
    """Veritabanına yazılırken şifreler, okunurken şeffaf şekilde çözer.
    Uygulama kodu (models.py dışında) bunun farkına bile varmaz - ORM
    üzerinden her zaman düz metin görülür, DB dosyasında ise şifreli durur."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        token = get_fernet().encrypt(value.encode("utf-8"))
        return token.decode("utf-8")

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        try:
            return get_fernet().decrypt(value.encode("utf-8")).decode("utf-8")
        except InvalidToken:
            # Yanlış anahtar ya da şifrelenmeden önce yazılmış eski veri
            return "[ÇÖZÜLEMEDİ - DB_ENCRYPTION_KEY yanlış ya da değişmiş]"
