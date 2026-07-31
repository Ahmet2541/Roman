"""Menü isimlerini (entity_type) ilgili SQLAlchemy modeline eşler.
Mention indeksi, context oluşturucu ve generic CRUD router bu haritayı kullanır."""

from . import models

ENTITY_MODELS = {
    "character": models.Character,
    "place": models.Place,
    "event": models.Event,
    "object": models.Object,
    "foreshadowing": models.Foreshadowing,
    "term": models.GlossaryTerm,
    "faction": models.Faction,
}

ENTITY_LABELS_TR = {
    "character": "KİŞİ",
    "place": "MEKAN",
    "event": "OLAY",
    "object": "NESNE",
    "foreshadowing": "İPUCU",
    "term": "TERİM",
    "faction": "FAKSİYON",
}
