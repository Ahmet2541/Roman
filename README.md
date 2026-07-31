# Roman Yazım Asistanı API

FastAPI + SQLite (kolayca PostgreSQL'e taşınabilir) + Qwen (DashScope) tabanlı
roman yazım destek uygulaması - backend + frontend.

## Özellikler

- **Çoklu roman desteği**: aynı hesapla birden fazla roman yönetilebilir,
  her istek `X-Novel-Id` header'ıyla hangi romana ait olduğunu bildirir
  (frontend bunu otomatik ekler) - romanlar arasında hiçbir kayıt sızmaz.
- 7 menü: Kişiler (durum: aktif/pasif/öldü), Mekanlar, Olaylar/Zaman Çizelgesi,
  Nesneler, İpuçları, Terimler, Roman Kuralları
- **Karakter/Mekan derin profili**: isim/açıklama/not dışında, konuya göre
  bölünmüş bir `sections` alanı var (Kişi: duygusal_yapi, fiziksel_yapi,
  gecmis, kariyer, iliskiler, konusma_tarzi, meta; Mekan: fiziksel_yapi,
  atmosfer, gecmis, kurallar, baglantilar, zamansal_degisim, meta). AI'ya
  context oluştururken bu bölümlerin TAMAMI değil, sadece talimatla ilgili
  olanı gönderilir (bkz. aşağıdaki "Karakter/Mekan Derin Profili" bölümü).
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


