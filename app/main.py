import logging
import re
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, HTMLResponse

from .database import Base, engine, SessionLocal
from . import auth
from .config import settings
from .encryption import get_fernet
from .migrations import run_startup_migrations
from .routers.menus import ALL_MENU_ROUTERS
from .routers.chapters import router as chapters_router
from .routers.ai import router as ai_router
from .routers.auth_router import router as auth_router
from .routers.events import router as events_router
from .routers.relationships import router as relationships_router
from .routers.progressions import router as progressions_router
from .routers.factions import router as faction_memberships_router
from .routers.entity_history import router as entity_history_router
from .routers.novels import router as novels_router
from .routers.universes import router as universes_router
from .routers.admin import router as admin_router
from .routers.style import router as style_router
from .routers.matrix import router as matrix_router

# Sunucu her başladığında (yani her deploy'da) DEĞİŞEN bir sürüm damgası -
# index.html/login.html'deki <script>/<link> etiketlerine "?v=..." olarak
# enjekte edilir. Amaç: tarayıcı önbelleği yüzünden "kodu güncelledim ama
# ekranda hiçbir şey değişmemiş" sorununu KÖKTEN çözmek - dosya adı (app.js)
# hiç değişmediği için tarayıcılar deploy sonrası bile eski sürümü
# önbellekten sunmaya devam edebiliyordu. Şimdi her deploy'da URL'nin
# kendisi değiştiği için (app.js?v=ESKİ -> app.js?v=YENİ) tarayıcı bunu
# HİÇ görmediği yeni bir dosya sanıp yeniden indirmek ZORUNDA kalıyor.
STATIC_VERSION = uuid.uuid4().hex[:10]

# ---- Loglama: sunucu tarafında bir şey ters giderse görebilmek için ----
LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "app.log", encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("roman_api")

# DB_ENCRYPTION_KEY eksik/hatalıysa uygulamayı hiç başlatma - yarı şifreli
# bir veritabanıyla çalışmaktansa en başta net bir hata vermek daha güvenli.
try:
    get_fernet()
except Exception as exc:
    raise SystemExit(f"\n[BAŞLATMA HATASI] {exc}\n")

Base.metadata.create_all(bind=engine)
run_startup_migrations(engine)

with SessionLocal() as db:
    auth.ensure_admin_user(db)

app = FastAPI(
    title="Roman Yazım Asistanı API",
    description="Karakter, mekan, olay, nesne, ipucu, terim ve roman kurallarını "
                "yöneten; Qwen (DashScope) ile bölüm yazımına destek olan API.",
    version="1.0.0",
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    try:
        response = await call_next(request)
        logger.info(f"{request.method} {request.url.path} -> {response.status_code}")
        return response
    except Exception:
        logger.exception(f"{request.method} {request.url.path} sırasında beklenmeyen hata")
        raise


# Not: internete açık deploy edildiğinde allow_origins'i kendi frontend
# adresinle sınırlandır (ör. ["https://roman.senin-domainin.com"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(novels_router)
app.include_router(universes_router)
for r in ALL_MENU_ROUTERS:
    app.include_router(r)
app.include_router(events_router)
app.include_router(relationships_router)
app.include_router(progressions_router)
app.include_router(faction_memberships_router)
app.include_router(entity_history_router)
app.include_router(chapters_router)
app.include_router(ai_router)
app.include_router(admin_router)
app.include_router(style_router)
app.include_router(matrix_router)

# Frontend (sol menü + sağ okuma/yazma ekranı) /app altında sunulur.
# API endpoint'leriyle çakışmaması için kök dizin ("/") yerine ayrı bir
# prefix kullanılıyor.
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


def _serve_versioned_html(filename: str) -> HTMLResponse:
    """index.html/login.html'i okuyup KENDİ dizinindeki .js/.css
    referanslarına "?v=STATIC_VERSION" ekler, sonra Cache-Control: no-store
    ile döner - böylece HTML'in KENDİSİ hiç önbelleklenmez (her istekte
    sunucudan taze gelir) ve içindeki script/link etiketleri her deploy'da
    değişen bir URL'ye işaret ettiği için tarayıcı app.js/style.css'i de
    yeniden indirmek zorunda kalır. login.js/api.js gibi diğer JS
    dosyaları da aynı şekilde kapsanıyor (genel regex, tek tek isim
    saymaya gerek yok)."""
    path = FRONTEND_DIR / filename
    html = path.read_text(encoding="utf-8")

    def _add_version(match: "re.Match") -> str:
        attr, url = match.group(1), match.group(2)
        if url.startswith(("http://", "https://", "//")):
            return match.group(0)  # dış bir CDN linkiyse (ör. Google Fonts) dokunma
        sep = "&" if "?" in url else "?"
        return f'{attr}="{url}{sep}v={STATIC_VERSION}"'

    html = re.sub(r'(src|href)="([^"]+\.(?:js|css))"', _add_version, html)
    return HTMLResponse(content=html, headers={"Cache-Control": "no-store, must-revalidate"})


if FRONTEND_DIR.exists():
    # ÖNEMLİ: bu iki route, aşağıdaki app.mount("/app", ...)'tan ÖNCE
    # tanımlanmalı - FastAPI/Starlette route'ları kayıt sırasına göre
    # eşleştirir, bu yüzden daha spesifik olan bu ikisi önce gelmezse
    # mount'un genel dosya sunumu bunları (versiyonsuz, ham haliyle) ele
    # geçirirdi.
    @app.get("/app/", include_in_schema=False)
    @app.get("/app/index.html", include_in_schema=False)
    def serve_index():
        return _serve_versioned_html("index.html")

    @app.get("/app/login.html", include_in_schema=False)
    def serve_login():
        return _serve_versioned_html("login.html")

    app.mount("/app", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


@app.get("/health")
def health():
    """Railway ve benzeri platformların healthcheck kontrolü için - DB'ye
    dokunmadan hızlıca 200 döner."""
    return {"status": "ok"}


@app.get("/")
def root():
    if FRONTEND_DIR.exists():
        return RedirectResponse("/app/")
    return {"status": "ok", "docs": "/docs"}
