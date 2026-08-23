"""PLAN MATRİSİ İÇE AKTARIM: dışa aktarılan JSON'u geri yükler.

Neden basit bir "kaydet"ten ibaret değil:

1. VARLIK ID'LERİ KAYNAK EVRENE AİT. Hücrelerde kişi/mekan/nesne ID'leri
   yazılı; başka bir kitaba (başka bir evrene) yüklenirse o ID'ler YANLIŞ
   kayda işaret eder - "Genç Mühendis" diye kaydedilmiş bir hücre, hedef
   evrende o ID'ye sahip bambaşka biriyle eşleşir. Bu yüzden ID'ler ADLA
   yeniden çözülür; ad bulunamazsa ID düşürülür, ad serbest metin kalır.

2. MP KODLARI ROMAN BAZINDA BENZERSİZ. Dosyadaki kodlar hedef romanda
   başka hücrelere ait olabilir. Yeniden üretilir.

3. BÖLÜM BAĞLARI numaraya göre kurulur; o numarada bölüm yoksa hücre
   BAĞSIZ kalır ve raporda söylenir - sessizce yanlış bölüme bağlamaktansa
   bağsız bırakmak doğru.

Mevcut matrislerin üzerine YAZILMAZ; her zaman yeni matris oluşturulur.
Adı çakışırsa sonuna "(içe aktarıldı)" eklenir.
"""
from . import models, plan_schema


def _tr_lower(metin) -> str:
    return str(metin or "").replace("İ", "i").replace("I", "ı").lower()


def _ad_haritasi(db, universe_id: int) -> dict:
    """{("character", "genç mühendis"): 12, ...} - adla ID çözmek için."""
    harita = {}
    # ENTITY_MODELS tek doğru kaynak - model adını elle yazmak, adı
    # değişince sessizce bozulan bir bağ bırakır.
    from .entities import ENTITY_MODELS
    for tip in ("character", "place", "object"):
        model = ENTITY_MODELS[tip]
        for kayit in db.query(model).filter(model.universe_id == universe_id).all():
            harita[(tip, _tr_lower(kayit.name))] = kayit.id
            for takma in (kayit.aliases or []):
                harita.setdefault((tip, _tr_lower(takma)), kayit.id)
    return harita


def _veriyi_cevir(veri: dict, harita: dict, rapor: dict) -> dict:
    """Hücre verisindeki varlık ID'lerini hedef evrene göre yeniden çözer."""
    d = plan_schema.normalize_cell(veri)

    for k in d["kisiler"]:
        yeni = harita.get(("character", _tr_lower(k["ad"])))
        k["id"] = yeni
        rapor["cozulen" if yeni else "cozulemeyen"] += 1
    for n in d["nesneler"]:
        yeni = harita.get(("object", _tr_lower(n["ad"])))
        n["id"] = yeni
        rapor["cozulen" if yeni else "cozulemeyen"] += 1
    if d["mekan"]:
        yeni = harita.get(("place", _tr_lower(d["mekan"])))
        d["mekan_id"] = yeni
        rapor["cozulen" if yeni else "cozulemeyen"] += 1
    else:
        d["mekan_id"] = None
    return d


def import_json(db, novel_id: int, universe_id: int, veri: dict, kod_uret) -> dict:
    """Dosyayı okur, yeni matrisler oluşturur, raporu döner.

    kod_uret: MP kodu üreten fonksiyon (router'dan geçirilir - kod sayacı
    roman bazında çalıştığı için orada durur).
    """
    if not isinstance(veri, dict) or not isinstance(veri.get("matrisler"), list):
        raise ValueError("Dosya bir plan matrisi dışa aktarımı değil "
                         "('matrisler' listesi bulunamadı).")

    harita = _ad_haritasi(db, universe_id)
    bolum_no = {
        c.number: c.id
        for c in db.query(models.Chapter).filter(models.Chapter.novel_id == novel_id).all()
    }
    mevcut_adlar = {
        _tr_lower(m.name)
        for m in db.query(models.PlanMatrix).filter(models.PlanMatrix.novel_id == novel_id).all()
    }
    son_sira = max(
        (m.position or 0 for m in
         db.query(models.PlanMatrix).filter(models.PlanMatrix.novel_id == novel_id).all()),
        default=0)

    rapor = {"matris": 0, "kolon": 0, "satir": 0, "hucre": 0,
             "baglanan": 0, "baglanamayan": 0,
             "cozulen": 0, "cozulemeyen": 0, "uyarilar": []}

    for m_veri in veri["matrisler"]:
        ad = str(m_veri.get("ad") or "İçe aktarılan matris").strip()
        if _tr_lower(ad) in mevcut_adlar:
            ad = f"{ad} (içe aktarıldı)"
        mevcut_adlar.add(_tr_lower(ad))

        son_sira += 1
        matris = models.PlanMatrix(novel_id=novel_id, name=ad, position=son_sira)
        db.add(matris)
        db.flush()
        rapor["matris"] += 1

        kolonlar = {}
        for i, c in enumerate(m_veri.get("turlar") or [], start=1):
            col = models.MatrixColumn(
                matrix_id=matris.id, position=i,
                label=str(c.get("etiket") or f"Tur {i}"),
                tur_data=plan_schema.normalize_meta(
                    c.get("tur_mirasi"), plan_schema.TUR_ALANLARI),
            )
            db.add(col)
            db.flush()
            kolonlar[col.label] = col
            rapor["kolon"] += 1

        satirlar = {}
        for i, r in enumerate(m_veri.get("asamalar") or [], start=1):
            row = models.MatrixRow(
                matrix_id=matris.id, position=i,
                label=str(r.get("etiket") or f"Aşama {i}"),
                kind=("sub" if r.get("tur") == "sub" else "main"),
                instructions=str(r.get("yazim_kisitlari") or ""),
                parca_data=plan_schema.normalize_meta(
                    r.get("parca_mirasi"), plan_schema.PARCA_ALANLARI),
            )
            db.add(row)
            db.flush()
            satirlar[row.label] = row
            rapor["satir"] += 1

        for h in m_veri.get("hucreler") or []:
            col = kolonlar.get(str(h.get("kolon") or ""))
            row = satirlar.get(str(h.get("satir") or ""))
            if col is None or row is None:
                rapor["uyarilar"].append(
                    f"Hücre atlandı: kolon/satır eşleşmedi ({h.get('kolon')} × {h.get('satir')})")
                continue

            data = _veriyi_cevir(h.get("veri"), harita, rapor)
            # Metin YENİDEN ÜRETİLİR (dosyadaki bayat olabilir), ama
            # yapılandırılmış veri boşsa eski serbest metin korunur.
            icerik = plan_schema.render_cell(data)
            if not icerik and h.get("metin"):
                icerik = str(h["metin"])

            chapter_id = None
            if h.get("bolum") is not None:
                chapter_id = bolum_no.get(h["bolum"])
                if chapter_id:
                    rapor["baglanan"] += 1
                else:
                    rapor["baglanamayan"] += 1
                    rapor["uyarilar"].append(
                        f"Bölüm {h['bolum']} bu kitapta yok - hücre bağsız bırakıldı")

            db.add(models.MatrixCell(
                matrix_id=matris.id, column_id=col.id, row_id=row.id,
                content=icerik, data=data, chapter_id=chapter_id,
                code=kod_uret(db, novel_id),
            ))
            db.flush()
            rapor["hucre"] += 1

    db.commit()
    # Uyarı listesi uzayabilir - ilk onu göster, gerisini say.
    if len(rapor["uyarilar"]) > 10:
        kalan = len(rapor["uyarilar"]) - 10
        rapor["uyarilar"] = rapor["uyarilar"][:10] + [f"… ve {kalan} uyarı daha"]
    return rapor
