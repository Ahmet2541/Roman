from pydantic_settings import BaseSettings
from pydantic import field_validator


class Settings(BaseSettings):
    database_url: str = "sqlite:///./roman.db"

    dashscope_api_key: str = ""
    dashscope_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    qwen_model: str = "qwen-plus"
    # AI isteklerinde ZAMAN AŞIMI ve YENİDEN DENEME. Eskiden ikisi de yoktu:
    # ağ tıkandığında istek sonsuza kadar bekliyor, tarayıcı "Failed to
    # fetch" veriyor ve kullanıcı neyin olduğunu anlamıyordu. Uzun bölüm
    # analizleri için cömert bir sınır (180 sn) seçildi.
    qwen_timeout_seconds: float = 180.0
    qwen_max_retries: int = 2

    db_encryption_key: str = ""

    jwt_secret_key: str = "change-this-to-a-random-secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440

    admin_username: str = "admin"
    admin_password: str = "change-this-password"

    @field_validator("database_url")
    @classmethod
    def _normalize_db_url(cls, v: str) -> str:
        # Railway/Heroku gibi bazı platformlar DATABASE_URL'i "postgres://" ile
        # verir; SQLAlchemy 2.x ise "postgresql://" bekler. Burada otomatik çeviriyoruz.
        if v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql://", 1)
        return v

    class Config:
        env_file = ".env"


settings = Settings()
