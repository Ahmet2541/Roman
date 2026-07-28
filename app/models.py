from datetime import datetime

from sqlalchemy import (
    Column, Integer, String, Text, Boolean, ForeignKey, DateTime, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base
from .encryption import EncryptedString


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String(100), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)


# ---- Ortak menü tabloları -------------------------------------------------
# Kişiler, Mekanlar, Olaylar, Nesneler, İpuçları, Terimler ve Roman Kuralları
# hepsi aynı basit şekle sahip: isim + açıklama + notlar.
# "entity_type" alanı Mention tablosunda hangi menüye ait olduğunu ayırt eder.
#
# İçerik alanları (name/title/description/notes/text) EncryptedString ile
# şifreli tutulur - .env'deki DB_ENCRYPTION_KEY olmadan veritabanı dosyası
# tek başına ele geçirilse bile hiçbir isim/metin okunamaz. ORM üzerinden
# okurken/yazarken tamamen şeffaf çalışır, uygulama kodu fark etmez.

class Character(Base):
    __tablename__ = "characters"
    id = Column(Integer, primary_key=True)
    name = Column(EncryptedString, nullable=False)
    description = Column(EncryptedString, default="")
    notes = Column(EncryptedString, default="")
    status = Column(String(30), default="aktif")  # aktif | pasif | öldü - içerik değil, düz kalabilir
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CharacterRelationship(Base):
    """İki karakter arasındaki ilişki (kardeşi, düşmanı, sevgilisi vb.).
    İlişki haritası bu tablodan üretilir."""
    __tablename__ = "character_relationships"
    id = Column(Integer, primary_key=True)
    character_a_id = Column(Integer, ForeignKey("characters.id"), nullable=False)
    character_b_id = Column(Integer, ForeignKey("characters.id"), nullable=False)
    label = Column(EncryptedString, default="")
    notes = Column(EncryptedString, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Place(Base):
    __tablename__ = "places"
    id = Column(Integer, primary_key=True)
    name = Column(EncryptedString, nullable=False)
    description = Column(EncryptedString, default="")
    notes = Column(EncryptedString, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Event(Base):
    """Olaylar / zaman çizelgesi. story_order ile kronolojik sıralanır (yazma
    sırası değil, hikaye içi gerçekleşme sırası - geriye dönüşlerde bunlar
    farklı olabilir). place_id ve character_ids çakışma kontrolü için
    kullanılır (aynı anda aynı karakter farklı yerde olamaz)."""
    __tablename__ = "events"
    id = Column(Integer, primary_key=True)
    name = Column(EncryptedString, nullable=False)
    description = Column(EncryptedString, default="")
    notes = Column(EncryptedString, default="")
    place_id = Column(Integer, ForeignKey("places.id"), nullable=True)
    story_date = Column(EncryptedString, default="")  # serbest metin, ör. "3. gün", "Mayıs 1950"
    story_order = Column(Integer, nullable=True)  # kronolojik sıralama için sayı
    character_ids = Column(EncryptedString, default="")  # virgülle ayrılmış id listesi, ör. "1,3"
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Object(Base):
    """Nesneler / önemli eşyalar."""
    __tablename__ = "objects"
    id = Column(Integer, primary_key=True)
    name = Column(EncryptedString, nullable=False)
    description = Column(EncryptedString, default="")
    notes = Column(EncryptedString, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Foreshadowing(Base):
    """İpuçları / öngörüler takibi."""
    __tablename__ = "foreshadowings"
    id = Column(Integer, primary_key=True)
    name = Column(EncryptedString, nullable=False)
    description = Column(EncryptedString, default="")
    status = Column(String(50), default="açık")  # açık | kapandı - içerik değil, düz kalabilir
    notes = Column(EncryptedString, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class GlossaryTerm(Base):
    """Terimler sözlüğü."""
    __tablename__ = "glossary_terms"
    id = Column(Integer, primary_key=True)
    name = Column(EncryptedString, nullable=False)
    description = Column(EncryptedString, default="")
    notes = Column(EncryptedString, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Rule(Base):
    """Roman kuralları - sabit katman. Her API isteğinde otomatik ve
    tam olarak dahil edilir, bölüme özel filtrelemeye tabi değildir."""
    __tablename__ = "rules"
    id = Column(Integer, primary_key=True)
    title = Column(EncryptedString, nullable=False)
    description = Column(EncryptedString, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---- Roman metni: Bölümler / Paragraflar ----------------------------------

class Chapter(Base):
    __tablename__ = "chapters"
    id = Column(Integer, primary_key=True)
    number = Column(Integer, nullable=False, unique=True)
    title = Column(EncryptedString, default="")
    summary = Column(EncryptedString, default="")  # Qwen tarafından üretilip onaylanan özet
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    paragraphs = relationship(
        "Paragraph", back_populates="chapter",
        cascade="all, delete-orphan", order_by="Paragraph.number",
    )


class Paragraph(Base):
    __tablename__ = "paragraphs"
    id = Column(Integer, primary_key=True)
    chapter_id = Column(Integer, ForeignKey("chapters.id"), nullable=False)
    number = Column(Integer, nullable=False)
    text = Column(EncryptedString, nullable=False)
    is_style_sample = Column(Boolean, default=False)  # Qwen'e "böyle yaz" örneği olarak verilir
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("chapter_id", "number", name="uq_chapter_paragraph"),)

    chapter = relationship("Chapter", back_populates="paragraphs")
    mentions = relationship("Mention", back_populates="paragraph", cascade="all, delete-orphan")
    versions = relationship(
        "ParagraphVersion", back_populates="paragraph",
        cascade="all, delete-orphan", order_by="ParagraphVersion.saved_at.desc()",
    )


class ParagraphVersion(Base):
    """Bir paragraf her güncellendiğinde ESKİ hali buraya kaydedilir (yeni
    hali değil) - böylece AI bir paragrafı yeniden yazdığında ya da elle
    düzenlediğinde önceki metne geri dönebilirsin."""
    __tablename__ = "paragraph_versions"
    id = Column(Integer, primary_key=True)
    paragraph_id = Column(Integer, ForeignKey("paragraphs.id"), nullable=False)
    text = Column(EncryptedString, nullable=False)
    saved_at = Column(DateTime, default=datetime.utcnow)

    paragraph = relationship("Paragraph", back_populates="versions")


class Progression(Base):
    """Bir varlığın (karakter/mekan/nesne/olay/ipucu) zaman içinde DEĞİŞEN
    bilgisi. Ana description/notes alanları statiktir (roman boyunca geçerli
    genel bilgi); Progression ise 'Bölüm X'ten itibaren şu geçerli' şeklinde
    kronolojik bir iz tutar (Novelcrafter'daki 'Progressions' karşılığı).
    chapter_number boş bırakılabilir (henüz belli bir bölüme bağlanmamış not)."""
    __tablename__ = "progressions"
    id = Column(Integer, primary_key=True)
    entity_type = Column(String(30), nullable=False)
    entity_id = Column(Integer, nullable=False)
    chapter_number = Column(Integer, nullable=True)
    note = Column(EncryptedString, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Mention(Base):
    """Bir paragrafta hangi karakter/mekan/olay/nesne/ipucunun geçtiğini
    tutan indeks tablosu. 'Ahmet gemide' dediğinde ilgili paragrafı bulmayı
    ve AI context'ine geçmiş paragrafları eklemeyi sağlayan asıl mekanizma.

    entity_name şifrelidir - bu yüzden arama artık SQL ILIKE ile değil,
    kayıtları çekip Python tarafında (şifre çözüldükten sonra) filtrelenerek
    yapılır (bkz. routers/chapters.py search endpoint'i). Kişisel bir roman
    ölçeğinde bu performans farkı önemsizdir."""
    __tablename__ = "mentions"
    id = Column(Integer, primary_key=True)
    paragraph_id = Column(Integer, ForeignKey("paragraphs.id"), nullable=False)
    entity_type = Column(String(30), nullable=False)  # character | place | event | object | foreshadowing
    entity_id = Column(Integer, nullable=False)
    entity_name = Column(EncryptedString, nullable=False)  # arama/gösterim için tekrar tutulur

    paragraph = relationship("Paragraph", back_populates="mentions")
