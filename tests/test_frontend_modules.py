"""Arayüz modüllerinin bütünlüğü.

app.js 9.000 satıra ulaşmıştı; her düzenleme başka bir yeri kırma riski
taşıyordu (bu sohbette birkaç kez oldu). Dosya modüllere bölündü - ama
modül SİSTEMİ kullanılmıyor: dosyalar sırayla yükleniyor ve tüm tanımlar
global kapsamda kalıyor, böylece davranış birebir korunuyor.

Bu testler bölünmenin bozulmadığını garanti eder.
"""
import re
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
MODULES = FRONTEND / "js" / "modules"


def _module_files():
    return sorted(MODULES.glob("*.js"))


def test_modules_exist_and_are_ordered():
    """Modüller var ve numaralı sırada - yükleme sırası davranışı etkiler."""
    dosyalar = _module_files()
    assert len(dosyalar) >= 8, "modüller bulunamadı"
    # Ad biçimi: "08-review.js" ya da "08b-checks.js" (aynı numaranın alt
    # adımı). Sıralama bozulmamalı - yükleme sırası davranışı etkiler.
    anahtarlar = [f.name.split("-")[0] for f in dosyalar]
    assert anahtarlar == sorted(anahtarlar), f"sıra bozuk: {anahtarlar}"
    ana_numaralar = sorted({int(re.match(r"\d+", a).group()) for a in anahtarlar})
    assert ana_numaralar == list(range(1, len(ana_numaralar) + 1)), f"numara boşluğu: {ana_numaralar}"


def test_index_html_loads_every_module_in_order():
    """index.html HER modülü ve DOĞRU sırada yüklemeli - biri unutulursa
    o ekran sessizce çalışmaz (fonksiyon tanımsız kalır)."""
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    yuklenen = re.findall(r'src="js/modules/([\w.-]+\.js)"', html)
    diskteki = [f.name for f in _module_files()]
    assert yuklenen == diskteki, f"eksik/sırasız: html={yuklenen} disk={diskteki}"
    assert "js/app.js" not in html, "bölünmüş dosya hâlâ yükleniyor"


@pytest.mark.skipif(
    subprocess.run(["which", "node"], capture_output=True).returncode != 0,
    reason="node yok",
)
def test_every_module_is_syntactically_valid():
    """Her modül tek başına geçerli olmalı - bölme sınırı bir fonksiyonun
    ortasından geçerse sayfa HİÇ açılmaz."""
    for f in _module_files():
        r = subprocess.run(["node", "--check", str(f)], capture_output=True, text=True)
        assert r.returncode == 0, f"{f.name} sözdizimi hatalı:\n{r.stderr[:400]}"


def test_no_duplicate_top_level_definitions():
    """Aynı fonksiyon iki modülde tanımlıysa sonradan yüklenen sessizce
    öncekini EZER - bu sohbette yaşanan 'yinelenen satır' hatasının
    modüllerdeki karşılığı."""
    gorulen = {}
    yinelenen = []
    for f in _module_files():
        for satir in f.read_text(encoding="utf-8").split("\n"):
            m = re.match(r"^(?:async function|function)\s+(\w+)", satir)
            if m:
                ad = m.group(1)
                if ad in gorulen:
                    yinelenen.append(f"{ad}: {gorulen[ad]} ve {f.name}")
                gorulen[ad] = f.name
    assert not yinelenen, "yinelenen tanımlar:\n" + "\n".join(yinelenen)


def test_critical_functions_are_defined_somewhere():
    """Kritik akışların giriş noktaları kaybolmamalı - bölme sırasında bir
    parça düşerse ilgili ekran hiç açılmaz."""
    tumu = "\n".join(f.read_text(encoding="utf-8") for f in _module_files())
    kritik = [
        "switchView", "renderRomanView", "renderReader", "renderAiPanel",
        "renderMatrixView", "renderDenetimView", "openChapterWorkshop",
        "workshopFix", "verifyBeforeApply", "replaceParagraphText",
        "renderKnowledgeView", "runArcReview", "el",
    ]
    for ad in kritik:
        assert re.search(rf"^(?:async function|function|const)\s+{ad}\b", tumu, re.M), \
            f"{ad} hiçbir modülde tanımlı değil"


def test_paragraph_chat_frame_has_two_clear_modes():
    """SOHBET ÇERÇEVESİ ÇELİŞKİSİ: eskiden hem "paragrafı yeniden yazma"
    hem "yeniden yazım isterse üret" deniyordu. Model çelişkiyi metni
    SOHBETE GÖMEREK çözdü - kullanıcının önerisi uygulanamadan kayboldu
    ve üstüne "hangisini tercih edersin?" diye sordu."""
    modules = Path(__file__).resolve().parent.parent / "frontend" / "js" / "modules"
    js = "\n".join(f.read_text(encoding="utf-8") for f in sorted(modules.glob("*.js")))

    assert "İKİ MOD VAR" in js, "mod ayrımı yok"
    assert "(A) TARTIŞMA" in js and "(B) UYGULAMA" in js
    # Kullanıcının kendi cümlesi TARTIŞILMAZ, uygulanır
    assert "KENDİ CÜMLESİNİ yazdıysa" in js
    # Metni sohbete gömme yasağı
    assert "sohbet cevabının İÇİNE yazma" in js
    # İzin isteme yasağı
    assert "hangisini tercih edersin" in js.lower()
    # Çelişkili eski talimat kalmamalı
    assert "Paragrafı YENİDEN YAZMA - kullanıcı hazır olduğunda" not in js
