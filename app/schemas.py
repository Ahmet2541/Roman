from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, ConfigDict


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


class CharacterUpdate(SimpleEntityUpdate):
    status: Optional[str] = None


class CharacterOut(SimpleEntityOut):
    status: str


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


class EventConflict(BaseModel):
    story_key: str
    event_a: str
    event_b: str
    shared_characters: List[str]


# ---- Roman kuralları --------------------------------------------------------

class RuleBase(BaseModel):
    title: str
    description: str = ""


class RuleCreate(RuleBase):
    pass


class RuleUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None


class RuleOut(RuleBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime


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


class ChapterUpdate(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None


class ChapterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    number: int
    title: str
    summary: str
    paragraphs: List[ParagraphOut] = []


class ChapterListOut(BaseModel):
    """Fihrist satırı. summary burada dönüyor çünkü fihrist artık sadece bir
    liste değil - romanın merkezi özet katmanının dışa açılan yüzü."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    number: int
    title: str
    summary: str


class ChapterSummaryGenerateResponse(BaseModel):
    """POST /chapters/{id}/generate-summary yanıtı. Taslak niteliğindedir,
    kaydedilmez - kullanıcı onaylarsa mevcut PUT /chapters/{id} (summary
    alanı) ile kaydedilir."""
    chapter_id: int
    generated_summary: str


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


class AiSuggestion(BaseModel):
    entity_type: str
    name: str
    description: str = ""
    # None -> yeni kayıt oluşturulacak. Dolu -> var olan kaydın notlarına eklenecek
    # (mevcut açıklama silinmez, yeni bilgi 'notes' alanına eklenir).
    existing_entity_id: Optional[int] = None


class AiAssistResponse(BaseModel):
    generated_text: str
    consistency_notes: List[str] = []
    new_entity_suggestions: List[AiSuggestion] = []


class ApproveSuggestionsRequest(BaseModel):
    suggestions: List[AiSuggestion]


# ---- AI bağlam önizleme ("prompt preview") ---------------------------------

class ContextPreviewRequest(BaseModel):
    chapter_number: Optional[int] = None
    selected_entities: List[EntityRef] = []


class ContextPreviewResponse(BaseModel):
    context: str
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
