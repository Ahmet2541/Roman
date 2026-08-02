from datetime import datetime

from sqlalchemy import (
    Column, Integer, String, Text, Boolean, Float, ForeignKey, DateTime, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base
from .encryption import EncryptedString, EncryptedJSON


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String(100), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)


class Universe(Base):
    """Bir 'evren/seri' - karakterler, mekanlar, kurallar, terimler,
    ilişkiler, gelişim çizelgesi ve olaylar artık bir ROMANA değil bir
    EVRENE bağlı. Böylece bir serinin 2. kitabına geçtiğinde tüm dünya
    bilgisini sıfırdan girmen gerekmez - aynı evren altında yeni bir
    Roman (kitap) açman yeterli, karakterler/mekanlar/kurallar otomatik
    olarak oradan da erişilebilir olur.

    Bölüm/Paragraf (asıl roman metni) hâlâ bir Roman'a (kitaba) özeldir -
    bkz. Chapter.novel_id. Yani hiyerarşi: Universe -> Novel (kitap) ->
    Chapter -> Paragraph; Universe -> Character/Place/... (paylaşılan)."""
    __tablename__ = "universes"
    id = Column(Integer, primary_key=True)
    name = Column(EncryptedString, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Novel(Base):
    """Bir 'roman/kitap'. Bir Universe'e bağlıdır (universe_id) - aynı
    evrende birden fazla kitap olabilir, hepsi aynı karakter/mekan/kural
    havuzunu paylaşır. book_number, aynı evren içindeki kitapların sırasını
    belirtir (fihriste/AI bağlamına 'Kitap 2' gibi etiketlemek için,
    zorunlu değil).

    universe_id nullable=True: geriye dönük uyumluluk için - eski
    veritabanlarında bu sütun yoktu, migrations.py her Roman için otomatik
    bir Universe oluşturup buraya bağlıyor (bkz. migrations._backfill_universes).
    API katmanında universe_id HER ZAMAN zorunludur."""
    __tablename__ = "novels"
    id = Column(Integer, primary_key=True)
    universe_id = Column(Integer, ForeignKey("universes.id"), nullable=True)
    book_number = Column(Integer, nullable=True)
    name = Column(EncryptedString, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


# ---- Evren düzeyinde paylaşılan tablolar -----------------------------------
# Kişiler, Mekanlar, Olaylar, Nesneler, İpuçları, Terimler, Roman Kuralları,
# Faksiyonlar - hepsi artık universe_id ile bir EVRENE bağlı (bir romana
# değil) - böylece bir serinin tüm kitapları aynı karakter/mekan/kural
# havuzunu paylaşır. "entity_type" alanı Mention tablosunda hangi menüye
# ait olduğunu ayırt eder.
#
# İçerik alanları (name/title/description/notes/text) EncryptedString ile
# şifreli tutulur - .env'deki DB_ENCRYPTION_KEY olmadan veritabanı dosyası
# tek başına ele geçirilse bile hiçbir isim/metin okunamaz.
#
# universe_id: nullable=True bırakıldı - eski veritabanlarında bu sütun
# hiç yoktu (bunun yerine novel_id vardı), migrations.py her satırı kendi
# romanının evrenine otomatik bağlıyor (bkz. migrations._backfill_universes).
# API katmanında universe_id HER ZAMAN zorunludur (bkz.
# novel_context.get_universe_id).

class Character(Base):
    __tablename__ = "characters"
    id = Column(Integer, primary_key=True)
    universe_id = Column(Integer, ForeignKey("universes.id"), nullable=True)
    name = Column(EncryptedString, nullable=False)
    # Alternatif isimler/unvanlar (ör. "Kral", "Majesteleri", "Aeron") -
    # mentions.py bu isimlerden HERHANGİ birini de "bu karakter geçti" diye
    # sayar (bkz. mentions.py). Boş liste olabilir.
    aliases = Column(EncryptedJSON(default_empty=list), default=list)
    description = Column(EncryptedString, default="")
    notes = Column(EncryptedString, default="")
    status = Column(String(30), default="aktif")  # aktif | pasif | öldü - içerik değil, düz kalabilir
    # Konuya göre bölünmüş derin profil: duygusal_yapi, fiziksel_yapi,
    # gecmis, kariyer, iliskiler, konusma_tarzi, meta (bkz. app/sections.py).
    # description/notes kısa/genel bilgi için kalmaya devam ediyor - sections
    # bunun YERİNE değil, EK bir katman. AI'ya context'e girerken description/
    # notes hep gider, sections'daki bölümler ise sadece talimatla ilgiliyse
    # (chat modunda get_entity_section aracıyla) çekilir - bkz. qwen_client.py.
    sections = Column(EncryptedJSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CharacterRelationship(Base):
    """İki karakter arasındaki ilişki (kardeşi, düşmanı, sevgilisi vb.).
    İlişki haritası bu tablodan üretilir. Evren düzeyinde - iki karakter
    hangi kitapta tanıştıysa tanışsın, ilişki tüm seri boyunca geçerlidir."""
    __tablename__ = "character_relationships"
    id = Column(Integer, primary_key=True)
    universe_id = Column(Integer, ForeignKey("universes.id"), nullable=True)
    character_a_id = Column(Integer, ForeignKey("characters.id"), nullable=False)
    character_b_id = Column(Integer, ForeignKey("characters.id"), nullable=False)
    label = Column(EncryptedString, default="")
    notes = Column(EncryptedString, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Place(Base):
    __tablename__ = "places"
    id = Column(Integer, primary_key=True)
    universe_id = Column(Integer, ForeignKey("universes.id"), nullable=True)
    # Mekan hiyerarşisi: bir mekan başka bir mekanın İÇİNDE olabilir (ör.
    # "Kraliyet Sarayı" -> üst mekanı "Buz Şehri" -> üst mekanı "Kuzey
    # Krallığı"). Sınır yok, istediğin kadar iç içe geçebilir. AI context'e
    # bir mekan seçildiğinde bu zincir otomatik eklenir (bkz.
    # qwen_client.build_dynamic_layer) - "nerede olduğunu" her seferinde
    # elle Bağlantılar bölümüne yazmana gerek kalmaz.
    parent_place_id = Column(Integer, ForeignKey("places.id"), nullable=True)
    name = Column(EncryptedString, nullable=False)
    aliases = Column(EncryptedJSON(default_empty=list), default=list)  # bkz. Character.aliases
    description = Column(EncryptedString, default="")
    notes = Column(EncryptedString, default="")
    # bkz. Character.sections yorumu - aynı mantık, mekan için farklı bölüm
    # kümesiyle (fiziksel_yapi, atmosfer, gecmis, kurallar, baglantilar,
    # zamansal_degisim, meta).
    sections = Column(EncryptedJSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Faction(Base):
    """Hane/Lonca/Ordu/Tarikat gibi gruplar. Devasa bir dünyada karakterler
    çoğu zaman tek tek değil gruplar halinde anlamlıdır - bu tablo + aşağıdaki
    FactionMembership, ikili (A-B) CharacterRelationship'in kapsayamadığı
    'bu 40 karakter aynı Hane'ye mensup' türü bilgiyi tutar."""
    __tablename__ = "factions"
    id = Column(Integer, primary_key=True)
    universe_id = Column(Integer, ForeignKey("universes.id"), nullable=True)
    name = Column(EncryptedString, nullable=False)
    description = Column(EncryptedString, default="")
    notes = Column(EncryptedString, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FactionMembership(Base):
    """Bir karakterin bir faksiyondaki üyeliği/rolü (ör. 'Lider', 'Muhafız')."""
    __tablename__ = "faction_memberships"
    id = Column(Integer, primary_key=True)
    universe_id = Column(Integer, ForeignKey("universes.id"), nullable=True)
    faction_id = Column(Integer, ForeignKey("factions.id"), nullable=False)
    character_id = Column(Integer, ForeignKey("characters.id"), nullable=False)
    role = Column(EncryptedString, default="")
    notes = Column(EncryptedString, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("faction_id", "character_id", name="uq_faction_character"),)


class Event(Base):
    """Olaylar / zaman çizelgesi. story_order ile kronolojik sıralanır (yazma
    sırası değil, hikaye içi gerçekleşme sırası - geriye dönüşlerde bunlar
    farklı olabilir). place_id ve character_ids çakışma kontrolü için
    kullanılır (aynı anda aynı karakter farklı yerde olamaz).

    Evren düzeyinde tutulur - bir serinin zaman çizelgesi tek bir kitapla
    sınırlı değildir, çakışma kontrolü de artık TÜM seri genelinde çalışır.
    source_novel_id (opsiyonel), bu olayın hangi kitapta anlatıldığını
    belirtir - sadece bilgi amaçlıdır, filtrelemede kullanılmaz."""
    __tablename__ = "events"
    id = Column(Integer, primary_key=True)
    universe_id = Column(Integer, ForeignKey("universes.id"), nullable=True)
    source_novel_id = Column(Integer, ForeignKey("novels.id"), nullable=True)
    name = Column(EncryptedString, nullable=False)
    description = Column(EncryptedString, default="")
    notes = Column(EncryptedString, default="")
    place_id = Column(Integer, ForeignKey("places.id"), nullable=True)
    story_date = Column(EncryptedString, default="")  # GÖRÜNEN metin, ör. "28 Haziran 2030 gece", "3. gün"
    # GERÇEKLEŞME ZAMANI - sıralanabilir/filtrelenebilir biçim (ISO benzeri,
    # sıfır dolgulu): "2030-06-28T21:00", "2023-02" ya da "2023". Serbest
    # metin (story_date) okunur ama SIRALANAMAZ; kurguda zaman hatası
    # olmaması için karşılaştırılabilir bir anahtar şart. Kısmi tarihler
    # kabul edilir - sözlük sıralaması doğru kronolojiyi verir.
    occurred_at = Column(EncryptedString, default="")
    story_order = Column(Integer, nullable=True)  # ANLATI sırası (romanda kaçıncı sırada anlatıldığı)
    character_ids = Column(EncryptedString, default="")  # virgülle ayrılmış id listesi, ör. "1,3"
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Object(Base):
    """Nesneler / önemli eşyalar. Kişi/Mekan gibi derin profil (sections)
    taşır ama daha kompakt: 4 başlık + meta (bkz. sections.OBJECT_SECTIONS)."""
    __tablename__ = "objects"
    id = Column(Integer, primary_key=True)
    universe_id = Column(Integer, ForeignKey("universes.id"), nullable=True)
    name = Column(EncryptedString, nullable=False)
    aliases = Column(EncryptedJSON(default_empty=list), default=list)  # "Kül Şişesi"ne "şişe" da denebilir - mention tespiti bunlardan beslenir
    description = Column(EncryptedString, default="")
    notes = Column(EncryptedString, default="")
    sections = Column(EncryptedJSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Foreshadowing(Base):
    """İpuçları / öngörüler takibi."""
    __tablename__ = "foreshadowings"
    id = Column(Integer, primary_key=True)
    universe_id = Column(Integer, ForeignKey("universes.id"), nullable=True)
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
    universe_id = Column(Integer, ForeignKey("universes.id"), nullable=True)
    name = Column(EncryptedString, nullable=False)
    description = Column(EncryptedString, default="")
    notes = Column(EncryptedString, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Rule(Base):
    """Roman kuralları - sabit katman. Varsayılan olarak her AI isteğinde
    otomatik ve tam olarak dahil edilir. tags (opsiyonel) - devasa
    dünyalarda kural sayısı arttıkça (bkz. qwen_client.build_fixed_layer)
    hepsini her seferinde göndermek yerine, etiketsiz (evrensel) kurallar +
    talimat metninde geçen etikete sahip kurallar filtrelenir. Boş
    bırakılırsa (varsayılan) her zaman dahil edilir - küçük dünyalarda
    hiçbir şey değişmez."""
    __tablename__ = "rules"
    id = Column(Integer, primary_key=True)
    universe_id = Column(Integer, ForeignKey("universes.id"), nullable=True)
    # KAPSAM: ikisi de doluysa kural bir kayda özeldir ("Vicdan yargıç
    # değil" -> character #12) ve SABİT katmandan çıkar - SADECE o kayıt
    # seçili varlıklardayken dinamik katmanla gider (bkz. build_dynamic_layer).
    # Boşsa (varsayılan) genel kuraldır, davranış eskisi gibi.
    # 100+ kurallı dünyada asıl kazanç bu: kişiye özel kural, kişinin
    # geçmediği bölümün context'ini şişirmez.
    entity_type = Column(String(20), nullable=True)  # character | place | object
    entity_id = Column(Integer, nullable=True)
    title = Column(EncryptedString, nullable=False)
    description = Column(EncryptedString, default="")
    tags = Column(EncryptedJSON(default_empty=list), default=list)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---- Roman metni: Bölümler / Paragraflar (KİTABA özel, evrene değil) ------

class Chapter(Base):
    """kind: 'chapter' (normal bölüm, paragrafları olur) | 'part' (KISIM /
    büyük başlık - ör. 'BİRİNCİ KISIM') | 'subtitle' (alt başlık - bir
    bölüm grubunun içindeki daha küçük ayraç). 'part' ve 'subtitle'
    girdilerinin paragrafı olmaz, sadece fihristte/okuyucuda bir ayraç
    satırı olarak görünürler ve AI bağlam katmanlarına (fihrist özeti,
    full-scan) dahil EDİLMEZLER - çünkü içerikleri yok, sadece yapı.
    number, TÜM girdiler (bölüm+başlık+alt başlık) arasındaki sırayı
    belirler - "bölüm numarası" değil "sıra" olarak düşünülmeli.

    novel_id: hangi KİTABA ait - bu evren değil kitap düzeyinde kalıyor,
    çünkü asıl roman metni bir kitaba özeldir (karakterler/kurallar gibi
    paylaşılan bir şey değil)."""
    __tablename__ = "chapters"
    id = Column(Integer, primary_key=True)
    novel_id = Column(Integer, ForeignKey("novels.id"), nullable=True)
    number = Column(Integer, nullable=False)
    kind = Column(String(20), nullable=False, default="chapter")  # chapter | part | subtitle
    title = Column(EncryptedString, default="")
    summary = Column(EncryptedString, default="")  # Qwen tarafından üretilip onaylanan özet
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("novel_id", "number", name="uq_novel_chapter_number"),)

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
    """Bir varlığın (karakter/mekan/nesne/olay/ipucu/faksiyon) zaman içinde
    DEĞİŞEN bilgisi. Ana description/notes alanları statiktir (evren
    boyunca geçerli genel bilgi); Progression ise 'Bölüm X'ten itibaren şu
    geçerli' şeklinde kronolojik bir iz tutar. Evren düzeyinde tutulur -
    bir karakterin gelişimi kitap sınırını aşabilir (2. kitapta öğrenilen
    bir şey 1. kitaptaki haliyle çelişmemeli).

    source_novel_id (opsiyonel): bu notun hangi KİTAPTA öğrenildiğini
    belirtir (chapter_number o kitabın içindeki sırayı ifade eder) -
    'Kitap 2, Bölüm 12' gibi göstermek için, filtrelemede kullanılmaz."""
    __tablename__ = "progressions"
    id = Column(Integer, primary_key=True)
    universe_id = Column(Integer, ForeignKey("universes.id"), nullable=True)
    source_novel_id = Column(Integer, ForeignKey("novels.id"), nullable=True)
    entity_type = Column(String(30), nullable=False)
    entity_id = Column(Integer, nullable=False)
    chapter_number = Column(Integer, nullable=True)
    note = Column(EncryptedString, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class EntitySnapshot(Base):
    """Bir varlığın (karakter/mekan/nesne/olay/ipucu/terim/kural/faksiyon)
    description/notes/sections/aliases/tags/status gibi alanlarından biri
    PUT ile değiştirildiğinde, DEĞİŞMEDEN ÖNCEKİ hali burada saklanır -
    Paragraph için zaten var olan ParagraphVersion mekanizmasının menü
    verisi karşılığı. Amaç: AI (propose_entity_update onayı, approve-
    suggestions) ya da yazarın kendisi yanlışlıkla önemli bir notu silip
    üzerine yazarsa geri dönebilmek - şu ana kadar bu tür veri için HİÇBİR
    güvenlik ağı yoktu.

    old_value_json: alanın tipi ne olursa olsun (düz metin, dict, liste)
    JSON'a çevrilip EncryptedString olarak (yani şifreli) saklanır - tek
    sütunla hepsini kapsamak için."""
    __tablename__ = "entity_snapshots"
    id = Column(Integer, primary_key=True)
    universe_id = Column(Integer, ForeignKey("universes.id"), nullable=True)
    entity_type = Column(String(30), nullable=False)  # character | place | object | ...
    entity_id = Column(Integer, nullable=False)
    field_name = Column(String(50), nullable=False)  # description | notes | sections | aliases | tags | status | title
    old_value_json = Column(EncryptedString, nullable=False)
    saved_at = Column(DateTime, default=datetime.utcnow)


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
    entity_type = Column(String(30), nullable=False)  # character | place | event | object | foreshadowing | faction
    entity_id = Column(Integer, nullable=False)
    entity_name = Column(EncryptedString, nullable=False)  # arama/gösterim için tekrar tutulur

    paragraph = relationship("Paragraph", back_populates="mentions")

# ---- Üslup taraması (yazım tiki dedektörü) ---------------------------------
# Amaç: "gibi/sanki/X yerine Y" tarzı, yazarın farkında olmadan aşırı
# kullandığı kalıpları TÜM seri metninde saymak ve eşiği aşanları her AI
# isteğinin context'ine "bundan kaçın" uyarısı olarak enjekte etmek.
# Tasarım kararları:
#   - Kalıplar sabit kod DEĞİL, düzenlenebilir DB kaydı (StylePattern) -
#     bugün "gibi"yi biliyoruz, yarın yeni bir tik keşfedilir, kod
#     değişikliği gerekmeden eklenir.
#   - Tarama HER AI isteğinde çalışmaz - full_scan ile aynı desen: elle
#     "Tara" ile çalışır, sonuç StyleScanResult'a önbelleklenir, AI
#     istekleri bu ucuz önbellekten okur. 12.000 sayfada her istekte tüm
#     romanı taramak hem yavaş hem gereksiz olurdu.
#   - Eşik ÇİFT koşullu: 1000 kelime başına yoğunluk (threshold_per_1000)
#     VE mutlak minimum tekrar (min_count). Tek başına yoğunluk, kısa
#     metinlerde tek bir kelimeyi bile "aşırı kullanım" sayar (10 kelimede
#     1 tekrar = binde 100) - min_count bu hatayı kökten kapatır.


class StylePattern(Base):
    """Bir yazım tiki tanımı: isim + regex + eşikler. Evren düzeyinde -
    3. kitaptaki bir tik 1. kitaptan da geliyor olabilir, o yüzden sayım
    seri geneli yapılır.

    pattern şifrelidir (roman içeriğine özgü bir kelime/isim içerebilir);
    zaten SQL tarafında regex ile filtreleme yapılmıyor, tüm kalıplar
    Python'a çekilip orada derleniyor - şifreleme bir şey kaybettirmiyor.

    Regex'ler KÜÇÜK HARFLE yazılmalı - tarama motoru metni Türkçe'ye uygun
    şekilde (İ->i, I->ı) küçülterek eşleştirir (bkz. style_scan._tr_lower),
    çünkü Python'un re.IGNORECASE'i Türkçe İ/ı ayrımını bilmez."""
    __tablename__ = "style_patterns"
    id = Column(Integer, primary_key=True)
    universe_id = Column(Integer, ForeignKey("universes.id"), nullable=True)
    name = Column(EncryptedString, nullable=False)          # ör: "yalın 'gibi' benzetmesi"
    pattern = Column(EncryptedString, nullable=False)       # küçük harf regex, ör: \bgibi\w*
    threshold_per_1000 = Column(Float, default=2.0)         # 1000 kelimede kaç tekrar "aşırı" sayılır
    min_count = Column(Integer, default=5)                  # eşik aşımı için mutlak minimum tekrar
    enabled = Column(Boolean, default=True)
    # NAKARAT koruması: bilinçli leitmotif'ler ("Biz size güvendik" gibi)
    # sayılır ve raporda görünür ama ASLA "aşırı kullanım" uyarısına
    # dönüşmez - kasıtlı tekrar, tik değildir. Silmekten farkı: sayacı
    # görmeye devam edersin (nakarat kontrolden çıkarsa fark edersin).
    is_refrain = Column(Boolean, default=False)
    notes = Column(EncryptedString, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class StyleScanResult(Base):
    """En son üslup taramasının önbelleği - evren başına TEK satır (yeni
    tarama eskisinin üzerine yazar). result_json, raporun tamamının
    (kalıp sayımları, yoğunluklar, en yoğun bölümler) şifreli JSON hali.
    build_context her AI isteğinde buradan okur - canlı tarama yapmaz."""
    __tablename__ = "style_scan_results"
    id = Column(Integer, primary_key=True)
    universe_id = Column(Integer, ForeignKey("universes.id"), nullable=True)
    result_json = Column(EncryptedString, nullable=False)
    scanned_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("universe_id", name="uq_style_scan_universe"),)


# ---- Plan Matrisi (Excel benzeri eşleştirme tablosu) -----------------------
# Kullanım örneği: 8 sanık × 7 aşama = 56 hücrelik bir tur yapısı. Kolonlar
# "kişiler/turlar" (üstte), satırlar "aşamalar" (yanda), her hücre o
# kesişimin PLANI (madde madde: görüntüler, anahtar kelime, sorular...).
# Genel amaçlı: her roman kendi matrislerini, kendi boyutlarında kurar.
#
# KRİTİK BAĞLANTI: bir hücre bir Bölüme bağlanabilir (chapter_id) - o bölüm
# üzerinde çalışılırken hücrenin içeriği AI context'ine "BÖLÜM PLANI"
# katmanı olarak OTOMATİK girer (bkz. qwen_client.build_plan_layer). Yani
# plan artık dosyalarda değil, tam yazıldığı bölümün AI'ına akıyor.
# Matris bir KİTABA bağlıdır (novel_id) - bölümler gibi; plan kitaba özel.


class PlanMatrix(Base):
    __tablename__ = "plan_matrices"
    id = Column(Integer, primary_key=True)
    novel_id = Column(Integer, ForeignKey("novels.id"), nullable=False)
    name = Column(EncryptedString, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    columns = relationship("MatrixColumn", back_populates="matrix", cascade="all, delete-orphan", order_by="MatrixColumn.position")
    rows = relationship("MatrixRow", back_populates="matrix", cascade="all, delete-orphan", order_by="MatrixRow.position")
    cells = relationship("MatrixCell", back_populates="matrix", cascade="all, delete-orphan")


class MatrixColumn(Base):
    """Bir kolon = bir kişi/tur (ör. 'TUR 1: BAŞKAN'). character_id
    opsiyonel: kolonu bir Kişi kaydına bağlarsan, o kolonun hücreleri
    yazılırken karakterin derin profili de zaten seçilebilir durumda."""
    __tablename__ = "matrix_columns"
    id = Column(Integer, primary_key=True)
    matrix_id = Column(Integer, ForeignKey("plan_matrices.id"), nullable=False)
    position = Column(Integer, nullable=False, default=0)
    label = Column(EncryptedString, nullable=False)
    character_id = Column(Integer, ForeignKey("characters.id"), nullable=True)

    matrix = relationship("PlanMatrix", back_populates="columns")


class MatrixRow(Base):
    """Bir satır = bir aşama (ör. '1. Hologram (5 dk)').

    kind: 'main' (ana başlık) | 'sub' (ara başlık - girintili/italik
    gösterilir). Ara başlıklar da tam satırdır (hücreleri olur, bölüme
    bağlanabilir) - amaç yapı büyüdükçe bir aşamanın İÇİNE alt adımlar
    ekleyebilmek (ör. '5. Sorgu' altına '5a. Kanıt yüzleşmesi'). Sıraya
    ARAYA ekleme desteklenir (bkz. router add_row: after_row_id)."""
    __tablename__ = "matrix_rows"
    id = Column(Integer, primary_key=True)
    matrix_id = Column(Integer, ForeignKey("plan_matrices.id"), nullable=False)
    position = Column(Integer, nullable=False, default=0)
    kind = Column(String(10), nullable=False, default="main")  # main | sub
    label = Column(EncryptedString, nullable=False)
    # TALİMAT KASASI: bu satırdaki (aşamadaki) TÜM hücreler için geçerli
    # kalıcı yazım kısıtları. Örn. "Karar aşaması: duyguyu adlandırma;
    # sanık tek cümle konuşur; şişeyi betimlemeye yedir". Bir bölüm bu
    # satırın hücresine bağlıysa, kısıtlar plan katmanıyla birlikte AI'ya
    # gider - iyi talimatı her seferinde yeniden hatırlamak gerekmez.
    instructions = Column(EncryptedString, default="")

    matrix = relationship("PlanMatrix", back_populates="rows")


class MatrixCell(Base):
    """Kolon × satır kesişimi. content: serbest, madde madde plan metni
    (şifreli). chapter_id: bu hücrenin yazıldığı bölüm - doluysa o bölümün
    her AI isteğine bu plan otomatik enjekte edilir."""
    __tablename__ = "matrix_cells"
    id = Column(Integer, primary_key=True)
    matrix_id = Column(Integer, ForeignKey("plan_matrices.id"), nullable=False)
    column_id = Column(Integer, ForeignKey("matrix_columns.id"), nullable=False)
    row_id = Column(Integer, ForeignKey("matrix_rows.id"), nullable=False)
    content = Column(EncryptedString, default="")
    chapter_id = Column(Integer, ForeignKey("chapters.id"), nullable=True)
    # SABİT referans kodu (MP1, MP2, ...): hücre İLK oluşturulduğunda roman
    # genelinde artan sırayla atanır ve bir daha ASLA değişmez - satır/kolon
    # araya eklense, sıralar kaysa bile kod aynı kalır. Amaç: başka bir
    # bölüm yazarken talimata "MP13'teki gibi" yazınca AI'nın o planı
    # kıyas için çekebilmesi (bkz. qwen_client.build_plan_layer). Kodun
    # kendisi anlam taşımaz (şifresiz düz ID), içerik ayrıca şifreli.
    code = Column(String(20), nullable=True)

    matrix = relationship("PlanMatrix", back_populates="cells")

    __table_args__ = (UniqueConstraint("column_id", "row_id", name="uq_matrix_cell"),)
