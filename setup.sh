#!/usr/bin/env bash
# Persiapan sekali jalan di VPS: buat .env (secret acak) + akun MQTT untuk ESP32.
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  echo ".env sudah ada, tidak ditimpa."
else
  cp .env.example .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|" .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
  sed -i "s|^MQTT_PASSWORD=.*|MQTT_PASSWORD=$(openssl rand -hex 12)|" .env
  chmod 600 .env
  echo ".env dibuat."
fi

set -a; . ./.env; set +a
mkdir -p mosquitto frontend/dist

docker run --rm -v "$PWD/mosquitto:/work:z" eclipse-mosquitto:2.0 \
  mosquitto_passwd -c -b /work/passwd "$MQTT_USER" "$MQTT_PASSWORD"
sudo chmod 644 mosquitto/passwd

echo
echo "Selesai. Isi di firmware ESP32:"
echo "  MQTT_USER = $MQTT_USER"
echo "  MQTT_PASS = $MQTT_PASSWORD"
echo "Lanjut: taruh hasil build frontend di frontend/dist, lalu  docker compose up -d --build"
