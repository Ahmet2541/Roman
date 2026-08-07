from datetime import datetime
from typing import Optional, List, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .sections import validate_section_keys


# ---- Auth ------------------------------------------------------------------

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ---- Ortak menü şeması (Kişiler, Mekanlar, Olaylar, Nesneler, Terimler) ----

class SimpleEntityBase(BaseModel):
    name: str
    description: str = ""
    notes: str = ""


class SimpleEntityCreate(SimpleEntityBase):
    pass


class SimpleEntityUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None


class SimpleEntityOut(SimpleEntityBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime


# ---- Nesneler (derin profil ekli - kompakt: 4 başlık + meta) ---------------
# SimpleEntity* şemasından ayrıldı çünkü sections alanı sadece Nesneler'e
# eklendi - Terimler gibi diğer basit menüler etkilenmesin.

class ObjectCreate(SimpleEntityBase):
    aliases: List[str] = []
    sections: dict[str, str] = {}

    @field_validator("sections")
    @classmethod
    def _check_sections(cls, v):
        return validate_section_keys(v, "object")


class ObjectUpdate(SimpleEntityUpdate):
    aliases: Optional[List[str]] = None
    # sections merge davranışı Kişiler'le aynı: gönderilen anahtarlar
    # güncellenir, gönderilmeyenler SİLİNMEZ (bkz. generic_crud.py).
    sections: Optional[dict[str, str]] = None

    @field_validator("sections")
    @classmethod
    def _check_sections(cls, v):
        if v is None:
            return v
        return validate_section_keys(v, "object")


class ObjectOut(SimpleEntityOut):
    aliases: List[str] = []
    sections: dict[str, str] = {}


# ---- İpuçları (durum alanı ekli) -------------------------------------------

class ForeshadowingCreate(SimpleEntityBase):
    status: str = "açık"


class ForeshadowingUpdate(SimpleEntityUpdate):
    status: Optional[str] = None


class ForeshadowingOut(SimpleEntityOut):
    status: str


# ---- Kişiler (durum alanı ekli) --------------------------------------------

class CharacterCreate(SimpleEntityBase):
    status: str = "aktif"  # aktif | pasif | öldü
    # Alternatif isimler/unvanlar (ör. "Kral", "Majesteleri") - mentions.py
    # metinde bunlardan biri geçtiğinde de bu karakteri "geçti" sayar.
    aliases: List[str] = []
    # Konuya göre bölünmüş derin profil (bkz. app/sections.py). Boş
    # bırakılabilir - hiçbir bölüm zorunlu değil, yazar istediği kadarını,
    # istediği zaman doldurur.
    sections: dict[str, str] = {}

    @field_validator("sections")
    @classmethod
    def _check_sections(cls, v):
        return validate_section_keys(v, "character")


class CharacterUpdate(SimpleEntityUpdate):
    status: Optional[str] = None
    aliases: Optional[List[str]] = None
    # ÖNEMLİ: burada gönderilen sections, var olanın YERİNE geçmez - sadece
    # gönderilen anahtarlar günceller/eklenir (bkz. generic_crud.py update
    # fonksiyonundaki merge mantığı). Yani {"korkular": "..."} göndermek
    # diğer bölümleri (fiziksel_yapi, kariyer vb.) SİLMEZ.
    sections: Optional[dict[str, str]] = None

    @field_validator("sections")
    @classmethod
    def _check_sections(cls, v):
        if v is None:
            return v
        return validate_section_keys(v, "character")


class CharacterOut(SimpleEntityOut):
    status: str
    aliases: List[str] = []
    sections: dict[str, str] = {}


# ---- Mekanlar (artık SimpleEntity* paylaşmıyor - sections alanı için) -----
# Not: Diğer basit menüler (Nesneler, Terimler) hâlâ SimpleEntity* şemasını
# kullanıyor - sadece Mekanlar'a (Kişiler gibi) bölüm sistemi eklendi.

class PlaceCreate(SimpleEntityBase):
    aliases: List[str] = []
    # Bu mekan başka bir mekanın İÇİNDE mi? (ör. bir odanın üst mekanı bir
    # bina, binanın üst mekanı bir şehir...) Sınırsız iç içe geçebilir.
    parent_place_id: Optional[int] = None
    sections: dict[str, str] = {}

    @field_validator("sections")
    @classmethod
    def _check_sections(cls, v):
        return validate_section_keys(v, "place")


class PlaceUpdate(SimpleEntityUpdate):
    aliases: Optional[List[str]] = None
    parent_place_id: Optional[int] = None
    sections: Optional[dict[str, str]] = None  # bkz. CharacterUpdate.sections yorumu - merge, replace değil

    @field_validator("sections")
    @classmethod
    def _check_sections(cls, v):
        if v is None:
            return v
        return validate_section_keys(v, "place")


class PlaceOut(SimpleEntityOut):
    aliases: List[str] = []
    parent_place_id: Optional[int] = None
    sections: dict[str, str] = {}


# ---- Karakter ilişkileri (ilişki haritası) ---------------------------------

class RelationshipCreate(BaseModel):
    character_a_id: int
    character_b_id: int
    label: str
    notes: str = ""


class RelationshipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    character_a_id: int
    character_a_name: str
    character_b_id: int
    character_b_name: str
    label: str
    notes: str
    created_at: datetime


# ---- Olaylar / zaman çizelgesi ---------------------------------------------

class EventCreate(BaseModel):
    name: str
    description: str = ""
    notes: str = ""
    place_id: Optional[int] = None
    story_date: str = ""
    # Sıralanabilir gerçekleşme zamanı: "2030-06-28T21:00" / "2023-02" / "2023"
    occurred_at: str = ""
    story_order: Optional[int] = None
    character_ids: List[int] = []


class EventUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    place_id: Optional[int] = None
    story_date: Optional[str] = None
    story_order: Optional[int] = None
    character_ids: Optional[List[int]] = None
    occurred_at: Optional[str] = None


class EventOut(BaseModel):
    id: int
    name: str
    description: str
    notes: str
    created_at: datetime
    updated_at: datetime
    place_id: Optional[int] = None
    place_name: Optional[str] = None
    story_date: str = ""
    story_order: Optional[int] = None
    character_ids: List[int] = []
    character_names: List[str] = []
    # Bu olay hangi KİTAPTA anlatıldı - sadece bilgi amaçlı, filtrelemede
    # kullanılmaz (evren geneli zaman çizelgesi/çakışma kontrolü tüm
    # kitapları kapsar).
    source_novel_id: Optional[int] = None
    source_novel_name: Optional[str] = None
    occurred_at: str = ""


class EventConflict(BaseModel):
    story_key: str
    event_a: str
    event_b: str
    shared_characters: List[str]


# ---- Roman kuralları --------------------------------------------------------

class RuleBase(BaseModel):
    title: str
    description: str = ""
    # Kayda özel kural: ikisi birlikte dolu olmalı ("Vicdan yargıç değil"
    # -> character + Vicdan'ın id'si). Boşsa genel kural.
    entity_type: Optional[str] = None  # character | place | object
    entity_id: Optional[int] = None

    @field_validator("entity_type")
    @classmethod
    def _check_scope_type(cls, v):
        if v is not None and v not in ("character", "place", "object"):
            raise ValueError("entity_type character/place/object olmalı")
        return v
    # Boş bırakılırsa (varsayılan) bu kural HER ZAMAN AI'ya gönderilir.
    # Dünya büyüdükçe (bkz. qwen_client.build_fixed_layer) etiketli
    # kurallar sadece talimat metninde o etiket geçtiğinde dahil edilir -
    # küçük dünyalarda (az kural) bu filtreleme hiç devreye girmez.
    tags: List[str] = []


class RuleCreate(RuleBase):
    pass


class RuleUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None


class RuleOut(RuleBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime


# ---- Faksiyonlar (Hane/Lonca/Ordu/Tarikat) ---------------------------------
# İkili (A-B) CharacterRelationship'in kapsayamadığı "bu N karakter aynı
# gruba mensup" bilgisini tutar - devasa dünyalarda karakterler çoğu zaman
# tek tek değil gruplar halinde anlamlıdır.

class FactionCreate(SimpleEntityBase):
    pass


class FactionUpdate(SimpleEntityUpdate):
    pass


class FactionOut(SimpleEntityOut):
    pass


class FactionMembershipCreate(BaseModel):
    faction_id: int
    character_id: int
    role: str = ""
    notes: str = ""


class FactionMembershipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    faction_id: int
    faction_name: str
    character_id: int
    character_name: str
    role: str
    notes: str
    created_at: datetime


# ---- Bölüm / Paragraf --------------------------------------------------------

class ParagraphCreate(BaseModel):
    number: int
    text: str


class MentionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    entity_type: str
    entity_id: int
    entity_name: str


class ParagraphOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    number: int
    text: str
    is_style_sample: bool = False
    mentions: List[MentionOut] = []


class ParagraphVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    text: str
    saved_at: datetime


class ChapterCreate(BaseModel):
    number: int
    title: str = ""
    kind: str = "chapter"  # chapter | part | subtitle


class ChapterUpdate(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    kind: Optional[str] = None


class ChapterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    number: int
    title: str
    kind: str
    summary: str
    paragraphs: List[ParagraphOut] = []


class ChapterListOut(BaseModel):
    """Fihrist satırı. summary burada dönüyor çünkü fihrist artık sadece bir
    liste değil - romanın merkezi özet katmanının dışa açılan yüzü. kind,
    bunun normal bir bölüm mü yoksa bir başlık/alt başlık ayracı mı
    olduğunu belirtir. paragraph_count, bir Kısım/Alt Başlık'ın (kind !=
    'chapter') KENDİSİNE yanlışlıkla paragraf eklenmiş olup olmadığını
    tespit etmek için var - normalde 0 olmalı, sıfırdan büyükse frontend
    bunu doğrudan açılabilir/uyarılabilir bir durum olarak ele alır."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    number: int
    title: str
    kind: str
    summary: str
    paragraph_count: int = 0


class ChapterSummaryGenerateResponse(BaseModel):
    """POST /chapters/{id}/generate-summary yanıtı. Taslak niteliğindedir,
    kaydedilmez - kullanıcı onaylarsa mevcut PUT /chapters/{id} (summary
    alanı) ile kaydedilir."""
    chapter_id: int
    generated_summary: str


class AiSplitParagraphsRequest(BaseModel):
    text: str
    mode: str = "append"  # append: mevcut paragrafların sonuna ekler | replace: bölümün tüm paragraflarının YERİNE geçer


class AiSplitParagraphsResponse(BaseModel):
    paragraph_count: int
    paragraphs: List[ParagraphOut]


# ---- AI istekleri -------------------------------------------------------------

class EntityRef(BaseModel):
    """Kullanıcının bölüm için seçtiği karakter/mekan/olay/nesne referansı."""
    entity_type: str  # character | place | event | object | foreshadowing
    entity_id: int


class AiAssistRequest(BaseModel):
    chapter_number: int
    instruction: str  # "şu başlıkla bir bölüm yaz" / "şu paragrafı düzenle" gibi talimat
    selected_entities: List[EntityRef] = []
    existing_text: Optional[str] = None  # düzenleme isteğinde mevcut bölüm metni
    # Alt-metin modu: seçili varlıkların 'gizli' katmanı, sızdırmama
    # direktifiyle context'e girer (varsayılan: hiç girmez).
    include_hidden: bool = False


class AiSuggestion(BaseModel):
    entity_type: str
    name: str
    description: str = ""
    # Zengin çıkarım: metinden toplanan takma adlar ve derin profil bölümleri
    # (sadece kanıta dayalı; geçersiz anahtarlar backend'de sessizce atılır).
    aliases: List[str] = []
    sections: dict[str, str] = {}
    # None -> yeni kayıt oluşturulacak. Dolu -> var olan kayda EKLENİR:
    # description notlara, aliases eksik olanlarıyla birleşir, sections
    # ilgili bölümün SONUNA eklenir - hiçbir mevcut bilgi silinmez.
    existing_entity_id: Optional[int] = None


class BulkSuggestRequest(BaseModel):
    """Kısım (Part) seviyesinde ya da kullanıcının elle seçtiği bölüm
    grubunda toplu varlık/gelişim taraması ister. İkisinden TAM OLARAK
    biri verilmeli:
    - part_id: bu Kısım'a ait TÜM bölümler taranır (fihristteki hiyerarşiye
      göre otomatik bulunur, bkz. routers/chapters.py resolve_chapters_for_part)
    - chapter_ids: sadece bu id'lere sahip bölümler taranır (elle seçim)"""
    part_id: Optional[int] = None
    chapter_ids: Optional[List[int]] = None


class AiAssistResponse(BaseModel):
    generated_text: str
    consistency_notes: List[str] = []
    new_entity_suggestions: List[AiSuggestion] = []


class ApproveSuggestionsRequest(BaseModel):
    suggestions: List[AiSuggestion]


# ---- AI Sohbet Modu (çok turlu, talimat->sonuç yerine ileri-geri) --------

class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class AiChatRequest(BaseModel):
    chapter_number: Optional[int] = None
    selected_entities: List[EntityRef] = []
    messages: List[ChatMessage]
    # SONUÇ kutusunda ŞU AN duran taslak metin (varsa). AI'nın "ev değil
    # bina yap" gibi bir düzenleme isteğini doğru temele oturtabilmesi için
    # gönderilir - AI bunu context'te görür, tam güncellenmiş halini
    # set_draft_result ile geri döner (bkz. qwen_client.CHAT_SYSTEM_PROMPT).
    current_result: Optional[str] = None
    include_hidden: bool = False
    # BAĞLAM KAPSAMI: "chapter" (varsayılan - açık bölümün metni),
    # "none" (metin gitmesin, kısa/ucuz sorular),
    # "novel" (tüm kitap - tutarlılık soruları, pahalı).
    text_scope: str = "chapter"

    @field_validator("text_scope")
    @classmethod
    def _check_scope(cls, v):
        if v not in ("none", "chapter", "novel"):
            raise ValueError("text_scope none/chapter/novel olmalı")
        return v


class EntityUpdateProposal(BaseModel):
    """AI'nın önerdiği, henüz kaydedilmemiş bir varlık güncellemesi."""
    entity_type: str
    entity_id: int
    entity_name: str
    section: str  # sections.py'deki bir anahtar, ya da 'notes'
    content: str  # eklenmesi önerilen yeni bilgi
    existing_text: str = ""  # o bölümde ŞU AN yazan metin (kullanıcı karşılaştırabilsin diye)
    conflicts_with_existing: bool = False
    conflict_note: str = ""


class AiChatResponse(BaseModel):
    reply: str
    actions_taken: List[str] = []
    # Sohbet sırasında AI'nın fark ettiği ama HENÜZ KAYDEDİLMEMİŞ varlık
    # güncelleme önerileri (bkz. qwen_client.propose_entity_update). Frontend
    # bunları sohbet balonunun yanında bir onay kartı olarak gösterir;
    # kullanıcı onaylarsa POST /ai/approve-entity-update ile kaydedilir.
    pending_entity_updates: List[EntityUpdateProposal] = []
    # AI'nın set_draft_result aracıyla ürettiği taslak metin (varsa) - dolu
    # gelirse frontend SONUÇ kutusunu OTOMATİK doldurur, kullanıcının elle
    # "Sonuca Taşı" demesine gerek kalmaz. None ise bu tur sadece sohbetti,
    # SONUÇ kutusu olduğu gibi kalır.
    draft_result: Optional[str] = None


class EntityUpdateApproval(BaseModel):
    """POST /ai/approve-entity-update isteği - kullanıcı bir öneriyi onayladığında gönderilir."""
    entity_type: str
    entity_id: int
    section: str
    content: str
    # append: mevcut metnin SONUNA eklenir (varsayılan, veri kaybetmez)
    # replace: mevcut metnin YERİNE geçer (kullanıcı bilerek "üzerine yaz" seçtiğinde - ör. çelişki durumunda)
    mode: str = "append"


# ---- AI bağlam önizleme ("prompt preview") ---------------------------------

class ContextPreviewRequest(BaseModel):
    chapter_number: Optional[int] = None
    selected_entities: List[EntityRef] = []
    # Talimat verilirse önizleme, /ai/assist'in GERÇEKTE kuracağı context'le
    # birebir aynı olur (talimata göre seçilen derin profil bölümleri dahil).
    instruction: str = ""
    include_hidden: bool = False
    text_scope: str = "chapter"
    include_chapter_text: bool = False


class ContextPreviewResponse(BaseModel):
    context: str
    char_count: int
    approx_tokens: int
    # Şeffaflık: hangi katman ne kadar yer kaplıyor (en büyükten küçüğe)
    breakdown: List["ContextLayerSize"] = []


class ContextLayerSize(BaseModel):
    name: str
    char_count: int
    approx_tokens: int


# ---- Gelişim çizelgesi (Progressions) ---------------------------------------

class ProgressionBase(BaseModel):
    entity_type: str
    entity_id: int
    chapter_number: Optional[int] = None
    note: str


class ProgressionCreate(ProgressionBase):
    pass


class ProgressionOut(ProgressionBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    # Bu not hangi KİTAPTA öğrenildi - sadece bilgi amaçlı ("Kitap 2, Bölüm
    # 12" gibi göstermek için), filtrelemede kullanılmaz. Oluşturma anında
    # o an aktif olan kitaba (X-Novel-Id) göre otomatik doldurulur.
    source_novel_id: Optional[int] = None
    source_novel_name: Optional[str] = None


class ProgressionSuggestion(BaseModel):
    """AI'nın bir bölümü tarayıp önerdiği gelişim notu taslağı. Kaydedilmez -
    kullanıcı onaylarsa mevcut POST /progressions/ ile kaydedilir."""
    entity_type: str
    entity_id: int
    entity_name: str
    chapter_number: int
    note: str


class RelationshipSuggestion(BaseModel):
    """AI'nın bir/bir grup bölümü tarayıp önerdiği YENİ karakter ilişkisi
    taslağı. Kaydedilmez - kullanıcı onaylarsa mevcut POST /relationships/
    ile kaydedilir."""
    character_a_id: int
    character_a_name: str
    character_b_id: int
    character_b_name: str
    label: str
    notes: str = ""


class EventSuggestion(BaseModel):
    """AI'nın bir/bir grup bölümü tarayıp önerdiği YENİ olay taslağı.
    Kaydedilmez - kullanıcı onaylarsa mevcut POST /events/ ile (bu şemayla
    birebir uyumlu alanlarla) kaydedilir. story_order Python tarafında
    deterministik hesaplanır (bkz. qwen_client.suggest_events_for_chapters) -
    AI'dan istenmez, tutarsız/çakışan sayı riski olmasın diye."""
    name: str
    description: str = ""
    chapter_number: int
    story_order: int
    place_id: Optional[int] = None
    place_name: Optional[str] = None
    character_ids: List[int] = []
    character_names: List[str] = []


# ---- Tüm roman tutarlılık taraması -----------------------------------------

class ScanIssue(BaseModel):
    severity: str = "orta"  # düşük | orta | yüksek
    chapter_number: Optional[int] = None
    paragraph_number: Optional[int] = None
    description: str


class FullScanResponse(BaseModel):
    issues: List[ScanIssue] = []
    summary: str = ""


# ---- Kelime sayısı istatistikleri -------------------------------------------

class ChapterWordCount(BaseModel):
    chapter_number: int
    title: str
    word_count: int


class WordCountStats(BaseModel):
    total_words: int
    chapters: List[ChapterWordCount]


# ---- Değişiklik geçmişi (EntitySnapshot) ------------------------------------

class EntitySnapshotOut(BaseModel):
    """Bir varlığın bir alanının DEĞİŞMEDEN ÖNCEKİ hali - bkz. models.py
    EntitySnapshot yorumu. old_value alanın tipine göre str, dict ya da
    liste olabilir (field_name'e bakarak anlaşılır: sections->dict,
    aliases/tags->liste, geri kalanı->düz metin)."""
    id: int
    entity_type: str
    entity_id: int
    field_name: str
    old_value: Any
    saved_at: datetime

# ---- Üslup taraması (yazım tiki dedektörü) ----------------------------------

class StylePatternCreate(BaseModel):
    name: str
    pattern: str  # KÜÇÜK HARF regex - bkz. models.StylePattern yorumu
    threshold_per_1000: float = 2.0
    min_count: int = 5
    enabled: bool = True
    is_refrain: bool = False  # nakarat: sayılır ama asla uyarıya dönüşmez
    notes: str = ""


class StylePatternUpdate(BaseModel):
    name: Optional[str] = None
    pattern: Optional[str] = None
    threshold_per_1000: Optional[float] = None
    min_count: Optional[int] = None
    enabled: Optional[bool] = None
    is_refrain: Optional[bool] = None
    notes: Optional[str] = None


class StylePatternOut(BaseModel):
    id: int
    name: str
    pattern: str
    threshold_per_1000: float
    min_count: int
    enabled: bool
    is_refrain: bool = False
    notes: str
    created_at: datetime
    updated_at: datetime


class StyleWorstChapter(BaseModel):
    label: str
    count: int


class StylePatternResult(BaseModel):
    pattern_id: int
    name: str
    pattern: str
    count: int
    per_1000: float
    threshold_per_1000: float
    min_count: int
    exceeded: bool
    is_refrain: bool = False
    worst_chapters: List[StyleWorstChapter] = []


class StyleInvalidPattern(BaseModel):
    pattern_id: int
    name: str
    error: str


class StyleScanReport(BaseModel):
    """scanned=False -> bu evrende henüz hiç tarama yapılmamış (rapor boş).
    GET /style/report bunu 404 yerine bu bayrakla döner - frontend 'önce
    Tara'ya bas' mesajını buradan anlar."""
    scanned: bool = True
    scanned_at: Optional[datetime] = None
    total_words: int = 0
    chapter_count: int = 0
    patterns: List[StylePatternResult] = []
    invalid_patterns: List[StyleInvalidPattern] = []


# ---- Plan Matrisi -----------------------------------------------------------

class MatrixColumnCreate(BaseModel):
    label: str
    character_id: Optional[int] = None
    # Verilirse yeni kolon BU kolonun hemen SAĞINA girer (araya ekleme);
    # verilmezse en sağa. Yeniden adlandırmada (PUT) yok sayılır.
    after_column_id: Optional[int] = None


class MatrixRowCreate(BaseModel):
    label: str
    instructions: str = ""  # Talimat Kasası: bu aşamanın kalıcı yazım kısıtları
    kind: str = "main"  # main (ana başlık) | sub (ara başlık)
    # Verilirse yeni satır BU satırın hemen ALTINA girer (araya ekleme);
    # verilmezse en sona eklenir. Yeniden adlandırmada (PUT) yok sayılır.
    after_row_id: Optional[int] = None

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, v):
        if v not in ("main", "sub"):
            raise ValueError("kind 'main' ya da 'sub' olmalı")
        return v


class MatrixCreate(BaseModel):
    name: str
    # İlk kurulumda kolon/satır etiketleri topluca verilebilir - "8 sanık ×
    # 7 aşama"yı tek istekte kurmak için. Boş bırakılıp sonradan tek tek de
    # eklenebilir.
    columns: List[MatrixColumnCreate] = []
    rows: List[MatrixRowCreate] = []


class MatrixRename(BaseModel):
    name: str


class MatrixColumnOut(BaseModel):
    id: int
    position: int
    label: str
    character_id: Optional[int] = None


class MatrixRowOut(BaseModel):
    id: int
    position: int
    kind: str = "main"
    label: str
    instructions: str = ""


class MatrixCellUpsert(BaseModel):
    column_id: int
    row_id: int
    content: str = ""
    chapter_id: Optional[int] = None


class MatrixCellOut(BaseModel):
    id: int
    column_id: int
    row_id: int
    content: str
    chapter_id: Optional[int] = None
    chapter_number: Optional[int] = None  # bağlıysa, fihristteki sırası
    code: Optional[str] = None  # sabit referans kodu (MP1, MP2, ...)


class MatrixOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    columns: List[MatrixColumnOut] = []
    rows: List[MatrixRowOut] = []
    cells: List[MatrixCellOut] = []


class MatrixSummaryOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    column_count: int
    row_count: int
    filled_cell_count: int


class GenerateChaptersResponse(BaseModel):
    created_parts: int
    created_chapters: int
    linked_cells: int


# ---- Plan Matrisi AI doldurma -----------------------------------------------

class MatrixAiFillRequest(BaseModel):
    # Üstte çoktan seçmeli işaretlenen kolonlar - SADECE bunların boş
    # hücreleri doldurulur.
    column_ids: List[int]


class MatrixAiFillProposal(BaseModel):
    column_id: int
    row_id: int
    column_label: str
    row_label: str
    content: str


class MatrixAiFillResponse(BaseModel):
    """Öneriler - HİÇBİRİ kaydedilmedi. Kullanıcı gözden geçirip onayladığını
    normal hücre kaydıyla (PUT /matrix/{id}/cells) yazar."""
    proposals: List[MatrixAiFillProposal] = []
    skipped_columns: List[str] = []  # boş hücresi olmayan (zaten dolu) kolonlar


class ChapterPlanCell(BaseModel):
    """Roman menüsünde 'bu bölümün planı' kutusu için: bölüme bağlı matris
    hücreleri. AI'ya gidenle aynı içerik - yazar da görsün."""
    code: Optional[str] = None
    matrix_name: str
    column_label: str
    row_label: str
    content: str


# ---- Okur Testi -------------------------------------------------------------

class ReaderTestFinding(BaseModel):
    paragraph_number: Optional[int] = None  # None: model konumlayamadı
    quote: str = ""
    type: str = "diger"      # tempo|bilgi_bocasi|klise|anlasilirlik|gerilim|inandiricilik
    severity: str = "orta"   # yuksek|orta|dusuk
    reason: str
    suggestion: str = ""


class ReaderTestResponse(BaseModel):
    chapter_number: int
    findings: List[ReaderTestFinding] = []


class ParagraphEntitiesRequest(BaseModel):
    text: str


class ParagraphEntitiesResponse(BaseModel):
    """Paragraf balonları: her öğe AiSuggestion - existing_entity_id doluysa
    "mevcut kayda ekle" (K+ balonu), boşsa "yeni kayıt" (K balonu). Onay,
    mevcut /ai/approve-suggestions üzerinden yapılır."""
    suggestions: List[AiSuggestion] = []


class QuickPlanRequest(BaseModel):
    chapter_id: int
    content: str


class QuickPlanResponse(BaseModel):
    code: Optional[str] = None
    matrix_name: str
    content: str


class StylePatternCandidate(BaseModel):
    """AI'nın önerdiği kalıp adayı - KAYDEDİLMEZ, onaya sunulur."""
    name: str
    pattern: str
    example: str = ""
    why: str = ""
    sample_hits: int = 0


class StylePatternCandidateList(BaseModel):
    candidates: List[StylePatternCandidate] = []


class EventDateSuggestion(BaseModel):
    """AI'nın önerdiği gerçekleşme zamanı - KAYDEDİLMEZ, onaya sunulur."""
    occurred_at: str = ""
    story_date: str = ""
    reasoning: str = ""


class ColumnBindRequest(BaseModel):
    """Bir kolonu fihristteki bir ÜST GİRDİYE bağlar; satırlar o girdinin
    alt girdileriyle SIRAYLA eşleştirilir (1. satır -> 1. alt girdi ...)."""
    parent_chapter_id: int
    overwrite: bool = False   # zaten bağlı hücrelerin bağı değişsin mi


class ColumnBindResult(BaseModel):
    linked: List[str] = []      # "Aşama 1 → #4-1 KISIM ADI"
    skipped: List[str] = []     # eşleşecek alt girdi kalmadı / zaten bağlı


class OutlineNode(BaseModel):
    id: int
    display: str          # "1", "1-2", "1-2-3"
    level: int
    title: str
    kind: str
    child_count: int


class LiteraryScore(BaseModel):
    key: str
    label: str
    score: int
    reason: str = ""


class LiteraryFix(BaseModel):
    criterion: str = ""
    paragraph: Optional[int] = None
    problem: str = ""
    fix: str = ""


class LiteraryReviewResponse(BaseModel):
    """10 edebî ölçüt değerlendirmesi - kaydedilmez, rapor niteliğinde.
    scanned/total/chunks: KAPSAMA bilgisi - uzun bölümler parça parça
    taranır, kullanıcı ne kadarının incelendiğini görmelidir."""
    chapter_number: int
    scanned: int = 0
    total: int = 0
    chunks: int = 1
    scores: List[LiteraryScore] = []
    strongest: str = ""
    fixes: List[LiteraryFix] = []
    average: float = 0


class CausalityLink(BaseModel):
    from_chapter: int = Field(alias="from")
    to_chapter: int = Field(alias="to")
    link: str = ""
    problem: str = ""
    fix: str = ""
    model_config = ConfigDict(populate_by_name=True)


class RepetitionFinding(BaseModel):
    chapters: List[int] = []
    problem: str = ""
    fix: str = ""


class StakesTrend(BaseModel):
    trend: str = ""
    comment: str = ""


class ChapterNote(BaseModel):
    chapter: Optional[int] = None
    reason: str = ""
    problem: str = ""
    fix: str = ""


class StructureScanResponse(BaseModel):
    """Bölümler arası yapısal akış denetimi - özetlerle çalışır, metin göndermez."""
    summary: str = ""
    causality: List[CausalityLink] = []
    repetition: List[RepetitionFinding] = []
    stakes: StakesTrend = StakesTrend()
    dead_zones: List[ChapterNote] = []
    endings: List[ChapterNote] = []
    missing_summaries: List[int] = []


class VerifyRewriteRequest(BaseModel):
    old_text: str
    new_text: str
    purpose: str = ""      # paragrafın İŞLEVİ (varsa)
    neighbors: str = ""


class VerifyRewriteResponse(BaseModel):
    """Yazım sonrası kabul kontrolü. hard_issues deterministik (sayı/isim
    kaybı, yasak kalıp), issues AI değerlendirmesi."""
    verdict: str = "kabul"        # kabul | duzelt | red
    hard_issues: List[str] = []
    issues: List[str] = []
    note: str = ""
