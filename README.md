# Roman Yazım Asistanı API

FastAPI + SQLite (kolayca PostgreSQL'e taşınabilir) + Qwen (DashScope) tabanlı
roman yazım destek uygulaması - backend + frontend.

## Özellikler

- 7 menü: Kişiler (durum: aktif/pasif/öldü), Mekanlar, Olaylar/Zaman Çizelgesi,
  Nesneler, İpuçları, Terimler, Roman Kuralları
- Bölüm/Paragraf yazma + otomatik karakter/mekan/olay tespiti (mentions indeksi)
- Arama: bir isim yazınca geçtiği tüm (bölüm, paragraf) konumlarını bulur
- Var olan bir metni içe aktarma + geriye dönük yeniden tarama
- **İlişki haritası**: karakterler arası ilişkileri (kardeşi, düşmanı vb.) görsel
  bir grafikte gösterir
- **Zaman çizelgesi çakışma kontrolü**: aynı hikaye içi zamanda aynı karakterin
  farklı mekanlarda göründüğü olayları otomatik bulur
- **Stil eğitimi**: bir paragrafı "stil örneği" işaretlersen, Qwen her yeni
  metni senin o örnekteki tonunda yazmaya çalışır
- **Tüm roman tutarlılık taraması**: yazılmış tüm bölümleri tek seferde
  tarayıp roman geneli çelişkileri (karakter bilgisi, zaman çizelgesi, kural
  ihlali) raporlar
- Kelime sayısı takibi (toplam + bölüm başına)
- Veritabanı şifreleme (bkz. aşağıdaki "Şifreleme" bölümü)
- JWT ile giriş, loglama, yedekleme betiği

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
  main.py            - FastAPI uygulaması, router'ları birleştirir
  config.py          - .env'den ayarları okur
  database.py        - SQLAlchemy engine/session
  models.py          - Tablolar: Kişiler, Mekanlar, Olaylar, Nesneler,
                        İpuçları, Terimler, Roman Kuralları, Bölümler,
                        Paragraflar, Mentions (geçiş indeksi)
  schemas.py         - Pydantic request/response şemaları
  auth.py            - JWT login, şifre hash'leme
  entities.py         - entity_type string'lerini modellere eşler
  encryption.py        - alan düzeyinde (field-level) şifreleme
  mentions.py         - paragraf kaydedilince otomatik isim tespiti
  qwen_client.py      - DashScope bağlantısı + sabit/dinamik context oluşturucu
  routers/
    auth_router.py    - POST /auth/token (login)
    generic_crud.py   - basit menüler için ortak CRUD fabrikası
    menus.py          - Kişiler/Mekanlar/Olaylar/Nesneler/İpuçları/
                        Terimler/Kurallar router'ları
    chapters.py       - Bölüm/Paragraf CRUD + /chapters/search/ arama
    ai.py             - POST /ai/assist ve /ai/approve-suggestions
frontend/
  index.html          - ana ekran iskeleti (sol menü + sağ içerik alanı)
  login.html          - giriş sayfası
  css/style.css        - tüm stiller
  js/api.js            - JWT token yönetimi + ortak fetch sarmalayıcı
  js/login.js          - giriş sayfası mantığı
  js/app.js            - menüler, roman okuma/yazma, AI paneli, arama
```

## Temel akış

1. **Giriş yap:** `POST /auth/token` (form-data: username, password) → JWT token al.
   Diğer tüm isteklerde `Authorization: Bearer <token>` header'ı gerekir.

2. **Menüleri doldur:** `/characters/`, `/places/`, `/events/`, `/objects/`,
   `/foreshadowings/`, `/glossary/`, `/rules/` üzerinden kayıt ekle.
   `/rules/` özel: buraya eklediğin her şey **her AI isteğinde otomatik ve
   değişmeden** dahil edilir (romanın sabit/matematiksel kuralları için).

3. **Bölüm/paragraf yaz:**
   `PUT /chapters/{chapter_id}/paragraphs/{number}` — paragrafı kaydeder ve
   içinde geçen karakter/mekan/olay/nesne isimlerini otomatik tespit edip
   `mentions` tablosuna işler.

4. **Ara:** `GET /chapters/search/?q=Ahmet` ya da
   `GET /chapters/search/?entity_type=character&entity_id=1` — o varlığın
   geçtiği tüm (bölüm, paragraf) konumlarını döner.

5. **Var olan bir metni içe aktar:** Elinde zaten yazılmış bir el yazması
   varsa `POST /chapters/import` ile bir `.txt` dosyası yükle — "Bölüm N"
   başlıklarına göre otomatik bölüm/paragraf oluşturur ve o an menülerde
   kayıtlı isimleri paragraflarda arar. Aynı bölüm/paragraf numarası
   varsa üzerine yazar (tekrar yüklemek güvenlidir).

6. **Geriye dönük yeniden tarama:** Yeni bir karakter/mekan eklediğinde ya
   da bir ismi değiştirdiğinde, `POST /chapters/reindex-mentions` tüm
   romanı yeniden tarayıp mentions indeksini günceller — geçmiş bölümlerde
   o karakterin nerede geçtiğini de bulur.

7. **AI'dan yazım desteği al:** `POST /ai/assist` body'sinde:
   ```json
   {
     "chapter_number": 3,
     "instruction": "Ahmet'in limana varışını anlatan bir paragraf yaz",
     "selected_entities": [{"entity_type": "character", "entity_id": 1}],
     "existing_text": null
   }
   ```
   Backend, roman kurallarını (sabit katman) + seçilen karakterin özeti ve
   geçtiği son paragrafları (dinamik katman) birleştirip Qwen'e gönderir.
   Dönen `new_entity_suggestions` listesini onaylarsan
   `POST /ai/approve-suggestions` ile veritabanına yazılır — hiçbir öneri
   onaysız kaydedilmez.

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

Karakter/mekan/olay/nesne/ipucu/terim/kural isimleri, açıklamaları, notları
ve roman metninin tamamı (`Paragraph.text`, `Chapter.title/summary`)
veritabanında **şifreli** tutulur (Fernet/AES). Şifre çözme anahtarı
`.env`'deki `DB_ENCRYPTION_KEY`'dir ve ORM üzerinden okuma/yazma tamamen
şeffaftır - uygulama kodu şifrelemenin farkına bile varmaz.

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


