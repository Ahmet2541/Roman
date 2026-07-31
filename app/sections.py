"""KİŞİ ve MEKAN varlıkları için "bölüm" (section) tanımları.

Neden bu modül var: Character/Place artık tek bir "description/notes" değil,
konuya göre ayrılmış bölümler tutuyor (ör. "duygusal_yapi", "fiziksel_yapi").
Amaç şu: "Ahmet'in soğukkanlılığını yaz" dendiğinde AI'ya Ahmet'in TÜM
bilgisini (görünüşü, kariyeri, ilişkileri...) değil SADECE duygusal_yapi
bölümünü göndermek - hem token maliyetini düşürür hem alakasız bilgiyle
context'i kirletmez.

Bölüm anahtarları BİLEREK ince taneli tutuldu (ör. "korkular" yerine
"duygusal_yapi" gibi biraz daha geniş ama yine de odaklı bir grup) - amaç,
kullanıcının/AI'nın doğal dilde söylediği bir şeyin ("korkuları", "soğukkanlı",
"görünüşü") doğrudan tek bir anahtara düşmesi. Çok ince bölme (13 ayrı anahtar)
yerine 7 anlamlı grup seçildi çünkü pratikte istekler genelde bu gruplardan
biriyle örtüşüyor (bkz. proje sohbet geçmişi).

'meta' bölümü İSTİSNA: yazarın kendine notu (sembolizm, okuyucu etkisi vb.)
- bu asla AI'ya gönderilmez, sadece veritabanında durur ve arayüzde okunur.
Bu yüzden CHARACTER_SECTIONS / PLACE_SECTIONS içinde var (kaydedilebilir
olsun diye) ama ai_visible_sections() bunu her zaman dışarıda bırakır."""

CHARACTER_SECTIONS = {
    "duygusal_yapi": "Duygusal yapı: MBTI, güçlü/zayıf yanlar, korkular, arzular, tuhaf alışkanlıklar, iç çatışma, dönüşüm",
    "fiziksel_yapi": "Fiziksel yapı: görünüş, boy/kilo/saç/göz, ayırt edici özellik",
    "gecmis": "Geçmiş: geçmiş hikaye, sırlar, travmalar, dönüm noktaları, nereli/köken",
    "kariyer": "Kariyer: meslek, unvan, iş geçmişi, işle ilgili hedefler",
    "iliskiler": "İlişkiler: aile/dost/düşman/aşk üzerine öznel notlar (yapılandırılmış ilişki verisi CharacterRelationship tablosunda ayrıca tutulur)",
    "konusma_tarzi": "Konuşma tarzı: üslup, sık kullandığı sözler, beden dili",
    "meta": "Meta: sembolizm, okuyucu üzerindeki etki, yazar notu - SADECE yazar içindir, AI'ya asla gönderilmez",
}

PLACE_SECTIONS = {
    "fiziksel_yapi": "Fiziksel yapı: mimari, boyut, düzen, malzeme, renk paleti",
    "atmosfer": "Atmosfer: ışık, ses, koku, hava/sıcaklık, his, zaman hissi",
    "gecmis": "Geçmiş: kuruluş tarihi, önemli olaylar, eski isimler, efsaneler",
    "kurallar": "Kurallar & dinamikler: yasaklar, güç yapısı, ritüeller, tehlikeler",
    "baglantilar": "Bağlantılar: yakın mekanlar, ulaşım, sahibi/sakinleri, karakter bağlantıları",
    "zamansal_degisim": "Zamansal değişim: günün saatine/mevsime/olaylara göre nasıl değiştiği",
    "meta": "Meta: sembolizm, okuyucu üzerindeki etki, yazar notu - SADECE yazar içindir, AI'ya asla gönderilmez",
}

# entity_type -> section tanımları. Sadece "character" ve "place" bölüm
# sistemine sahip - diğer varlık tipleri (event/object/foreshadowing/term)
# hâlâ eski basit description/notes şeklinde kalıyor.
SECTIONS_BY_ENTITY_TYPE = {
    "character": CHARACTER_SECTIONS,
    "place": PLACE_SECTIONS,
}


def ai_visible_sections(section_map: dict) -> dict:
    """'meta' hariç, AI'ya tool açıklamasında gösterilecek bölümler."""
    return {k: v for k, v in section_map.items() if k != "meta"}


def describe_sections_for_tool() -> str:
    """CHAT_TOOLS içindeki get_entity_section aracının 'description' metnini
    tek bir kaynaktan (bu modülden) üretir - iki yerde aynı listeyi elle
    senkron tutma derdi olmasın diye."""
    lines = []
    for entity_type, label in (("character", "KİŞİ"), ("place", "MEKAN")):
        visible = ai_visible_sections(SECTIONS_BY_ENTITY_TYPE[entity_type])
        parts = [f"{key} ({desc.split(':', 1)[-1].strip()})" for key, desc in visible.items()]
        lines.append(f"{label} ({entity_type}) için section seçenekleri: " + ", ".join(parts) + ".")
    return "\n".join(lines)


def validate_section_keys(sections: dict, entity_type: str) -> dict:
    """Bilinmeyen bir bölüm anahtarı (ör. yazım hatasıyla 'duygusl_yapi')
    sessizce kaydedilip kaybolmasın diye - şema validator'ı bunu çağırır."""
    allowed = SECTIONS_BY_ENTITY_TYPE.get(entity_type)
    if allowed is None:
        return sections
    unknown = [k for k in sections if k not in allowed]
    if unknown:
        allowed_list = ", ".join(sorted(allowed))
        raise ValueError(
            f"Bilinmeyen bölüm anahtarı: {unknown}. Kullanılabilir anahtarlar: {allowed_list}"
        )
    return sections
