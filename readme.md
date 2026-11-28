# Smart Daylight Balancing System

**Tema Proyek:** Sistem Pencahayaan Pintar & Akses Otomatis Berbasis IoT (*Smart Building / Home Automation*)

## Deskripsi Singkat

**Smart Daylight Balancing System** adalah sistem berbasis IoT untuk memantau intensitas cahaya alami dan mengatur pencahayaan buatan secara otomatis pada dua ruangan (`room_01` dan `room_02`), sekaligus mengontrol akses pintu otomatis menggunakan sensor jarak ultrasonik, servo, dan buzzer.

Seluruh logika keputusan (kontrol lampu `AUTO`/`MANUAL`/`OFF`, deteksi objek pada pintu, buzzer, serta deteksi status perangkat `ONLINE`/`OFFLINE`) dijalankan secara terpusat di **Node-RED**, sementara **ESP32** bertugas membaca sensor dan mengeksekusi perintah aktuator melalui protokol **MQTT**. Data sensor, konfigurasi ruangan, dan log aktivitas disimpan di **PostgreSQL** dan dipantau secara *real-time* melalui dashboard web (**React** + **WebSocket** + **Nginx**).

## Fitur Utama

- **Kontrol Pencahayaan Otomatis (`AUTO`)**: Menyesuaikan *brightness* LED PWM secara bertahap berdasarkan pembacaan sensor cahaya **BH1750** terhadap `target_lux` dan toleransi ruangan.
- **Kontrol Manual & Sakelar (`MANUAL` / `OFF`)**: Mengatur intensitas LED (0–100%) atau mematikan lampu langsung dari dashboard.
- **Akses Pintu Otomatis**: Mendeteksi objek menggunakan 2 sensor ultrasonik **HC-SR04**; jika jarak ≤ *threshold*, servo membuka pintu dan buzzer berbunyi, lalu menutup otomatis setelah objek menjauh melewati jeda waktu (*hold*).
- **Pemantauan *Real-Time* & Riwayat**: Dashboard web menampilkan status koneksi ESP32 (*LWT* + *watchdog* 30 detik), pembacaan sensor terkini via **WebSocket**, grafik riwayat intensitas cahaya, dan log aktivitas.
- **Keamanan & Autentikasi**: Login pengguna berbasis **JWT** dengan hash password `bcrypt` (`pgcrypto`), pembatasan percobaan login (*rate limiting*), serta autentikasi MQTT untuk ESP32.

## Arsitektur Sistem

```text
Browser (React SPA) ──► Nginx ──► Node-RED (REST API + WebSocket + Logic) ──► PostgreSQL
                                        ▲
                                        │ MQTT (internal :1884)
                                        ▼
ESP32 (BH1750, HC-SR04, LED, Servo, Buzzer) ◄── MQTT (:1883, auth) ──► Mosquitto
```

## Struktur Direktori

```text
smart-daylight/
├── db/
│   └── init.sql                        # Skema tabel PostgreSQL & data awal
├── docs/
│   ├── API_CONTRACT.md                 # Spesifikasi REST API, WebSocket, & topik MQTT
│   └── DEPLOY.md                       # Panduan deployment di VPS Ubuntu
├── firmware/
│   └── esp32_daylight/
│       └── esp32_daylight.ino          # Firmware ESP32 (sensor & aktuator MQTT)
├── frontend/
│   └── dist/                           # Hasil build frontend dashboard (dilayani Nginx)
├── mosquitto/
│   └── mosquitto.conf                  # Konfigurasi broker MQTT Mosquitto
├── nginx/
│   ├── default.conf                    # Reverse proxy HTTP (API, WebSocket, SPA)
│   └── ssl.conf.example                # Contoh konfigurasi HTTPS (Let's Encrypt)
├── nodered/
│   ├── Dockerfile                      # Image Node-RED kustom + pg driver
│   ├── flows.json                      # Alur logika sistem, REST API, & MQTT
│   ├── settings.js                     # Konfigurasi Node-RED, JWT, & pool PostgreSQL
│   └── node/                           # Custom node WebSocket terautentikasi JWT
├── test/                               # Unit & validation test suite (Jest)
│   ├── api-validation.test.js
│   ├── auth.test.js
│   ├── database-schema.test.js
│   ├── firmware-analysis.test.js
│   ├── infrastructure.test.js
│   ├── nodered-logic.test.js
│   └── websocket-node.test.js
├── tools/
│   └── build_flows.py                  # Script generator untuk nodered/flows.json
├── .env.example                        # Template environment variables
├── docker-compose.yml                  # Orkestrasi layanan (postgres, mosquitto, nodered, nginx)
├── package.json                        # Konfigurasi & script pengujian Jest
└── setup.sh                            # Script inisialisasi .env & akun MQTT
```

## Menjalankan Sistem & Pengujian

### 1. Menjalankan Backend & Infrastruktur (Docker)

```bash
chmod +x setup.sh
./setup.sh                  # Membuat .env & kredensial MQTT lokal
docker compose up -d --build
```

Panduan deployment lengkap tersedia di `docs/DEPLOY.md` dan kontrak API di `docs/API_CONTRACT.md`.

### 2. Menjalankan Pengujian (Tests)

Prasyarat: Node.js 18+.

```bash
npm install
npm test
```
