# Deploy Rehberi

Üç yol var. Hangisini seçeceğin DevOps deneyimine ve bütçene bağlı.

## Seçenek A — Docker Compose (önerilen, en az elle iş)

Gerekli: bir VPS (Hetzner, DigitalOcean, vb.) üzerinde Docker kurulu olması.

```bash
# 1) Sunucuda Docker kurulumu (Ubuntu örneği)
curl -fsSL https://get.docker.com | sh

# 2) Projeyi sunucuya kopyala (scp, git clone, vb.)

# 3) .env'i hazırla
cd roman-api
./init_env.sh
nano .env   # DASHSCOPE_API_KEY, ADMIN_PASSWORD, POSTGRES_PASSWORD doldur
# DATABASE_URL satırını docker-compose.yml zaten kendisi ayarlıyor, dokunma

# 4) Ayağa kaldır
docker compose up -d --build

# 5) Nginx + HTTPS (aşağıdaki "Nginx + HTTPS" bölümüne bak)
```

Not: Bu Dockerfile standart bir FastAPI kalıbı izliyor ve mantığı doğrulandı,
ama bu ortamda Docker kurulu olmadığı için gerçek bir `docker build` ile
denenemedi — sunucunda ilk çalıştırmada küçük bir sorun çıkarsa (ör. bir
paket eksikliği) `docker compose logs app` ile bakıp bana söyleyebilirsin.

## Seçenek B — VPS'e doğrudan kurulum (Docker'sız)

```bash
# 1) Sunucuda Python, PostgreSQL, Nginx kur (Ubuntu örneği)
sudo apt update
sudo apt install -y python3-venv python3-pip postgresql nginx certbot python3-certbot-nginx

# 2) PostgreSQL veritabanı oluştur
sudo -u postgres psql -c "CREATE USER roman WITH PASSWORD 'guclu-bir-sifre';"
sudo -u postgres psql -c "CREATE DATABASE roman OWNER roman;"

# 3) Projeyi kopyala, sanal ortam kur
cd roman-api
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 4) .env hazırla
./init_env.sh
nano .env
# DATABASE_URL=postgresql://roman:guclu-bir-sifre@localhost:5432/roman

# 5) systemd servisi kur (arka planda sürekli çalışsın, sunucu yeniden
#    başlasa bile otomatik açılsın)
sudo cp deploy/roman-api.service /etc/systemd/system/
sudo nano /etc/systemd/system/roman-api.service   # yolları kendi yoluna göre düzenle
sudo systemctl daemon-reload
sudo systemctl enable --now roman-api
sudo systemctl status roman-api

# 6) Nginx + HTTPS (aşağıya bak)
```

## Nginx + HTTPS (her iki seçenek için de gerekli)

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/roman
sudo nano /etc/nginx/sites-available/roman   # "senin-domainin.com" kısmını değiştir
sudo ln -s /etc/nginx/sites-available/roman /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d senin-domainin.com    # ücretsiz HTTPS sertifikası
```

Bunun için bir domain adının (ör. Namecheap, Google Domains'ten alınmış) DNS
ayarlarında sunucunun IP adresine yönlendirilmiş olması gerekiyor - bu kısım
domain sağlayıcının kendi arayüzünden yapılır.

## Seçenek C — PaaS (Railway / Render) — en az DevOps, biraz daha pahalı

Bu servisler `Dockerfile`'ı otomatik algılayıp deploy eder:
1. Projeyi bir GitHub reposuna yükle.
2. Railway/Render'da "New Project" → GitHub reposunu seç.
3. Ortam değişkenlerini (`.env` içeriğini) panelden tek tek gir.
4. Bir PostgreSQL eklentisi ekle, `DATABASE_URL`'i panelin verdiği değerle değiştir.
5. Deploy et - HTTPS ve domain otomatik sağlanır (kendi domain'ini de bağlayabilirsin).

Bu seçeneği tercih edersen, hangi servisi kullandığını söyle - o servise özel
adımları netleştiririm (arayüzleri zaman zaman değişiyor, güncel ekran
görüntüleriyle değil ama doğru genel adımlarla yardımcı olurum).

## Deploy sonrası kontrol listesi

- [ ] `.env`'de `JWT_SECRET_KEY`, `DB_ENCRYPTION_KEY`, `ADMIN_PASSWORD` hepsi
      `init_env.sh`/kendi belirlediğin değerler, örnek/placeholder değil
- [ ] `DASHSCOPE_API_KEY` gerçek anahtarın
- [ ] `main.py`'deki CORS `allow_origins=["*"]` satırını kendi domain'inle
      sınırlandır (ör. `["https://senin-domainin.com"]`)
- [ ] HTTPS çalışıyor (tarayıcıda kilit simgesi var)
- [ ] `./backup_db.sh`'i crontab'a ekledin (PostgreSQL kullanıyorsan onun
      yerine `pg_dump` tabanlı bir yedekleme kur)
- [ ] `DB_ENCRYPTION_KEY`'i `.env` dışında ayrıca güvenli bir yerde sakladın
