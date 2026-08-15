"""Arayüz DAVRANIŞ testleri (Node + DOM taklidi).

Neden gerekli: bu projede yaşanan arayüz hatalarının hepsini kullanıcı
buldu, test değil - "3 öneri çalışmıyor" (tanımsız değişken), "Cannot set
properties of null" (olmayan elemana yazma), "öneri boş geliyor" (Türkçe
I/ı yüzünden ayrıştırma çökmesi). Bu testler tam bu sınıfı yakalar.

Gerçek tarayıcı gerekmez: modüller Node'da minimal bir DOM taklidiyle
çalıştırılır. Amaç piksel doğruluğu değil, mantık doğruluğu.
"""
import json
import subprocess
from pathlib import Path

import pytest

KOSUCU = Path(__file__).resolve().parent / "js" / "smoke.js"
NODE_VAR = subprocess.run(["which", "node"], capture_output=True).returncode == 0

pytestmark = pytest.mark.skipif(not NODE_VAR, reason="node yok")


def _calistir():
    r = subprocess.run(["node", str(KOSUCU)], capture_output=True, text=True, timeout=90)
    assert r.returncode == 0, f"koşucu çöktü:\n{r.stderr[:800]}"
    return json.loads(r.stdout)


@pytest.fixture(scope="module")
def sonuc():
    return _calistir()


def test_all_modules_load_without_error(sonuc):
    """Modüller tarayıcıdaki gibi SIRAYLA yüklenmeli ve hiçbiri çalışma
    zamanı hatası vermemeli - bir modül patlarsa sonrakiler hiç tanımlanmaz
    ve o ekranlar sessizce ölür."""
    assert sonuc["hatalar"] == [], f"modül yükleme hatası: {sonuc['hatalar']}"
    assert len(sonuc["yuklendi"]) >= 8


def test_behavior_checks_pass(sonuc):
    """Kritik davranışlar: fonksiyonların varlığı, güvenli eleman erişimi,
    seçenek ayrıştırma, deterministik kontrol, direktif sentezi, fark
    vurgulama."""
    basarisiz = [t for t in sonuc["testler"] if not t["ok"]]
    assert not basarisiz, "başarısız davranış testleri:\n" + "\n".join(
        f"  - {t['ad']}: {t.get('hata')}" for t in basarisiz
    )


def test_every_frontend_ai_call_has_a_backend_route():
    """Arayüzün çağırdığı her AI ucu backend'de VAR olmalı. Bu sohbette
    tam olarak bu hata yaşandı: /chapters/{id}/suggest-entities çağrılıyordu
    ama uç yoktu; istek sessizce 404 alıyor, hiçbir öneri gelmiyordu."""
    import os
    import re
    from cryptography.fernet import Fernet

    os.environ.setdefault("DB_ENCRYPTION_KEY", Fernet.generate_key().decode())
    from app.main import app

    gercek = set()
    for path, ops in app.openapi()["paths"].items():
        for method in ops:
            gercek.add((method.lower(), re.sub(r"\{[^}]+\}", "{}", path).rstrip("/")))

    modules = Path(__file__).resolve().parent.parent / "frontend" / "js" / "modules"
    js = "\n".join(f.read_text(encoding="utf-8") for f in sorted(modules.glob("*.js")))

    eksik = []
    for m in re.finditer(r"api\.(get|post|put|del)\(\s*[`'\"]([^`'\"]+)", js):
        yontem = {"get": "get", "post": "post", "put": "put", "del": "delete"}[m.group(1)]
        yol = re.sub(r"\$\{[^}]+\}", "{}", m.group(2)).split("?")[0].rstrip("/")
        if not yol.startswith("/"):
            continue
        if not any(r == (yontem, yol) for r in gercek):
            eksik.append(f"{yontem.upper()} {yol}")
    assert not eksik, "backend'de karşılığı olmayan çağrılar: " + ", ".join(sorted(set(eksik)))


def test_client_error_agent_records_and_deduplicates(client, headers):
    """HATA AJANI: tarayıcı hataları sunucuya bildirilir, bağlamıyla
    saklanır ve TEKRARLAR birleştirilir. Amaç: kullanıcının ekran
    görüntüsü almasına gerek kalmaması."""
    for _ in range(3):
        r = client.post("/diagnostics/client-error", json={
            "message": "Cannot set properties of null (setting 'innerHTML')",
            "stack": "at renderReader (03-chapters.js:1520)",
            "view": "denetim", "action": "3 öneri getir",
        }, headers=headers)
        assert r.status_code == 204

    client.post("/diagnostics/client-error", json={
        "message": "Farklı bir hata", "view": "roman",
    }, headers=headers)

    kayitlar = client.get("/diagnostics/client-errors", headers=headers).json()
    assert len(kayitlar) == 2, "aynı hata tek kayıtta birleşmeli"
    ilk = next(k for k in kayitlar if "innerHTML" in k["message"])
    assert ilk["count"] == 3
    assert ilk["view"] == "denetim" and ilk["action"] == "3 öneri getir"

    # Boş mesaj kayıt açmaz
    client.post("/diagnostics/client-error", json={"message": "   "}, headers=headers)
    assert len(client.get("/diagnostics/client-errors", headers=headers).json()) == 2

    client.delete("/diagnostics/client-errors", headers=headers)
    assert client.get("/diagnostics/client-errors", headers=headers).json() == []


def test_agent_records_non_crash_issues_by_kind(client, headers):
    """AJAN YALNIZCA ÇÖKMELERİ DEĞİL, akışı bozan HER ŞEYİ izler: sunucu
    hatası, ağ kesintisi, yavaş istek, AI'nın boş/eksik yanıtı. Bunlar
    eskiden hiçbir yere yazılmıyordu - kullanıcı ekran görüntüsü almak
    zorunda kalıyordu."""
    turler = ["sunucu_hatasi", "ag_hatasi", "yavas_istek", "bos_yanit", "istek_hatasi"]
    for t in turler:
        r = client.post("/diagnostics/client-error", json={
            "message": f"{t} örneği", "kind": t, "view": "denetim",
        }, headers=headers)
        assert r.status_code == 204

    kayitlar = client.get("/diagnostics/client-errors", headers=headers).json()
    assert {k["kind"] for k in kayitlar} == set(turler)

    # Geçersiz tür güvenli tarafa çekilir
    client.post("/diagnostics/client-error", json={
        "message": "uydurma tür", "kind": "saçma_tür",
    }, headers=headers)
    uydurma = next(k for k in client.get("/diagnostics/client-errors", headers=headers).json()
                   if k["message"] == "uydurma tür")
    assert uydurma["kind"] == "hata"

    client.delete("/diagnostics/client-errors", headers=headers)
