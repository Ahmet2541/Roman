# Roman Yazım Asistanı API

FastAPI + SQLite (kolayca PostgreSQL'e taşınabilir) + Qwen (DashScope) tabanlı
roman yazım destek uygulaması - backend + frontend.

## Özellikler

- **Çoklu roman desteği**: aynı hesapla birden fazla roman yönetilebilir,
  her istek `X-Novel-Id` header'ıyla hangi romana ait olduğunu bildirir
  (frontend bunu otomatik ekler) - romanlar arasında hiçbir kayıt sızmaz.
- 7 menü: Kişiler (durum: aktif/pasif/öldü), Mekanlar, Olaylar/Zaman Çizelgesi,
  Nesneler, İpuçları, Terimler, Roman Kuralları
- **Karakter/Mekan derin profili (6 başlık)**: isim/açıklama/not dışında,
  konuya göre bölünmüş bir `sections` alanı var. Kişi: fiziksel_yapi,
  duygusal_yapi (kişilik + karakter arc'ı), gecmis (köken + kariyer +
  sırlar), iliskiler, konusma_tarzi, meta. Mekan: fiziksel_yapi, atmosfer
  (+ zamansal değişim), gecmis (+ sırlar/gizli alanlar), kurallar,
  baglantilar, meta. 'meta' (sembolizm, roman içindeki işlev, yazar notu)
  AI'ya ASLA gönderilmez. AI'ya context oluştururken bu bölümlerin TAMAMI
  değil, sadece talimatla İLGİLİ olanın içeriği gönderilir: talimattaki
  anahtar kelimeler ("görünüşünü betimle" -> fiziksel_yapi) otomatik
  eşleştirilir; sohbet modunda AI ayrıca get_entity_section aracıyla
  ihtiyacı olan bölümü kendisi çekebilir. Eski 7 başlıklı veriler açılışta
  otomatik ve kayıpsız yeni yapıya taşınır (kariyer -> gecmis,
  zamansal_degisim -> atmosfer). Formdaki "Derin Profil" akordeonundan
  düzenlenir - temel form kısa kalır, derinleşmek isteyen açar. Nesneler de
  aynı sistemi daha kompakt taşır (4 başlık + meta): fiziksel_yapi, gecmis
  (köken/efsane), islev (güçler/sınırlar/bedel), sahiplik (kimde/nerede).
- Bölüm/Paragraf yazma + otomatik karakter/mekan/olay tespiti (mentions indeksi)
- Arama: bir isim yazınca geçtiği tüm (bölüm, paragraf) konumlarını bulur
- Var olan bir metni içe aktarma + geriye dönük yeniden tarama
- **İlişki haritası**: karakterler arası ilişkileri (kardeşi, düşmanı vb.) görsel
  bir grafikte gösterir
- **Zaman çizelgesi çakışma kontrolü**: aynı hikaye içi zamanda aynı karakterin
  farklı mekanlarda göründüğü olayları otomatik bulur
- **Stil eğitimi**: bir paragrafı "stil örneği" işaretlersen, Qwen her yeni
  metni senin o örnekteki tonunda yazmaya çalışır
- **AI Sohbet Modu**: tek seferlik "talimat → metin" akışının yanında, Qwen
  ile çok turlu bir sohbet de yürütülebilir. Qwen burada 6 araca sahip:
  bölüm/paragraf yazma-güncelleme (onaysız, doğrudan), bir karakterin/mekanın
  tek bir bölümünü okuma (`get_entity_section`), ve sohbette ortaya çıkan
  yeni bir bilgiyi ÖNERME (`propose_entity_update` - asla doğrudan yazmaz,
  çelişki tespit ederse kullanıcıya işaretler, onaylanırsa
  `/ai/approve-entity-update` ile kaydedilir).
- **Bağlam önizleme**: `/ai/context-preview` ile Qwen'e gerçekte ne
  gönderileceğini, hiç istek atmadan (ücretsiz) görebilirsin.
- **Tüm roman tutarlılık taraması**: yazılmış tüm bölümleri tek seferde
  tarayıp roman geneli çelişkileri (karakter bilgisi, zaman çizelgesi, kural
  ihlali) raporlar
- **Üslup taraması (yazım tiki dedektörü)**: "gibi/sanki/X yerine Y" tarzı
  aşırı kullanılan kalıpları TÜM seri metninde sayar (saf regex, AI maliyeti
  sıfır). Kalıplar sabit kod değil, menüden eklenip düzenlenebilen DB
  kayıtları (`StylePattern`: regex + çift eşik). Tarama elle tetiklenir ve
  sonucu önbelleklenir (`StyleScanResult`) - her AI isteği bu ucuz
  önbellekten okur, eşiği aşan kalıplar context'e otomatik "bu kalıptan
  KAÇIN" uyarısı olarak girer. Eşik ÇİFT koşulludur (1000 kelimede yoğunluk
  VE mutlak minimum tekrar) - kısa metinlerde tek kelimenin yanlış alarm
  vermesini önler. Türkçe İ/ı ayrımına uygun küçültmeyle tarar; en yoğun
  bölümleri de raporlar ("en çok Bölüm 45-52'de" gibi).
- **Plan Matrisi**: Excel benzeri eşleştirme tablosu - kolonlar kişiler/
  turlar, satırlar aşamalar, hücreler o kesişimin madde madde planı (ör.
  8 sanık × 7 aşama = 56 hücre). Bir hücre bir bölüme bağlanınca planı,
  SADECE o bölüm yazılırken AI context'ine "BÖLÜM PLANI" katmanı olarak
  otomatik girer (summary'nin tersi: "ne OLDU" değil "ne OLACAK").
  "Fihristi Oluştur" tek tıkla her kolonu bir Kısım'a, her hücreyi bir
  Bölüm'e çevirir ve bağları kurar - mevcut fihristin sonuna ekler.
  Satırlar iki türde: ana başlık ve ara başlık ('sub' - girintili/italik;
  bir aşamanın altına alt adım eklemek için) - hem satırlar hem KOLONLAR
  ⊕ düğmesiyle ARAYA eklenebilir, sıra otomatik kayar. Roman menüsünde,
  plana bağlı bir bölüm seçilince AI panelinin üstünde açılır-kapanır
  "📋 Bölüm Planı" kutusu belirir - AI'ya giden planın aynısını yazar da
  görür (/matrix/plan-for-chapter/{id}). Kutudaki "📝 Plandan Bölüm
  Taslağı Oluştur" düğmesi, planın TAMAMINI işleyen tam bir bölüm taslağı
  üretir; taslak önce gösterilir, onaylanırsa boş satırlardan paragraflara
  bölünüp bölüme eklenir - akış: plan yaz -> taslağı ürettir -> paragraf
  paragraf düzelt. Her hücre ilk
  kaydında SABİT bir referans kodu alır (MP1, MP2, ... - araya ekleme/
  sıralama değişse bile asla değişmez). Başka bir bölümün talimatında bu
  kod anıldığında ("MP13'teki ritimle kıyasla") o hücrenin planı context'e
  "REFERANS PLANLAR" olarak girer - turlar arası paralellik/kıyas için.
  **AI ile eksik doldurma**: kolon başlıklarındaki kutularla turları
  çoktan seçmeli işaretleyip "🤖 Eksikleri AI Doldursun" dersen, seçili
  kolonların BOŞ hücreleri için AI - dolu hücrelerdeki kalıbı şablon
  alarak ("aynı iskelet, farklı rol") - taslak üretir. Hiçbiri onaysız
  kaydedilmez: her taslak düzenlenebilir, tek tek ya da toplu onaylanır;
  kaydetme normal hücre kaydından geçtiği için bölüm bağı korunur ve MP
  kodu orada atanır. Tamamen dolu kolonlar Qwen'e hiç gitmez (maliyet 0).
- **Görünür seri/kitap yönetimi**: ana içeriğin üstünde kalıcı bir çubuk -
  "📚 Seri Adı · Kitap 2: Kitap Adı ▾ değiştir / kitap ekle". Tıklayınca
  "Kitaplar & Seriler" ekranı yerinde açılır (✕ ile vazgeçilebilir):
  başka kitaba geçiş, "+ Bu seriye yeni kitap ekle" (aynı evren - tüm
  karakter/mekan/kural verisi paylaşılır), yepyeni seri başlatma,
  yeniden adlandırma ve silme. Mobilde de her görünümde görünür.
- **🔒 Gizli Katman (alt-metin modu)**: Kişi/Mekan/Nesne derin profiline
  eklenen "gizli" bölümü - sonraki kitapların sırları, gizli bağlantılar
  ("Baş Tabip Lümen'in suçlarını biliyor ama para için susuyor").
  Varsayılanda AI'ya HİÇBİR yoldan gitmez: içerik girmez, bölüm listesinde
  anılmaz, anahtar kelimeyle seçilemez (meta ile aynı koruma düzeyi). Farkı:
  AI panelindeki "🔒 Gizli katmanı alt-metin olarak ver" anahtarı açılırsa,
  seçili varlıkların gizli katmanı "SIR - romanda ASLA açıkça yazma, sadece
  davranış tutarlılığı ve alt-metin için bil" direktifiyle gider - dramatik
  ironi: karakterin diyalogları sırra göre incelikle şekillenir ama sır
  yazılmaz. Meta = yazarın notu (asla gitmez); Gizli = dünyanın henüz
  açığa çıkmamış gerçeği (istenirse alt-metin olarak gider).
- **Kayda özel kurallar**: bir kural bir Kişi/Mekan/Nesne'ye bağlanabilir
  ("Vicdan yargıç değil" -> Vicdan). Bağlı kural SABİT katmandan çıkar ve
  SADECE o kayıt seçili varlıklardayken "Bu kayda ÖZEL kurallar (İHLAL
  ETME)" bloğuyla gider - 100+ kurallı dünyada context şişmesinin asıl
  ilacı. Ekleme yerinde yapılır: Kişi/Mekan/Nesne formunda "BU KAYDA ÖZEL
  KURALLAR" kutusu (+ Kural ile tek satırda). Kurallar menüsü ana liste
  görevini korur; kapsamlı kurallar orada "🔗 Kişi: Vicdan" rozetiyle
  görünür. Genel (bağsız) kurallar eskisi gibi her isteğe gider.
- **Paragraf balonları (anlık K/M/N tespiti)**: bir paragraf kaydedilince
  o paragraf tek başına taranır; "ihtiyar teknisyen" gibi henüz kayıtsız
  bir figür görülünce paragrafın altında K (Kişi) / M (Mekan) / N (Nesne)
  balonu belirir. Düz balon = yeni kayıt önerisi (profili ve takma
  adlarıyla); "K+" balonu = MEVCUT kayda yeni bilgi ekleme (ör. Vicdan
  hakkında konusma_tarzi'na yeni cümle). Tıklanınca ne ekleneceği
  gösterilip onay istenir; onay sonrası paragraf yeniden taranır ve yeni
  varlık mention rozeti olarak görünür. Nesnelere de takma ad desteği
  geldi ("Kül Şişesi"ne metinde "şişe" denmesi artık yakalanır).
- **Zengin varlık çıkarımı**: bölüm taraması artık sadece isim + kısa
  açıklama değil; metindeki kanıta dayanarak TAKMA ADLARI ("Vicdan"a
  "sistem" da deniyorsa) ve DERİN PROFİL bölümlerini (fiziksel_yapi,
  konusma_tarzi, islev...) de çıkarır. Tekilleştirme kayıtlı isimlere ek
  kayıtlı ALIAS'lara da bakar - "Şahin Göz" bir karakterin takma adıysa
  yeni varlık diye önerilmez. Onayda: yeni kayıt alias+profille doğar;
  mevcut kayıtta alias'lar birleşir (Türkçe İ/ı-bilinçli, çift oluşmaz),
  profil eklemeleri "[Bölümden]" etiketiyle bölüm SONUNA eklenir - hiçbir
  mevcut bilgi silinmez. Geçersiz/uydurma bölüm anahtarları sessizce
  temizlenir, meta'ya asla yazılmaz.
- **Paragraf bazlı AI (⋯ menüsünde)**: her paragrafın işlemlerinde
  "✨ Öneri" (paragrafı tam bağlamla - plan, kurallar, üslup uyarıları -
  güçlendirilmiş haliyle yeniden yazar; beğenirsen "Paragrafı Değiştir"
  tek tıkla yerine koyar, eski hal Geçmiş'te) ve "🔍 Eleştir" (editör
  analizi: güçlü/zayıf yönler + somut öneriler - metne dokunmaz). Bölüm
  genelindeki karşılığı: 🎯 Okur Testi.
- **Sohbette paragraf değiştirme**: mesajında P-kodu geçirirsen ("P55'i
  daha öfkeli yaz"), gelen yanıtın altında "↺ P55'i Değiştir" düğmesi
  belirir - tıklayınca yanıt metni o paragrafın yerine yazılır, eski hal
  Geçmiş'ten geri alınabilir, sohbet geçmişi korunur (konuşmaya kaldığın
  yerden devam edersin), balonda "✓ P55 paragrafı değiştirildi" izi kalır.
- **Okur Testi (denetçi katmanı)**: bölüm metnini okur gözüyle tarar -
  tempo ölümü, bilgi bocası, klişe, anlaşılmaz cümle, gerilim kırılması,
  inandırıcılık çatlağı. Bulguları paragraf numarası + kısa alıntı +
  gerekçe + öneriyle listeler, tıklayınca paragrafa gider. SADECE uyarır,
  metne asla dokunmaz; sorunsuz metinde boş liste dönmesi istenir.
- **Bağlam sağlık şeridi + hızlı plan**: bölüm açılınca "✓ Özet ·
  ✗ Plan Matrisi'nde bulunamadı - tıkla, hemen yaz · ✗ Metin yok"
  rozetleri - eksikler açık dille söylenir ve TIKLANARAK giderilir:
  plan rozetine tıklayınca matrise hiç girmeden bölümün içinden plan
  yazılır (arka planda "Hızlı Planlar" matrisine tek hücre olarak, MP
  koduyla kaydedilir; bölüm zaten bir matristen bağlıysa o hücre
  güncellenir, kopya açılmaz). Plan kutusundaki ✎ ile plan yerinde
  düzenlenir. Kaydedince "Plandan Bölüm Taslağı Oluştur" anında belirir -
  yeni bölüm aç -> planı yaz -> taslağı ürettir akışı matris ekranına
  uğramadan tamamlanır.
- **✅ Bölümü Kapat**: özet üretimi + Roman Haritası taramasını tek
  dokunuşla arka arkaya çalıştırır.
- **Başlık kaçağı dönüştürücü**: "# BAŞLIK" olarak paragrafta kalmış içe
  aktarma kalıntılarını tek tıkla gerçek Alt Başlık girdisine çevirir
  (bölümün önüne taşır, numaraları kaydırır, kalan paragrafları toparlar).
- **Nakarat koruması**: üslup kalıbı "♪ nakarat" işaretlenirse sayılır ve
  raporda görünür ama asla "aşırı kullanım" uyarısına dönüşmez - bilinçli
  leitmotif ile yazım tiki ayrımı.
- **Matris içe aktarıcı**: "Aşama adı: içerik" satırlarını yapıştır,
  eşleşmeleri önizle, seçili kolonun hücrelerine tek seferde yaz.
- Kolon <-> Kişi bağlama paneli: kolon adına tıklayınca ad + bağlı Kişi
  düzenlenir; bağlı kolonun AI doldurması karakterin profilini görür.
- Kelime sayısı takibi (toplam + bölüm başına)
- **Dışa/içe aktarma**: aktif romanı tek tıkla JSON olarak indirip
  (`/admin/export`) başka bir yere yükleyebilirsin (`/admin/import`)
- **Rate limiting**: AI uçları (assist/sohbet/tam tarama) kullanıcı başına
  bellek-içi bir sayaçla sınırlanır - yanlışlıkla DashScope faturasını
  şişirecek bir döngüye karşı
- Veritabanı şifreleme (bkz. aşağıdaki "Şifreleme" bölümü) - artık `sections`
  alanı da dahil tüm içerik alanları şifreli
- JWT ile giriş, loglama, yedekleme betiği
- Sol menü: dinlenme halinde dar bir ikon şeridi, üzerine gelince (ya da
  Tab'layınca) genişleyen bir "kitap sırtı" - masaüstünde varsayılan
  davranış, mobilde klasik açılır/kapanır çekmece

## Kurulum

```bash
cd roman-api
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

./init_env.sh
# Bu, .env dosyasını oluşturur ve JWT_SECRET_KEY + DB_ENCRYPTION_KEY'i
# kendi makinende otomatik üretir (güvenli - hiçbir yere yazılmaz).
# Sonra .env dosyasını aç ve şunları elle doldur:
#   DASHSCOPE_API_KEY   -> DashScope konsolundan aldığın anahtar
#   ADMIN_PASSWORD      -> kendi belirleyeceğin güçlü bir şifre

uvicorn app.main:app --reload
```

Not: `DB_ENCRYPTION_KEY` eksikse uygulama hiç başlamaz, net bir hata verir.
Ayrıca daha önce oluşturduğun bir `roman.db` dosyan varsa (bu sürümden önce),
sil ve yeniden başlat - yeni eklenen alanlar (karakter durumu, olay zaman
çizelgesi vb.) mevcut tabloya otomatik eklenmez, sadece yeni tablo oluşturulurken
uygulanır.

## İnternete açmak (deploy)

Docker Compose, VPS'e doğrudan kurulum ya da Railway/Render gibi bir PaaS
seçeneklerinin hepsi adım adım **`DEPLOY.md`** dosyasında. PostgreSQL'e geçiş
(`postgresql-binary` sürücüsü dahil) test edildi ve çalışıyor - `DATABASE_URL`'i
Postgres bağlantı stringine çevirmen yeterli, kod tarafında başka değişiklik
gerekmiyor.

Sunucu ayağa kalkınca:
- Uygulama (frontend): http://127.0.0.1:8000/app/  (kök adres `/` buraya otomatik yönlenir)
- API dokümantasyonu (Swagger UI): http://127.0.0.1:8000/docs

İlk girişte `.env`'deki `ADMIN_USERNAME` / `ADMIN_PASSWORD` ile giriş yaparsın.

## Yapı

```
app/
  main.py             - FastAPI uygulaması, router'ları birleştirir, migration'ları çalıştırır
  config.py           - .env'den ayarları okur
  database.py         - SQLAlchemy engine/session
  models.py           - Tablolar: Novel, Kişiler, Mekanlar, Olaylar, Nesneler,
                        İpuçları, Terimler, Roman Kuralları, İlişkiler,
                        Bölümler, Paragraflar, ParagraphVersion, Progression,
                        Mentions (geçiş indeksi)
  schemas.py          - Pydantic request/response şemaları
  auth.py             - JWT login, şifre hash'leme
  entities.py         - entity_type string'lerini modellere eşler
  sections.py         - Kişi/Mekan "derin profil" bölüm tanımları (bkz. aşağı)
  encryption.py       - alan düzeyinde (field-level) şifreleme (EncryptedString + EncryptedJSON)
  mentions.py         - paragraf kaydedilince otomatik isim tespiti
  novel_context.py    - X-Novel-Id header'ını okuyup doğrulayan dependency
  migrations.py       - açılışta çalışan, idempotent hafif şema göçleri
  import_parser.py    - .txt bir el yazmasını Bölüm/Paragraf'a ayrıştırır
  ratelimit.py        - AI uçları için bellek-içi rate limiter
  qwen_client.py      - DashScope bağlantısı + context katmanları (fixed/index/dynamic/style)
                        + tek seferlik ask_qwen + çok turlu chat_with_qwen (tool-calling)
                        + full_scan + entity/progression öneri çıkarımı
  routers/
    auth_router.py    - POST /auth/token (login)
    novels.py         - roman oluşturma/listeleme/yeniden adlandırma/silme
    generic_crud.py   - basit menüler için ortak CRUD fabrikası (dict alanlarda merge yapar)
    menus.py          - Kişiler/Mekanlar/Nesneler/İpuçları/Terimler/Kurallar router'ları
    events.py         - Olaylar + zaman çizelgesi çakışma kontrolü
    style.py          - üslup kalıbı CRUD + /style/scan + /style/report
    matrix.py         - Plan Matrisi: kolon/satır/hücre CRUD + fihrist üretimi
    relationships.py  - Karakter ilişki haritası
    progressions.py   - Gelişim çizelgesi (varlıkların bölüm bazlı kronolojik notları)
    chapters.py       - Bölüm/Paragraf CRUD + arama + içe aktarma
    ai.py             - /ai/assist, /ai/chat, /ai/context-preview,
                        /ai/approve-suggestions, /ai/approve-entity-update, /ai/full-scan
    admin.py          - /admin/export, /admin/import (aktif romanı JSON olarak yedekle/geri yükle)
frontend/
  index.html          - ana ekran iskeleti (hover ile açılan sol menü + sağ içerik alanı)
  login.html          - giriş sayfası
  css/style.css       - tüm stiller
  js/api.js           - JWT token yönetimi + X-Novel-Id header'lı ortak fetch sarmalayıcı
  js/login.js         - giriş sayfası mantığı
  js/app.js           - menüler, roman okuma/yazma, AI paneli (sohbet + talimat), arama
```

## Temel akış

1. **Giriş yap:** `POST /auth/token` (form-data: username, password) → JWT token al.
   Diğer tüm isteklerde `Authorization: Bearer <token>` header'ı gerekir.

2. **Bir roman seç ya da oluştur:** `GET /novels/` (liste) ya da
   `POST /novels/` (`{"name": "..."}`) ile roman id'sini al. **Auth
   dışındaki HER istekte** artık `X-Novel-Id: <id>` header'ı da ZORUNLU -
   yoksa 400 döner (bkz. `novel_context.get_novel_id`). Frontend bunu
   kullanıcı roman seçtikten sonra otomatik ekliyor (`js/api.js`).

3. **Menüleri doldur:** `/characters/`, `/places/`, `/events/`, `/objects/`,
   `/foreshadowings/`, `/glossary/`, `/rules/` üzerinden kayıt ekle.
   `/rules/` özel: buraya eklediğin her şey **her AI isteğinde otomatik ve
   değişmeden** dahil edilir (romanın sabit/matematiksel kuralları için).
   Kişi/Mekan oluştururken isteğe bağlı bir `sections` dict'i de
   gönderebilirsin (bkz. aşağıdaki "Karakter/Mekan Derin Profili").

4. **Bölüm/paragraf yaz:**
   `PUT /chapters/{chapter_id}/paragraphs/{number}` — paragrafı kaydeder ve
   içinde geçen karakter/mekan/olay/nesne isimlerini otomatik tespit edip
   `mentions` tablosuna işler.

5. **Ara:** `GET /chapters/search/?q=Ahmet` ya da
   `GET /chapters/search/?entity_type=character&entity_id=1` — o varlığın
   geçtiği tüm (bölüm, paragraf) konumlarını döner.

6. **Var olan bir metni içe aktar:** Elinde zaten yazılmış bir el yazması
   varsa `POST /chapters/import` ile bir `.txt` dosyası yükle — "Bölüm N"
   başlıklarına göre otomatik bölüm/paragraf oluşturur ve o an menülerde
   kayıtlı isimleri paragraflarda arar. Aynı bölüm/paragraf numarası
   varsa üzerine yazar (tekrar yüklemek güvenlidir).

7. **Geriye dönük yeniden tarama:** Yeni bir karakter/mekan eklediğinde ya
   da bir ismi değiştirdiğinde, `POST /chapters/reindex-mentions` tüm
   romanı yeniden tarayıp mentions indeksini günceller — geçmiş bölümlerde
   o karakterin nerede geçtiğini de bulur.

8. **AI'dan tek seferlik yazım desteği al:** `POST /ai/assist` body'sinde:
   ```json
   {
     "chapter_number": 3,
     "instruction": "Ahmet'in limana varışını anlatan bir paragraf yaz",
     "selected_entities": [{"entity_type": "character", "entity_id": 1}],
     "existing_text": null
   }
   ```
   Backend, roman kurallarını (sabit katman) + fihrist özetlerini + seçilen
   karakterin özeti/notları ve geçtiği son paragrafları (dinamik katman)
   birleştirip Qwen'e gönderir. Neye gerçekten gittiğini göndermeden önce
   görmek istersen `POST /ai/context-preview` aynı body ile ücretsiz (Qwen'e
   hiç istek atmaz) bir önizleme döner. Dönen `new_entity_suggestions`
   listesini onaylarsan `POST /ai/approve-suggestions` ile veritabanına
   yazılır — hiçbir öneri onaysız kaydedilmez.

9. **AI ile sohbet et:** `POST /ai/chat` body'sinde `messages` (rol+içerik
   geçmişi) ve `selected_entities` gönderilir. Qwen burada 6 aracı
   kullanabilir - bölüm/paragraf yazma/güncelleme onaysız DOĞRUDAN
   uygulanır (`actions_taken` listesiyle bildirilir), ama bir karakter/
   mekan hakkında yeni bir bilgi fark ederse bunu asla doğrudan yazmaz -
   `pending_entity_updates` listesinde bir ÖNERİ olarak döner (varsa
   çelişki tespiti ve mevcut metinle karşılaştırma dahil). Onaylarsan
   `POST /ai/approve-entity-update` (`{"entity_type", "entity_id",
   "section", "content", "mode": "append"|"replace"}`) ile kaydedilir -
   `mode="append"` (varsayılan) mevcut metnin SONUNA ekler, hiçbir zaman
   sessizce üzerine yazmaz.

## Karakter/Mekan Derin Profili (`sections`)

Kişi/Mekan kayıtlarının `description`/`notes` alanlarının yanında, konuya
göre bölünmüş bir `sections` (JSON, şifreli) alanı var - amaç, "bir
karakterin ruh yapısıyla ilgili yaz" dendiğinde AI'ya o karakterin TÜM
bilgisini değil sadece ilgili bölümü göndermek (token tasarrufu + alakasız
bilgiyle context'i kirletmemek).

**Kişi anahtarları:** `duygusal_yapi`, `fiziksel_yapi`, `gecmis`, `kariyer`,
`iliskiler`, `konusma_tarzi`, `meta`
**Mekan anahtarları:** `fiziksel_yapi`, `atmosfer`, `gecmis`, `kurallar`,
`baglantilar`, `zamansal_degisim`, `meta`

Kurallar:
- `meta` bölümü (sembolizm, okuyucu etkisi, yazar notu) yazar tarafından
  kaydedilebilir ama **AI'ya asla gönderilmez** - ne context'e ne de
  `get_entity_section`/`propose_entity_update` araçlarına.
- Bilinmeyen bir anahtar göndermek (`sections.py`'deki listede yoksa) 422
  ile reddedilir - yazım hatası sessizce kaybolmaz.
- `PUT /characters/{id}` ya da `PUT /places/{id}` ile `sections` gönderdiğinde
  bu **birleştirilir (merge), YERİNE geçmez** - sadece gönderdiğin anahtarlar
  güncellenir/eklenir, diğer bölümler olduğu gibi kalır (bkz.
  `generic_crud.py`).
- AI sohbet modunda `get_entity_section` bu bölümlerden birini OKUR,
  `propose_entity_update` yeni bir şey ÖNERİR (yazmaz) - bkz. yukarıdaki
  "AI ile sohbet et" adımı.

## Testler

Kritik iş mantığı (evren/kitap paylaşımı, migration, sections merge,
alias tespiti, mekan hiyerarşisi, kural filtreleme, AI keşif fonksiyonları)
için otomatik bir pytest paketi var - AI çağrıları gerektiren testler
`unittest.mock` ile sahte Qwen yanıtlarıyla çalışır, gerçek bir
`DASHSCOPE_API_KEY` gerekmez.

```bash
pip install -r requirements-dev.txt
pytest
```

Bir şey değiştirirken (özellikle `migrations.py`, `qwen_client.py`,
`generic_crud.py`) bu paketi çalıştırmak, bu proje boyunca elle bulduğumuz
türden sessiz regresyonları (ör. Set'te string/number karışıklığı,
progression'da yanlış chapter_number) otomatik yakalar.

## Sonraki adımlar

Geriye gerçekten sadece senin yapabileceğin tek şey kaldı:

- Kendi DashScope hesabından bir API anahtarı al, `.env`'deki
  `DASHSCOPE_API_KEY`'e yapıştır, `/ai/assist` ve `/ai/full-scan`'i canlı test et.

Her şeyin geri kalanı (PostgreSQL, Docker, Nginx/HTTPS, systemd, güvenli
anahtar üretimi) hazır ve test edildi - bkz. `DEPLOY.md`.

## Loglama ve yedekleme

- Her istek ve hata `logs/app.log` dosyasına yazılır (konsola da basılır).
  Bir şey ters giderse önce buraya bak.
- `./backup_db.sh` çalıştırılan dizindeki `roman.db`'nin zaman damgalı bir
  kopyasını `backups/` klasörüne alır, 30 günden eski yedekleri siler.
  Düzenli otomatik yedek için crontab'a ekleyebilirsin (betiğin içinde
  örnek satır var). PostgreSQL'e geçersen bunun yerine `pg_dump` kullanman
  gerekir.

## Şifreleme

Karakter/mekan/olay/nesne/ipucu/terim/kural isimleri, açıklamaları, notları,
Kişi/Mekan'ın `sections` derin profili ve roman metninin tamamı
(`Paragraph.text`, `Chapter.title/summary`) veritabanında **şifreli**
tutulur (Fernet/AES - `sections` için `EncryptedJSON`, geri kalanı için
`EncryptedString`). Şifre çözme anahtarı `.env`'deki `DB_ENCRYPTION_KEY`'dir
ve ORM üzerinden okuma/yazma tamamen şeffaftır - uygulama kodu şifrelemenin
farkına bile varmaz.

**Ne işe yarar:** `roman.db` dosyası (ya da bir yedeği) tek başına ele
geçirilirse - yanlışlıkla halka açık bir yere kopyalanırsa, disk çalınırsa,
bir SQL injection ile ham veri dökümü alınırsa - içindeki hiçbir isim ya
da metin `DB_ENCRYPTION_KEY` olmadan okunamaz.

**Ne işe yaramaz (dürüst olmak gerekirse):** Sunucunun kendisi (uygulamanın
çalıştığı makine) tamamen ele geçirilirse bu koruma işe yaramaz - çünkü
uygulamanın şifreyi çözebilmesi için `DB_ENCRYPTION_KEY`'e ihtiyacı var ve
o anahtar da aynı sunucuda (`.env`'de) duruyor. Bu, "veritabanı dosyası tek
başına çalınırsa işe yaramasın" isteğini tam olarak karşılar; "sunucu ele
geçirilse bile hiçbir şey okunamasın" diye bir şey mimari olarak mümkün
değildir (uygulamanın çalışabilmesi için anahtara erişmesi gerekir).

**Önemli:** `DB_ENCRYPTION_KEY`'i bir kere üret, sonra hiç değiştirme -
değiştirirsen o ana kadarki tüm veriler okunamaz hale gelir. Anahtarı
`.env` dışında ayrıca güvenli bir yerde de sakla (parola yöneticisi gibi).


