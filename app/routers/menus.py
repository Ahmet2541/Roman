from .. import models, schemas
from .generic_crud import make_crud_router

characters_router = make_crud_router(
    models.Character, schemas.CharacterCreate, schemas.CharacterUpdate,
    schemas.CharacterOut, prefix="/characters", tag="Kişiler", entity_type="character",
)

places_router = make_crud_router(
    models.Place, schemas.PlaceCreate, schemas.PlaceUpdate,
    schemas.PlaceOut, prefix="/places", tag="Mekanlar", entity_type="place",
)

# Not: Olaylar artık burada değil - mekan/zaman/katılımcı ve çakışma kontrolü
# gerektiği için ayrı bir router'da (routers/events.py), main.py'de eklenir.

objects_router = make_crud_router(
    models.Object, schemas.SimpleEntityCreate, schemas.SimpleEntityUpdate,
    schemas.SimpleEntityOut, prefix="/objects", tag="Nesneler", entity_type="object",
)

foreshadowings_router = make_crud_router(
    models.Foreshadowing, schemas.ForeshadowingCreate, schemas.ForeshadowingUpdate,
    schemas.ForeshadowingOut, prefix="/foreshadowings", tag="İpuçları", entity_type="foreshadowing",
)

glossary_router = make_crud_router(
    models.GlossaryTerm, schemas.SimpleEntityCreate, schemas.SimpleEntityUpdate,
    schemas.SimpleEntityOut, prefix="/glossary", tag="Terimler", entity_type="term",
)

rules_router = make_crud_router(
    models.Rule, schemas.RuleCreate, schemas.RuleUpdate,
    schemas.RuleOut, prefix="/rules", tag="Roman Kuralları", entity_type="rule",
)

factions_router = make_crud_router(
    models.Faction, schemas.FactionCreate, schemas.FactionUpdate,
    schemas.FactionOut, prefix="/factions", tag="Faksiyonlar", entity_type="faction",
)

ALL_MENU_ROUTERS = [
    characters_router, places_router,
    objects_router, foreshadowings_router, glossary_router, rules_router,
    factions_router,
]
