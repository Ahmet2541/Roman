"""Üslup taraması (yazım tiki dedektörü) - motor katmanı.

Ne yapar: StylePattern tablosundaki regex'leri, evrendeki TÜM kitapların
TÜM bölüm metinlerinde sayar; 1000 kelime başına yoğunluk hesaplar; hangi
bölümlerde yoğunlaştığını bulur; sonucu StyleScanResult'a önbellekler.
build_style_warning_layer() bu önbellekten okuyup SADECE eşiği aşan
kalıpları AI context'ine "bundan kaçın" uyarısı olarak formatlar.

Neden önbellek: 12.000 sayfalık bir seride her AI isteğinde tam tarama
yapmak felaket olurdu. full_scan/Tutarlılık Taraması ile aynı desen:
elle tetiklenir, sonuç saklanır, istekler ucuz okuma yapar.

Neden çift eşik (yoğunluk VE mutlak sayı): kısa bir metinde tek bir
kelime bile yoğunluğu patlatır (10 kelimede 1 tekrar = binde 100).
min_count bu sınıf yanlış alarmı kökten kapatır.

Türkçe notu: Python'un re.IGNORECASE'i Türkçe İ/ı ayrımını bilmez
('İ'.lower() -> 'i̇' birleşik noktalı!). Bu yüzden metin _tr_lower ile
Türkçe'ye uygun küçültülür ve kalıpların KÜÇÜK HARFLE yazılması beklenir.
"""
import json
import logging
import re
from datetime import datetime

from sqlalchemy.orm import Session

from . import models

logger = logging.getLogger("roman_api.style_scan")


# ---------------------------------------------------------------------------
# Varsayılan kalıplar: bir evrende HİÇ kalıp yoksa bunlar tohum olarak
# eklenir (idempotent - varsa dokunulmaz). Kaynak: gerçek bir metin
# analizinde yakalanan tikler ("X yerine Y" retorik hamlesi 4 kez, yalın
# "gibi" her 20 kelimede bir vb.). Hepsi düzenlenebilir/silinebilir.
# ---------------------------------------------------------------------------
DEFAULT_PATTERNS = [
    {
        "name": "yalın 'gibi' benzetmesi",
        "pattern": r"\bgibi\w*",  # gibi, gibiydi, gibisine... hepsini yakalar
        "threshold_per_1000": 3.0,
        "min_count": 5,
        "notes": "Benzetme tiki. Ekli halleri (gibiydi, gibisine) de sayılır.",
    },
    {
        "name": "'sanki' benzetmesi",
        "pattern": r"\bsanki\b",
        "threshold_per_1000": 1.5,
        "min_count": 4,
        "notes": "Genellikle 'sanki ... gibi' ile birlikte gelir; tek başına da tik.",
    },
    {
        "name": "'adeta'",
        "pattern": r"\b[aâ]deta\b",
        "threshold_per_1000": 1.0,
        "min_count": 3,
        "notes": "",
    },
    {
        "name": "'neredeyse'",
        "pattern": r"\bneredeyse\b",
        "threshold_per_1000": 1.5,
        "min_count": 4,
        "notes": "",
    },
    {
        "name": "'X yerine Y' karşıtlık kalıbı",
        "pattern": r"\byerine\b",
        "threshold_per_1000": 1.5,
        "min_count": 4,
        "notes": "Önce beklenen imgeyi kurup 'aslında tersi' deme hamlesi.",
    },
    {
        "name": "'X değil Y' karşıtlık kalıbı",
        "pattern": r"\bdeğild?\w*",  # değil, değildi, değilmiş...
        "threshold_per_1000": 2.0,
        "min_count": 5,
        "notes": "Retorik olumsuzlamayla karşıtlık kurma tiki.",
    },
    {
        "name": "üçleme: 'aynı X, aynı Y, aynı Z'",
        "pattern": r"\baynı\s+\S+,\s*aynı\s+\S+,\s*aynı\b",
        "threshold_per_1000": 0.4,
        "min_count": 2,
        "notes": "Paralel üçleme tiki. Bilinçli kullanımı güçlüdür; sorun tekrarıdır.",
    },
    {
        "name": "üçleme: aynı fiille biten ardışık kısa cümleler",
        # "Cihaza baktı. Meydana baktı. Ekrana baktı." gibi merdivenler
        "pattern": r"\b(\w+)(dı|di|du|dü|tı|ti|tu|tü)\.\s+\S+\s+\1\2\.\s+\S+\s+\1\2\.",
        "threshold_per_1000": 0.4,
        "min_count": 2,
        "notes": "Aynı fiilin üç kez arka arkaya cümle sonunda tekrarı.",
    },
    {
        "name": "'bir kez gezindi/dolandı' jesti",
        "pattern": r"\bbir kez (gezin|dolan|dokun)\w*",
        "threshold_per_1000": 0.3,
        "min_count": 2,
        "notes": "El/parmak jesti klişesi - sahneler ARASINDA tekrar ediyor.",
    },
    {
        "name": "'Bir an. Sadece bir an.' fragman kalıbı",
        "pattern": r"\bbir an\.\s*sadece bir an\b",
        "threshold_per_1000": 0.3,
        "min_count": 2,
        "notes": "Fragman vurgusu - ilk kullanımda etkili, tekrarında tik.",
    },
    {
        "name": "'-mekten/-maktan çok' kalıbı",
        "pattern": r"\w+(?:mekten|maktan)\s+çok\b",
        "threshold_per_1000": 1.0,
        "min_count": 3,
        "notes": "'delmekten çok onu izlemek için' tarzı karşılaştırma hamlesi.",
    },
]


def _tr_lower(text: str) -> str:
    """Türkçe'ye uygun küçültme: İ->i, I->ı, sonra standart lower().
    Standart lower() 'İ'yi 'i̇' (i + birleşik nokta) yapar ve regex'ler
    beklenmedik biçimde kaçırır - bu iki replace onu önler."""
    return text.replace("İ", "i").replace("I", "ı").lower()


def seed_default_patterns(db: Session, universe_id: int) -> int:
    """Evrende hiç kalıp yoksa varsayılanları ekler. İdempotent: bir tane
    bile kalıp varsa (kullanıcı hepsini silmiş olsa dahi sonradan tekrar
    boşalırsa yeniden tohumlanır - bu kabul edilebilir) hiçbir şey yapmaz.
    Eklenen kayıt sayısını döner."""
    existing = (
        db.query(models.StylePattern)
        .filter(models.StylePattern.universe_id == universe_id)
        .count()
    )
    if existing:
        return 0
    for d in DEFAULT_PATTERNS:
        db.add(models.StylePattern(universe_id=universe_id, **d))
    db.commit()
    return len(DEFAULT_PATTERNS)


def _compile_patterns(patterns: list) -> tuple[list, list]:
    """(derlenmiş, hatalı) ikilisi döner. Hatalı bir regex TÜM taramayı
    düşürmemeli - atlanır ve raporda 'invalid_patterns' altında kullanıcıya
    gösterilir ki sessizce yutulmasın."""
    compiled, invalid = [], []
    for p in patterns:
        try:
            compiled.append((p, re.compile(p.pattern)))
        except re.error as exc:
            invalid.append({"pattern_id": p.id, "name": p.name, "error": str(exc)})
    return compiled, invalid


def scan_universe(db: Session, universe_id: int) -> dict:
    """Evrendeki tüm kitapların tüm 'chapter' türü bölümlerini tek geçişte
    tarar. 'part'/'subtitle' girdileri atlanır (içerikleri yok, sadece yapı
    - fihrist/full_scan ile aynı kural).

    Dönen rapor JSON-uyumludur (önbelleğe olduğu gibi yazılır):
    {
      "scanned_at": ISO, "total_words": int, "chapter_count": int,
      "patterns": [{pattern_id, name, pattern, count, per_1000,
                    threshold_per_1000, min_count, exceeded,
                    worst_chapters: [{label, count}]}],
      "invalid_patterns": [{pattern_id, name, error}]
    }
    """
    patterns = (
        db.query(models.StylePattern)
        .filter(
            models.StylePattern.universe_id == universe_id,
            models.StylePattern.enabled == True,  # noqa: E712
        )
        .all()
    )
    compiled, invalid = _compile_patterns(patterns)

    novels = (
        db.query(models.Novel)
        .filter(models.Novel.universe_id == universe_id)
        .all()
    )
    novels.sort(key=lambda n: (n.book_number is None, n.book_number or 0, n.id))
    multi_book = len(novels) > 1

    total_words = 0
    chapter_count = 0
    # pattern_id -> toplam sayım; pattern_id -> [(label, count), ...]
    totals: dict[int, int] = {p.id: 0 for p, _ in compiled}
    per_chapter: dict[int, list] = {p.id: [] for p, _ in compiled}

    for novel in novels:
        chapters = (
            db.query(models.Chapter)
            .filter(models.Chapter.novel_id == novel.id, models.Chapter.kind == "chapter")
            .order_by(models.Chapter.number)
            .all()
        )
        for ch in chapters:
            text = "\n".join(par.text for par in ch.paragraphs if par.text)
            if not text.strip():
                continue
            chapter_count += 1
            norm = _tr_lower(text)
            total_words += len(norm.split())
            if multi_book:
                book_label = f"Kitap {novel.book_number}" if novel.book_number else novel.name
                label = f"{book_label}, Bölüm {ch.number}"
            else:
                label = f"Bölüm {ch.number}"
            for p, rx in compiled:
                n = len(rx.findall(norm))
                if n:
                    totals[p.id] += n
                    per_chapter[p.id].append({"label": label, "count": n})

    results = []
    for p, _rx in compiled:
        count = totals[p.id]
        per_1000 = round(count / total_words * 1000, 1) if total_words else 0.0
        # ÇİFT koşul: yoğunluk eşiği VE mutlak minimum - ikisi birden
        # sağlanmadan "aşırı kullanım" denmez (kısa metin yanlış alarmı önlenir).
        # Nakarat işaretli kalıp asla "aşırı" sayılmaz - bilinçli leitmotif.
        exceeded = (
            not p.is_refrain
            and per_1000 >= (p.threshold_per_1000 or 0)
            and count >= (p.min_count or 0)
        )
        worst = sorted(per_chapter[p.id], key=lambda w: -w["count"])[:3]
        results.append({
            "pattern_id": p.id,
            "name": p.name,
            "pattern": p.pattern,
            "count": count,
            "per_1000": per_1000,
            "threshold_per_1000": p.threshold_per_1000,
            "min_count": p.min_count,
            "exceeded": exceeded,
            "is_refrain": bool(p.is_refrain),
            "worst_chapters": worst,
        })
    # Aşanlar önce, sonra sayıya göre - rapor okunuşu için
    results.sort(key=lambda r: (not r["exceeded"], -r["count"]))

    return {
        "scanned_at": datetime.utcnow().isoformat(),
        "total_words": total_words,
        "chapter_count": chapter_count,
        "patterns": results,
        "invalid_patterns": invalid,
    }


def save_scan_result(db: Session, universe_id: int, report: dict) -> None:
    """Evren başına tek satır: varsa üzerine yazar, yoksa oluşturur."""
    row = (
        db.query(models.StyleScanResult)
        .filter(models.StyleScanResult.universe_id == universe_id)
        .first()
    )
    payload = json.dumps(report, ensure_ascii=False)
    if row:
        row.result_json = payload
        row.scanned_at = datetime.utcnow()
    else:
        db.add(models.StyleScanResult(universe_id=universe_id, result_json=payload))
    db.commit()


def load_scan_result(db: Session, universe_id: int) -> dict | None:
    row = (
        db.query(models.StyleScanResult)
        .filter(models.StyleScanResult.universe_id == universe_id)
        .first()
    )
    if not row:
        return None
    try:
        return json.loads(row.result_json)
    except (json.JSONDecodeError, TypeError):
        logger.warning("Bozuk üslup tarama önbelleği (universe_id=%s) - yok sayılıyor", universe_id)
        return None


def run_scan_and_cache(db: Session, universe_id: int) -> dict:
    """Router'ın çağırdığı tek kapı: tohumla (gerekirse) -> tara -> önbellekle."""
    seed_default_patterns(db, universe_id)
    report = scan_universe(db, universe_id)
    save_scan_result(db, universe_id, report)
    return report


def build_style_warning_layer(db: Session, universe_id: int) -> str:
    """AI context'ine giren üslup uyarısı katmanı. SADECE önbellekten okur
    (canlı tarama YAPMAZ - her AI isteğinde ucuz kalması tasarımın özü) ve
    SADECE eşiği aşan kalıpları içerir. Hiç tarama yapılmamışsa ya da hiçbir
    kalıp eşiği aşmıyorsa boş string döner (context'e hiç girmez).

    Not: build_style_layer (stil ÖRNEKLERİ - "böyle yaz") ile karıştırma;
    bu katman tam tersi yönde çalışır ("böyle YAZMA")."""
    report = load_scan_result(db, universe_id)
    if not report:
        return ""
    exceeded = [p for p in report.get("patterns", []) if p.get("exceeded")]
    if not exceeded:
        return ""
    lines = [
        "=== ÜSLUP UYARILARI (aşırı kullanılan kalıplar) ===",
        "Aşağıdaki ifade kalıpları bu seride zaten çok kullanılmış. Bunlar "
        "kötü araçlar DEĞİL - sorun bütçesiz tekrarlanmaları. Bu yüzden: "
        "yazacağın metinde her kalıbı EN FAZLA BİR KEZ kullan, mümkünse hiç "
        "kullanma; aynı etkiyi farklı bir teknikle ver (duyusal detay, güçlü "
        "fiil, ölçek karşıtlığı, sessizlik, nesne üzerinden gösterme):",
    ]
    for p in exceeded:
        worst = ", ".join(f"{w['label']} ({w['count']}×)" for w in p.get("worst_chapters", [])[:3])
        line = f"- {p['name']}: toplam {p['count']} kez (1000 kelimede {p['per_1000']})"
        if worst:
            line += f". En yoğun: {worst}"
        lines.append(line)
    return "\n".join(lines)
