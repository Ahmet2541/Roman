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

# 6 başlık (5 AI'ya açık + meta). Eskiden 7'ydi: "kariyer" -> "gecmis"
# içine, mekanlarda "zamansal_degisim" -> "atmosfer" içine katlandı
# (bkz. migrations._merge_legacy_sections - eski veriler otomatik taşınır).
# 13 başlıklı geniş şablondaki her kavram bu 6'nın açıklamalarında karşılık
# bulur: Karakter Arc'ı -> duygusal_yapi, Konum&Köken + Kariyer -> gecmis,
# Roman İçindeki İşlev/Sembolizm -> meta, vb.
CHARACTER_SECTIONS = {
    "fiziksel_yapi": "Fiziksel yapı: görünüş, boy/kilo/saç/göz, ayırt edici özellikler, giyim",
    "duygusal_yapi": "Kişilik & iç dünya: kişilik tipi (MBTI vb.), güçlü/zayıf yanlar, korkular, arzular, tuhaf alışkanlıklar, iç çatışma, hedef ve karakter arc'ı (başlangıç -> dönüşüm)",
    "gecmis": "Geçmiş & köken: nereli, ait olduğu grup, geçmiş hikaye, meslek/kariyer, eğitim, sırlar, travmalar, dönüm noktaları",
    "iliskiler": "İlişkiler: aile/dost/düşman/aşk üzerine öznel notlar (yapılandırılmış ilişki verisi CharacterRelationship tablosunda ayrıca tutulur)",
    "konusma_tarzi": "Konuşma tarzı: üslup, sık kullandığı sözler, ses tonu, beden dili",
    "gizli": "Gizli katman: sonraki kitapların sırları, gizli bağlantılar/yapılanmalar, açığa çıkmamış motivasyonlar - romanda AÇIKÇA geçmeyecek bilgi. Varsayılan olarak AI'ya HİÇ gitmez; istek bazında 'alt-metin modu' açılırsa sızdırmama direktifiyle verilir",
    "meta": "Meta: sembolizm, roman içindeki işlevi, okuyucu üzerindeki etki, yazar notları - SADECE yazar içindir, AI'ya asla gönderilmez",
}

PLACE_SECTIONS = {
    "fiziksel_yapi": "Fiziksel yapı: mimari, boyut, düzen, malzeme, renk paleti, ayırt edici detaylar",
    "atmosfer": "Atmosfer & zamansal değişim: ışık, ses, koku, hava/sıcaklık, his; günün saatine/mevsime/olaylara göre nasıl değiştiği",
    "gecmis": "Geçmiş & sırlar: kuruluş tarihi, önemli olaylar, eski isimler, efsaneler, sahiplik geçmişi, gizli alanlar/geçitler, saklı sırlar",
    "kurallar": "Kurallar & dinamikler: buranın kanunları, yasaklar, güç yapısı, ritüeller, tehlikeler",
    "baglantilar": "Bağlantılar: yakın mekanlar, ulaşım, sınırlar, sahibi/sakinleri, karakter bağlantıları",
    "gizli": "Gizli katman: mekanın açığa çıkmamış sırları, sonraki kitaplarda ortaya çıkacak gerçekler - varsayılan olarak AI'ya gitmez, alt-metin moduyla sızdırmama direktifiyle verilebilir",
    "meta": "Meta: sembolizm, roman içindeki işlevi, okuyucu üzerindeki etki, yazar notları - SADECE yazar içindir, AI'ya asla gönderilmez",
}

# entity_type -> section tanımları. Sadece "character" ve "place" bölüm
# sistemine sahip - diğer varlık tipleri (event/object/foreshadowing/term)
# hâlâ eski basit description/notes şeklinde kalıyor.
# Nesneler kasıtlı olarak daha KOMPAKT: 4 başlık + meta. Bir kılıç/cihaz/
# yadigâr için kişi kadar boyut yok - ama "kökeni ne, ne işe yarar, kimde"
# soruları roman tutarlılığı için kritik. Zaman içindeki el değiştirme
# Progression'da ayrıca izlenebilir; "sahiplik" buradaki GÜNCEL durumdur.
OBJECT_SECTIONS = {
    "fiziksel_yapi": "Fiziksel yapı: görünüm, malzeme, boyut/ağırlık, işçilik, ayırt edici detaylar, yıpranma/hasar",
    "gecmis": "Köken & geçmiş: kim/ne zaman yaptı, önceki sahipler, efsanesi, sırları",
    "islev": "İşlev & güçler: ne işe yarar, güçleri/yetenekleri, sınırları/bedeli, kullanım kuralları",
    "sahiplik": "Sahiplik & konum: şu an kimde, nerede duruyor/saklanıyor, varlığını kimler biliyor",
    "gizli": "Gizli katman: nesnenin açığa çıkmamış gerçek doğası/kökeni - varsayılan olarak AI'ya gitmez, alt-metin moduyla verilebilir",
    "meta": "Meta: sembolizm, olay örgüsündeki rolü, yazar notları - SADECE yazar içindir, AI'ya asla gönderilmez",
}

SECTIONS_BY_ENTITY_TYPE = {
    "character": CHARACTER_SECTIONS,
    "place": PLACE_SECTIONS,
    "object": OBJECT_SECTIONS,
}


# AI'ya varsayılan akışta ASLA açılmayan bölümler: meta (yazar notu) ve
# gizli (sonraki kitapların sırları). Fark: meta hiçbir koşulda gitmez;
# gizli, istek bazında "alt-metin modu" açılırsa sızdırmama direktifiyle
# gider (bkz. qwen_client.build_dynamic_layer include_hidden).
AI_HIDDEN_KEYS = {"meta", "gizli"}


def ai_visible_sections(section_map: dict) -> dict:
    """AI'ya varsayılan olarak gösterilebilecek bölümler (meta + gizli hariç)."""
    return {k: v for k, v in section_map.items() if k not in AI_HIDDEN_KEYS}


def describe_sections_for_tool() -> str:
    """CHAT_TOOLS içindeki get_entity_section aracının 'description' metnini
    tek bir kaynaktan (bu modülden) üretir - iki yerde aynı listeyi elle
    senkron tutma derdi olmasın diye."""
    lines = []
    for entity_type, label in (("character", "KİŞİ"), ("place", "MEKAN"), ("object", "NESNE")):
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


# ---------------------------------------------------------------------------
# TALİMATA GÖRE İLGİLİ BÖLÜM SEÇİMİ (tek seferlik yazım/assist modu için).
#
# Neden var: Sohbet modunda AI, get_entity_section aracıyla ihtiyacı olan
# bölümü KENDİSİ çekebiliyor. Ama tek seferlik assist akışında (ask_qwen)
# araç YOK - "gerekirse çek" denilen bölümlere AI'nın erişecek eli yoktu,
# yani "Ahmet'in görünüşünü betimle" dendiğinde fiziksel_yapi içeriği hiç
# gitmiyordu. Bu harita, talimat metnindeki anahtar kelimelere bakarak
# SADECE ilgili bölümün içeriğini context'e koyar - tamamını asla.
#
# Eşleşme kasıtlı olarak KÖK bazlı ve mütevazı: "görün" -> görünüş/görünümü/
# görünüyor hepsini yakalar. Türkçe İ/ı tuzağına düşmemek için talimat
# _tr_lower ile küçültülür. Hiçbir kelime eşleşmezse hiçbir içerik gitmez -
# eski davranış (sadece dolu bölüm İSİMLERİNİN listelenmesi) korunur.
# "meta" bu haritada YOK ve ASLA seçilemez.
# ---------------------------------------------------------------------------

SECTION_KEYWORDS = {
    "character": {
        "fiziksel_yapi": ["görün", "fizik", "boyu", "kilo", "saç", "göz", "yüz", "ten", "giyim", "kıyafet", "vücut", "dış "],
        "duygusal_yapi": ["duygu", "kişilik", "korku", "arzu", "psikoloj", "iç çatışma", "iç dünya", "dönüşüm", "huy", "mbti", "zayıf yan", "güçlü yan", "alışkanlık", "karakter arc", "hedefi", "öfke", "soğukkanlı"],
        "gecmis": ["geçmiş", "köken", "nereli", "çocukluk", "travma", "sır", "meslek", "kariyer", "eğitim", "dönüm nokta", "hikayesi", "yetişti"],
        "iliskiler": ["ilişki", "aile", "dost", "arkadaş", "düşman", "aşk", "sevgili", "kardeş", "anne", "baba", "evli", "bağı"],
        "konusma_tarzi": ["konuş", "diyalog", "üslu", "ses ton", "ağız", "söz", "replik", "beden dili", "der ki", "şive"],
    },
    "object": {
        "fiziksel_yapi": ["görün", "malzeme", "boyut", "şekl", "renk", "ağırlığ", "işçilik", "fizik", "yıpran", "hasar"],
        "gecmis": ["köken", "geçmiş", "tarih", "efsane", "kim yaptı", "sır", "eski sahip", "nereden gel"],
        "islev": ["işlev", "ne işe", "güç", "gücü", "yetenek", "sınır", "bedel", "kullan", "çalış", "etki"],
        "sahiplik": ["sahib", "sahip", "kimde", "nerede dur", "saklan", "taşıy", "elinde"],
    },
    "place": {
        "fiziksel_yapi": ["mimari", "görün", "yapısı", "boyut", "malzeme", "renk", "duvar", "bina", "fizik", "plan", "düzen"],
        "atmosfer": ["atmosfer", "koku", "ses", "ışık", "hava", "hissi", "gece", "sabah", "akşam", "mevsim", "kış", "yaz", "duyu", "sıcak", "soğuk"],
        "gecmis": ["geçmiş", "tarih", "efsane", "kuruluş", "sır", "gizli", "eski", "sahip"],
        "kurallar": ["kural", "yasak", "kanun", "ritüel", "tehlike", "güç yapı", "otorite", "gelenek"],
        "baglantilar": ["ulaşım", "yol", "bağlantı", "komşu", "yakın", "sakin", "giriş", "çıkış", "sınır"],
    },
}


def _tr_lower(text: str) -> str:
    """Türkçe'ye uygun küçültme (İ->i, I->ı) - style_scan._tr_lower ile aynı
    mantık; sections.py'ın style_scan'e bağımlı olmaması için burada da var."""
    return text.replace("İ", "i").replace("I", "ı").lower()


def relevant_sections_for_instruction(instruction_text: str, entity_type: str) -> list[str]:
    """Talimat metnine bakıp bu varlık tipi için İLGİLİ bölüm anahtarlarını
    döner (tanım sırasında, tekrarsız). Talimat boşsa ya da hiçbir anahtar
    kelime geçmiyorsa boş liste döner - çağıran taraf o durumda içerik
    enjekte etmez. 'meta' hiçbir koşulda dönmez (haritada yok)."""
    if not instruction_text:
        return []
    keywords = SECTION_KEYWORDS.get(entity_type)
    if not keywords:
        return []
    norm = _tr_lower(instruction_text)
    return [key for key, words in keywords.items() if any(w in norm for w in words)]
