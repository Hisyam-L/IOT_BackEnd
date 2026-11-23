#!/usr/bin/env bash
# ==============================================================================
# Script Migrasi & Setup Otomatis Smart Daylight Balancing System ke Bare-Metal LXC
# Mengeksekusi checklist 1 s.d. 7 secara end-to-end.
# Jalankan dengan: sudo bash lxc/setup-lxc.sh
# ==============================================================================
set -euo pipefail

# Warna output terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_err() { echo -e "${RED}[ERROR]${NC} $1"; }

# 0. Verifikasi akses root
if [ "$(id -u)" -ne 0 ]; then
  log_err "Script ini harus dijalankan dengan hak akses root / sudo."
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log_info "Direktori root repositori: $REPO_DIR"

# ==============================================================================
# 1. Environment Variables (.env)
# ==============================================================================
log_info "=== 1. Memeriksa & Menyiapkan Environment Variables (.env) ==="

ENV_FILE="$REPO_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  log_warn ".env tidak ditemukan di $REPO_DIR. Membuat dari .env.example..."
  if [ -f "$REPO_DIR/.env.example" ]; then
    cp "$REPO_DIR/.env.example" "$ENV_FILE"
    sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|" "$ENV_FILE"
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" "$ENV_FILE"
    sed -i "s|^MQTT_PASSWORD=.*|MQTT_PASSWORD=$(openssl rand -hex 12)|" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    log_ok ".env berhasil dibuat dengan kredensial acak."
  else
    log_err "File .env.example tidak ditemukan di $REPO_DIR. Hentikan."
    exit 1
  fi
fi

# Pastikan PGHOST dan MQTT_HOST bernilai localhost
if ! grep -q "^PGHOST=" "$ENV_FILE"; then
  echo "PGHOST=localhost" >> "$ENV_FILE"
fi
if ! grep -q "^PGPORT=" "$ENV_FILE"; then
  echo "PGPORT=5432" >> "$ENV_FILE"
fi
if ! grep -q "^MQTT_HOST=" "$ENV_FILE"; then
  echo "MQTT_HOST=localhost" >> "$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Validasi JWT_SECRET
if [ ${#JWT_SECRET} -lt 16 ]; then
  log_err "JWT_SECRET terlalu pendek (minimal 16 karakter). Harap perbaiki di $ENV_FILE"
  exit 1
fi
log_ok "Environment variables valid (DB: $POSTGRES_DB, User: $POSTGRES_USER, MQTT User: $MQTT_USER)"

# ==============================================================================
# 2. PostgreSQL & Skema Database
# ==============================================================================
log_info "=== 2. Memeriksa & Mengonfigurasi PostgreSQL ==="

systemctl start postgresql
if ! systemctl is-active --quiet postgresql; then
  log_err "postgresql.service tidak aktif. Pastikan PostgreSQL sudah terpasang."
  exit 1
fi
log_ok "postgresql.service aktif."

# Pastikan user database ada
log_info "Memastikan role PostgreSQL '$POSTGRES_USER' dan database '$POSTGRES_DB'..."
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$POSTGRES_USER'" | grep -q 1 || \
sudo -u postgres psql -c "CREATE USER $POSTGRES_USER WITH ENCRYPTED PASSWORD '$POSTGRES_PASSWORD';"

# Update password user jika sudah ada
sudo -u postgres psql -c "ALTER USER $POSTGRES_USER WITH ENCRYPTED PASSWORD '$POSTGRES_PASSWORD';"

# Pastikan database ada
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$POSTGRES_DB'" | grep -q 1 || \
sudo -u postgres psql -c "CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER;"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $POSTGRES_DB TO $POSTGRES_USER;"

# Inisialisasi skema tabel jika belum ada
TABLE_COUNT=$(sudo -u postgres psql -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
if [ "$TABLE_COUNT" -eq 0 ]; then
  log_info "Mengeksekusi $REPO_DIR/db/init.sql ke database $POSTGRES_DB..."
  sudo -u postgres psql -d "$POSTGRES_DB" -f "$REPO_DIR/db/init.sql"
  log_ok "Skema database berhasil diinisialisasi."
else
  log_ok "Tabel database sudah ada ($TABLE_COUNT tabel ditemukan)."
fi

# ==============================================================================
# 3. Mosquitto MQTT Broker
# ==============================================================================
log_info "=== 3. Mengonfigurasi Mosquitto MQTT Broker ==="

mkdir -p /var/lib/mosquitto /var/log/mosquitto /etc/mosquitto/conf.d
chown -R mosquitto:mosquitto /var/lib/mosquitto /var/log/mosquitto 2>/dev/null || true

# Pasang mosquitto.conf untuk LXC
cp "$REPO_DIR/lxc/mosquitto.conf" /etc/mosquitto/conf.d/daylight.conf

# Buat file password mosquitto
PASSWORD_FILE="/etc/mosquitto/passwd"
touch "$PASSWORD_FILE"
mosquitto_passwd -b "$PASSWORD_FILE" "$MQTT_USER" "$MQTT_PASSWORD"
chown mosquitto:mosquitto "$PASSWORD_FILE"
chmod 600 "$PASSWORD_FILE"

systemctl restart mosquitto
if ! systemctl is-active --quiet mosquitto; then
  log_err "Gagal memulai mosquitto.service. Cek journalctl -u mosquitto"
  exit 1
fi
log_ok "mosquitto.service aktif dan berjalan."

# ==============================================================================
# 4. Node.js 20 & Node-RED
# ==============================================================================
log_info "=== 4. Memeriksa Node.js 20 & Memasang Dependensi Node-RED ==="

if ! command -v node >/dev/null 2>&1; then
  log_err "Node.js belum terpasang. Pasang Node.js v20 terlebih dahulu."
  exit 1
fi
NODE_VER=$(node -v)
log_ok "Versi Node.js: $NODE_VER"

if ! command -v node-red >/dev/null 2>&1; then
  log_warn "Binary 'node-red' belum terpasang global. Memasang node-red via npm..."
  npm install -g --unsafe-perm node-red
fi

# Pasang custom node & pg driver di folder nodered
log_info "Memasang modul dependensi di $REPO_DIR/nodered..."
cd "$REPO_DIR/nodered"
npm install --no-audit --no-fund --install-links ./node pg@8
cd "$REPO_DIR"

# Buat & pasang nodered.service
log_info "Menyiapkan systemd service /etc/systemd/system/nodered.service..."
sed -e "s|WorkingDirectory=.*|WorkingDirectory=$REPO_DIR/nodered|" \
    -e "s|EnvironmentFile=.*|EnvironmentFile=$ENV_FILE|" \
    -e "s|ExecStart=.*|ExecStart=$(command -v node-red) --userDir $REPO_DIR/nodered --settings $REPO_DIR/nodered/settings.js|" \
    "$REPO_DIR/lxc/nodered.service" > /etc/systemd/system/nodered.service

systemctl daemon-reload
systemctl enable --now nodered
systemctl restart nodered
sleep 2

if ! systemctl is-active --quiet nodered; then
  log_warn "nodered.service belum aktif sempurna. Cek log:"
  journalctl -u nodered -n 20 --no-pager
else
  log_ok "nodered.service berhasil berjalan."
fi

# ==============================================================================
# 5. Frontend Build (frontend/dist)
# ==============================================================================
log_info "=== 5. Memeriksa & Menyiapkan Frontend Build ==="

DIST_DIR="$REPO_DIR/frontend/dist"
mkdir -p "$DIST_DIR"

if [ ! -f "$DIST_DIR/index.html" ]; then
  # Cek jika ada source project frontend di repo tetangga atau subdirektori
  FRONTEND_SRC=""
  if [ -f "$REPO_DIR/../Smart-Daylight-Balancing-System/frontend/package.json" ]; then
    FRONTEND_SRC="$(cd "$REPO_DIR/../Smart-Daylight-Balancing-System/frontend" && pwd)"
  elif [ -f "$REPO_DIR/frontend/package.json" ]; then
    FRONTEND_SRC="$REPO_DIR/frontend"
  fi

  if [ -n "$FRONTEND_SRC" ]; then
    log_info "Membangun frontend dari sumber di $FRONTEND_SRC..."
    cd "$FRONTEND_SRC"
    npm install
    npm run build
    if [ "$FRONTEND_SRC" != "$REPO_DIR/frontend" ]; then
      cp -r dist/* "$DIST_DIR/"
    fi
    cd "$REPO_DIR"
    log_ok "Frontend berhasil dibuild ke $DIST_DIR."
  else
    log_warn "Sumber frontend tidak ditemukan. Buat index.html placeholder di $DIST_DIR."
    echo '<!DOCTYPE html><html><head><title>Smart Daylight</title></head><body><h1>Smart Daylight API Ready</h1></body></html>' > "$DIST_DIR/index.html"
  fi
fi

# Set izin direktori agar bisa dibaca www-data (Nginx)
chmod -R 755 "$DIST_DIR"
# Pastikan parent dirs memiliki permission execute (+x)
PARENT="$REPO_DIR"
while [ "$PARENT" != "/" ] && [ "$PARENT" != "." ]; do
  chmod a+x "$PARENT" 2>/dev/null || true
  PARENT="$(dirname "$PARENT")"
done
log_ok "Izin direktori $DIST_DIR disetel untuk www-data."

# ==============================================================================
# 6. Nginx Reverse Proxy
# ==============================================================================
log_info "=== 6. Mengonfigurasi Nginx Reverse Proxy ==="

NGINX_CONF_TARGET="/etc/nginx/sites-available/smart-daylight"
sed -e "s|root .*|root $DIST_DIR;|" "$REPO_DIR/lxc/nginx-daylight.conf" > "$NGINX_CONF_TARGET"

mkdir -p /etc/nginx/sites-enabled
ln -sf "$NGINX_CONF_TARGET" /etc/nginx/sites-enabled/smart-daylight

# Hapus default vhost agar tidak bentrok di port 80
if [ -f /etc/nginx/sites-enabled/default ]; then
  rm -f /etc/nginx/sites-enabled/default
fi

# Uji konfigurasi Nginx
nginx -t
systemctl reload nginx || systemctl restart nginx
log_ok "Nginx reverse proxy berhasil di-reload."

# ==============================================================================
# 7. Jaringan, Firewall & Verifikasi Port Listening
# ==============================================================================
log_info "=== 7. Verifikasi Port Listening & Status Layanan ==="

echo -e "\n--- Port Status (ss -tulpn) ---"
ss -tulpn | grep -E ':(80|1880|1883|1884|5432)' || true

echo -e "\n--- Systemd Services Status ---"
for svc in postgresql mosquitto nodered nginx; do
  STATUS=$(systemctl is-active "$svc" 2>/dev/null || echo "not-found")
  if [ "$STATUS" = "active" ]; then
    echo -e "  $svc: ${GREEN}ACTIVE${NC}"
  else
    echo -e "  $svc: ${RED}$STATUS${NC}"
  fi
done

echo
log_ok "Seluruh tahapan migrasi ke bare-metal LXC selesai dijalankan!"
echo -e "Kredensial ESP32 yang dipakai:"
echo -e "  Broker IP : <IP_SERVER_LXC>"
echo -e "  MQTT Port : 1883"
echo -e "  MQTT User : $MQTT_USER"
echo -e "  MQTT Pass : $MQTT_PASSWORD"
