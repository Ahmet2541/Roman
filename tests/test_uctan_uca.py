"""UÇTAN UCA AKIŞ: kural → varlık → matris → fihrist → plan → bağlam →
taslak denetimi → sağlık → dışa/içe aktarım → el yazması.

Tek tek testler her halkayı ayrı ayrı doğruluyor ama ZİNCİRİ kimse
doğrulamıyordu. Bu oturumda birkaç kez, ayrı ayrı çalışan parçaların
birleşince koptuğu görüldü (plan varlıkları profil katmanına gitmiyordu,
story_date yanıtta taşınmıyordu). Bu test o kopmaları yakalar.
"""
import json


def _kur(client, headers):
    client.post("/rules/", json={"title": "Duygu",
                                 "description": "Duyguyu adlandırma."}, headers=headers)
    k = client.post("/characters/", json={
        "name": "İhtiyar Teknisyen", "aliases": ["usta"], "description": "Elektronikçi.",
        "var_olus": "3 Mayıs 1968",
        "sections": {"konusma_tarzi": "Kısa cümleler."}}, headers=headers).json()
    client.post("/characters/", json={
        "name": "Vicdan", "var_olus": "28 Haziran 2030 21:00"}, headers=headers)
    y = client.post("/places/", json={
        "name": "Lümen Vadisi", "description": "Cam vadi."}, headers=headers).json()
    client.post("/progressions/", json={
        "entity_type": "character", "entity_id": k["id"],
        "story_date": "1 Ocak 2023", "note": "Karısını kaybetti."}, headers=headers)
    client.post("/progressions/", json={
        "entity_type": "character", "entity_id": k["id"],
        "story_date": "7 Temmuz 2030", "note": "Suçluluğu kabul eder."}, headers=headers)

    m = client.post("/matrix/", json={
        "name": "Tur Yapısı", "columns": [{"label": "Tur 1"}],
        "rows": [{"label": "1 Varış", "kind": "main"}]}, headers=headers).json()
    c = m["columns"][0]["id"]
    client.post(f"/matrix/{m['id']}/rows",
                json={"label": "1a Alt sahne", "kind": "sub"}, headers=headers)
    client.put(f"/matrix/{m['id']}/columns/{c}",
               json={"label": "Tur 1", "tur_data": {"damga": "EMANET"}}, headers=headers)
    g = client.post(f"/matrix/{m['id']}/generate-chapters", headers=headers).json()

    full = client.get(f"/matrix/{m['id']}", headers=headers).json()
    bagli = [x for x in full["cells"] if x["chapter_id"]][0]
    bagsiz = [x for x in full["cells"] if not x["chapter_id"]][0]
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": c, "row_id": bagli["row_id"],
        "data": {"olay": "İhtiyar teknisyen vadiye varır.",
                 "mekan": "Lümen Vadisi", "mekan_id": y["id"],
                 "zaman": {"tarih": "28 Haziran 2030", "saat": "13:30", "tip": "NOKTA"},
                 "ortam": {"baslangic": "huzur"},
                 "kisiler": [{"id": k["id"], "ad": "İhtiyar Teknisyen",
                              "duygu": {"baslangic": "umut", "bitis": "keder"}}],
                 "nesneler": [{"ad": "mendil"}], "odak": "mendil",
                 "giris": ["Araçtan iner."], "gelisme": ["Mendille alnını siler."],
                 "sonuc": ["EMANET sözü havada kalır."]}}, headers=headers)
    client.put(f"/matrix/{m['id']}/cells", json={
        "column_id": c, "row_id": bagsiz["row_id"],
        "data": {"olay": "Alt sahne olur."}}, headers=headers)
    return m, bagli, g


def test_zincir_baglam_katmanlari(client, headers):
    """Plan, alt sahne, profiller, kurallar, miras ve gelişim - hepsi
    aynı bağlamda buluşmalı; gelecek gelişim süzülmeli."""
    m, bagli, g = _kur(client, headers)
    assert (g["created_parts"], g["created_chapters"]) == (1, 1), \
        "alt satır bölüm açmış olmalı değil"

    r = client.post("/ai/context-preview", json={
        "selected_entities": [], "chapter_number": bagli["chapter_number"],
        "instruction": "Yaz."}, headers=headers).json()
    fp = r["full_prompt"]
    for ad, parca in [
        ("plan", "OLAY: İhtiyar teknisyen vadiye varır."),
        ("alt sahne", "Alt sahne olur."),
        ("kişi profili", "Elektronikçi."),
        ("konuşma tarzı", "Kısa cümleler."),
        ("takma ad", "usta"),
        ("mekan profili", "Cam vadi."),
        ("roman kuralı", "Duyguyu adlandırma."),
        ("tur mirası", "EMANET"),
        ("geçmiş gelişim", "Karısını kaybetti."),
    ]:
        assert parca in fp, f"bağlamda eksik: {ad}"
    assert "Suçluluğu kabul eder." not in fp, "gelecek gelişim notu sızdı"
    assert "PLANA SADAKAT" in r["system_prompt"]


def test_zincir_taslak_denetimi(client, headers):
    """Dört denetim de kirli metinde bulguyu üretmeli."""
    m, bagli, _ = _kur(client, headers)
    d = client.post("/ai/draft-check", json={
        "chapter_id": bagli["chapter_id"],
        "text": "Akşam güneşi vurdu. Vicdan uyanmıştı. Henüz bilmiyordu ki."},
        headers=headers).json()
    mesaj = " · ".join(b["mesaj"] for b in d["bulgular"])
    assert "çelişiyor" in mesaj, "zaman çelişkisi yakalanmadı"
    assert "HENÜZ YOK" in mesaj, "var olmayan varlık yakalanmadı"
    assert "sızdıran" in mesaj, "gelecek kalıbı yakalanmadı"
    assert "Mendille" in mesaj, "atlanan beat yakalanmadı"


def test_zincir_aktarim_ve_saglik(client, headers):
    """Dışa aktar → içe aktar → el yazması → denetim promptu."""
    m, bagli, _ = _kur(client, headers)

    h = client.get(f"/matrix/{m['id']}/health", headers=headers).json()
    assert isinstance(h.get("bulgular"), list)

    veri = json.loads(client.get("/matrix/export?format=json",
                                 headers=headers).content.decode("utf-8"))
    imp = client.post("/matrix/import", json=veri, headers=headers).json()
    assert imp["hucre"] == 2, "hücreler içe aktarılmadı"
    assert imp["cozulen"] >= 1, "varlık bağları adla çözülmedi"

    ms = client.get(f"/novels/{headers['X-Novel-Id']}/manuscript?format=md", headers=headers)
    assert ms.status_code == 200

    ap = client.get(f"/matrix/{m['id']}/audit-prompt", headers=headers).json()
    assert "SORULAR" in ap["prompt"]
