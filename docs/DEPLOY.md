# Deploy ke VPS (Ubuntu) - Smart Daylight Balancing System

Arsitektur: `Browser -> Nginx -> Node-RED -> PostgreSQL` dan `ESP32 <-> Mosquitto <-> Node-RED`.
Semua logika (lampu AUTO/MANUAL, pintu, buzzer, deteksi offline) ada di `nodered/flows.json`.
ESP32 hanya mengirim data sensor dan menjalankan perintah.

## 1. Siapkan VPS (sekali)

```bash
ssh user@IP_VPS
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw allow 1883 && sudo ufw enable
```

## 2. Upload proyek

Dari laptop, build frontend dulu (pastikan `frontend/.env` berisi `VITE_DEMO_MODE=false`, `VITE_API_BASE_URL=/api`, `VITE_WS_URL=/ws`):

```bash
cd frontend && npm install && npm run build && cd ..
rsync -av --exclude node_modules --exclude frontend/node_modules --exclude .env ./ user@IP_VPS:~/smart-daylight/
```

## 3. Jalankan

```bash
cd ~/smart-daylight
chmod +x setup.sh && ./setup.sh        # membuat .env + akun MQTT; catat MQTT_PASS yang tercetak
docker compose up -d --build
docker compose ps                      # semua harus "running" (postgres: healthy)
docker compose logs -f nodered         # tunggu "state dimuat" / "Started flows"
```

Buka `http://IP_VPS`, login `admin` / `admin123`, lalu **langsung ganti password**:

```bash
docker compose exec postgres psql -U daylight -d daylight -c \
 "UPDATE users SET password_hash = crypt('PASSWORD_BARU', gen_salt('bf',10)) WHERE username='admin';"
```

Tambah petugas:

```bash
docker compose exec postgres psql -U daylight -d daylight -c \
 "INSERT INTO users (username,password_hash,full_name,role) VALUES ('budi', crypt('PASS', gen_salt('bf',10)), 'Budi', 'petugas');"
```

## 4. Flash ESP32

1. Arduino IDE: pasang library **PubSubClient**, **ArduinoJson (v7)**, **BH1750 (Christopher Laws)**.
2. Buka `firmware/esp32_daylight/esp32_daylight.ino`, isi `WIFI_SSID`, `WIFI_PASS`, `MQTT_HOST` (IP/domain VPS), `MQTT_PASS` (dari `setup.sh`).
3. Upload, buka Serial Monitor 115200. Harus muncul `MQTT: tersambung`. Dashboard berubah menjadi ESP32 ONLINE.

Cek dari VPS (opsional):

```bash
docker compose exec mosquitto mosquitto_sub -p 1884 -t 'daylight/#' -v
```

## 5. Perilaku sistem

| Kasus | Perilaku |
|---|---|
| AUTO | Tiap telemetri (1 dtk): lux < target-30 naik 5%, lux > target+30 turun 5%, selain itu tahan. |
| MANUAL | Slider dashboard mengirim brightness langsung. |
| OFF | Lampu mati (tombol lampu OFF). Tombol ON kembali ke AUTO. |
| Pintu | Jarak <= `DOOR_THRESHOLD_CM` (default 50): servo OPEN + buzzer 2 dtk. Tutup 3 dtk setelah objek hilang (`DOOR_HOLD_MS`). |
| ESP32 putus | OFFLINE segera (LWT) atau bila tidak ada data 30 dtk. Perintah REST dijawab 503. Saat online lagi, state dikirim ulang otomatis. |

Parameter (ambang pintu, lama buzzer, dll.) ada di `.env`, ubah lalu `docker compose up -d`.
Target lux, toleransi, dan step per ruangan tersimpan di tabel `rooms` (`target_lux`, `tolerance_lux`, `step_pct`).

## 6. HTTPS (opsional, perlu domain yang sudah mengarah ke IP VPS)

```bash
sudo apt install -y certbot
docker compose stop nginx
sudo certbot certonly --standalone -d DOMAIN_ANDA
sed 's/DOMAIN_ANDA/domain-anda.com/g' nginx/ssl.conf.example > nginx/default.conf
docker compose up -d nginx
```

Pembaruan sertifikat otomatis butuh nginx berhenti sebentar:
`sudo certbot renew --pre-hook "docker compose -f ~/smart-daylight/docker-compose.yml stop nginx" --post-hook "docker compose -f ~/smart-daylight/docker-compose.yml start nginx"` (jalankan lewat cron bulanan).

## 7. Editor Node-RED

Tidak dibuka ke internet. Akses lewat SSH tunnel dari laptop:

```bash
ssh -L 1880:127.0.0.1:1880 user@IP_VPS
# lalu buka http://localhost:1880/admin
```

Perubahan di editor tidak permanen kalau container dibuild ulang. Setelah mengedit, Export flows lalu timpa `nodered/flows.json`.

## 8. Perawatan

```bash
docker compose logs -f nodered          # log
docker compose restart nodered          # restart satu layanan
git pull && docker compose up -d --build   # update
docker compose exec postgres pg_dump -U daylight daylight > backup.sql   # backup DB
```

## Troubleshooting

- Login 404 / 502: `docker compose ps`, pastikan nodered running; cek `curl http://localhost/api/health`.
- Dashboard "ESP32 offline": cek `MQTT_HOST` dan port 1883 terbuka, password MQTT sama dengan `.env`.
- Lampu tidak berubah di AUTO: lihat `docker compose logs nodered`; pastikan BH1750 terbaca (`sensor_ok`).
- Lupa password MQTT: `grep MQTT .env`, lalu jalankan ulang `./setup.sh` dan `docker compose restart mosquitto`.
