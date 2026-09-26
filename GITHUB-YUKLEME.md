# GitHub'a yüklenecek tam proje

Bu paket projenin tüm kaynak kodunu, arayüzünü, testlerini ve dağıtım
dosyalarını içerir. Alt bölüm ekleme ve paragraf silmede 500 hatası
düzeltmeleri birlikte uygulanmıştır.

## Yükleme

1. ZIP'i bilgisayarınızda açın.
2. `roman-api` klasörünün İÇİNDEKİ dosya ve klasörleri GitHub deponuzun
   köküne yükleyin. `Dockerfile`, `requirements.txt`, `railway.json`, `app`
   ve `frontend` depo kökünde yan yana bulunmalı. ZIP dosyasının kendisini
   kaynak kod yerine yüklemeyin.
3. `.gitignore` ve `.dockerignore` dosyalarını da ekleyin.
4. Sunucudaki mevcut ortam değişkenlerini ve veritabanını koruyarak
   yeniden deploy edin. Mevcut `DB_ENCRYPTION_KEY` değerini değiştirmeyin.

Yeni kurulum için README.md ve DEPLOY.md belgelerine bakın. Yerel kurulumda
bağımlılıkları yükledikten sonra `bash init_env.sh` ile .env oluşturulabilir.
Mevcut kurulumda .env'yi yeniden oluşturmak gerekmez.

## Paketteki düzeltmeler

- Alt bölüm ekleme: ChapterUpdate artık numara değişikliklerini kabul eder;
  dolu veya geçersiz numaraları reddeder.
- Paragraf silme: kalan paragraflar sırayla yeniden numaralanır; oluşturulma
  sırası farklı olduğunda UNIQUE çakışması ve 500 hatası oluşması giderildi.

İlgili 32 test yerel SQLite ortamında geçti. Canlı sunucu, gerçek AI
çağrıları ve Docker kurulumu bu çalışma kapsamında denenmedi.

Veritabanı, .env, günlükler, yedekler ve geçici dosyalar bu kaynak paketine
dahil değildir. Bunları GitHub'a yüklemek gerekmez. Veritabanını silmeyin.
