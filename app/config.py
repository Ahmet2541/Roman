from pydantic_settings import BaseSettings
from pydantic import field_validator


class Settings(BaseSettings):
    database_url: str = "sqlite:///./roman.db"

    dashscope_api_key: str = ""
    # Standart DashScope pay-as-you-go endpoint. Coding Plan / Token Plan
    # gibi abonelik-özel endpoint'lerle KARIŞTIRMA - onlar farklı bir
    # anahtar formatı (sk-sp-xxxxx) ve farklı base_url ister, bu ikisi asla
    # birbirinin yerine kullanılamaz. Standart anahtar "sk-xxxxx" formatında
    # olur (dashscope_api_key buraya girer).
    dashscope_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    # qwen3.8-max: Ağustos 2026'da çıkan flagship (2.4T MoE, 1M context) -
    # önceki varsayılan qwen-plus'tan yükseltildi. Standart pay-as-you-go
    # ile uyumlu, plan-özel bir anahtar gerektirmiyor.
    qwen_model: str = "qwen3.8-max"
    # AI isteklerinde ZAMAN AŞIMI ve YENİDEN DENEME. Eskiden ikisi de yoktu:
    # ağ tıkandığında istek sonsuza kadar bekliyor, tarayıcı "Failed to
    # fetch" veriyor ve kullanıcı neyin olduğunu anlamıyordu. Uzun bölüm
    # analizleri için cömert bir sınır (180 sn) seçildi.
    qwen_timeout_seconds: float = 180.0
    qwen_max_retries: int = 2
    # YARATICI YAZIM parametreleri - SADECE ask_qwen (bölüm/sahne taslağı)
    # kullanır. Diğer Qwen çağrıları (denetim, özet, tutarlılık taraması
    # gibi ANALİZ görevleri) bunlardan etkilenmez - onlarda belirleyicilik
    # (düşük/varsayılan sıcaklık) daha uygun, kod tarafında ayrıca
    # ayarlanmaz. Çok yüksek sıcaklık PLANA SADAKAT kuralını zayıflatır -
    # 0.8'in üzerine çıkarken dikkatli ol.
    qwen_temperature: float = 0.78
    qwen_top_p: float = 0.9
    qwen_max_tokens: int = 4000
    # A/B DENEYİ: True olursa ask_qwen SYSTEM_PROMPT yerine
    # SYSTEM_PROMPT_HYBRID kullanır (bkz. prompts.py). Varsayılan False -
    # kanıtlanmış Türkçe prompt. Gerçek çıktı karşılaştırması yapılmadan
    # production'da True'ya çevirme.
    qwen_use_hybrid_prompt: bool = False

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
