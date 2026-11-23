# Kontrak API Smart Daylight Balancing System

Semua komunikasi frontend hanya ke Node-RED (lewat Nginx). Frontend tidak pernah menghubungi ESP32 atau MQTT.

## Aturan umum
- Base URL REST: `VITE_API_BASE_URL` (default `/api`). WebSocket: `VITE_WS_URL` (default `/ws`).
- Semua endpoint kecuali `/auth/login` dan `/health` memakai header `Authorization: Bearer <jwt>`. WebSocket memakai `?token=<jwt>` (token tidak valid -> handshake ditolak 401).
- Waktu memakai ISO 8601 UTC. `room_id` bernilai `room_01` atau `room_02`.
- Error: `{ "error": { "code": "VALIDATION", "message": "..." } }` dengan status 400, 401, 409, 429 (terlalu banyak percobaan login), atau 503.
- Data tingkat perangkat (`device`): status ESP32, ultrasonik, servo, buzzer. Data per ruangan (`rooms`): lux, LED, brightness, mode, target.
- ESP32 dianggap OFFLINE jika tidak mengirim data lebih dari 30 detik, atau broker mengumumkan LWT `offline`.

## REST
| Method | Path | Body / Query | Respons |
|---|---|---|---|
| GET | /health | - | `{ok, ready, time}` (tanpa token) |
| POST | /auth/login | `{username, password}` | `{token, expires_at}` |
| GET | /state | - | Snapshot (lihat bawah) |
| POST | /rooms/:id/light | `{enabled: bool}` | `{ok: true}`. `false` = mode OFF, `true` = kembali ke AUTO bila sedang OFF |
| POST | /rooms/:id/mode | `{mode: "AUTO"\|"MANUAL"\|"OFF"}` | `{ok: true}` |
| POST | /rooms/:id/brightness | `{brightness: int 0-100}` | `{ok: true}`. 409 jika mode bukan MANUAL |
| POST | /rooms/:id/target | `{target_lux: int 0-2000}` | `{ok: true}` |
| GET | /history/readings | `room (room_01\|room_02\|all), from, to` (`YYYY-MM-DD`, default hari ini, maks 92 hari) | `{items: [{ts, room_id, lux, brightness}]}` (dirata-rata per interval waktu) |
| GET | /history/activity | `room, from, to` | `{items: [{ts, room_id, type, value, note}]}` terbaru dulu, maks 1000 |

`type` pada activity: `MODE_CHANGE`, `COMMAND`, `ACCESS`, `DEVICE_STATUS`.
Kejadian tingkat perangkat (pintu, ESP32 online/offline) memiliki `room_id: null` dan ikut tampil pada filter ruangan mana pun.
Perintah dikirim 503 jika ESP32 OFFLINE. Perubahan state dikonfirmasi lewat WebSocket, bukan lewat respons REST.
`led_enabled` = `mode !== "OFF"`.

## Snapshot (`GET /state` dan pesan WebSocket `snapshot`)
```json
{
  "server_time": "2026-11-23T08:00:00Z",
  "device": { "device_status": "ONLINE", "last_seen": "2026-11-23T07:59:58Z", "distance_cm": 82.4,
              "object_detected": false, "threshold_cm": 50, "servo_status": "CLOSED", "buzzer_status": "OFF" },
  "rooms": { "room_01": { "latest_lux": 412, "target_lux": 500, "led_enabled": true, "brightness": 38, "mode": "AUTO" },
             "room_02": { "latest_lux": 530, "target_lux": 500, "led_enabled": false, "brightness": 0, "mode": "OFF" } }
}
```
`latest_lux` dan `distance_cm` bisa `null` sebelum ada data valid.

## WebSocket
Format pesan: `{ "type": "...", "ts": "...", "data": {...} }`
- `snapshot`: dikirim sekali saat tersambung, isi sama dengan `/state`.
- `room.update`: `{room_id, latest_lux?, brightness?, led_enabled?, mode?, target_lux?}`
- `device.update`: `{distance_cm?, object_detected?, servo_status?, buzzer_status?, last_seen?}` (maks ~1x/detik kecuali ada perubahan status)
- `device.status`: `{device_status, last_seen}`
- `notification`: `{level: "error"|"info", message}`, contoh saat perangkat offline.

## MQTT (Node-RED <-> ESP32)
ESP32 hanya mengirim data dan menjalankan perintah. Semua keputusan dibuat Node-RED.
- ESP32 publish:
  - `daylight/room_01/telemetry`, `daylight/room_02/telemetry`: `{lux, sensor_ok}` tiap 1 dtk (`lux: null` bila sensor error)
  - `daylight/device/telemetry`: `{distance_cm, distance1_cm, distance2_cm, servo: "OPEN"|"CLOSED", buzzer: "ON"|"OFF"}` tiap 250 ms (`distance_cm` = jarak terdekat dari kedua HC-SR04)
  - `daylight/device/status`: `online` / `offline` (retained, LWT)
- Node-RED publish:
  - `daylight/{room_id}/cmd`: `{mode, brightness}` (retained; ESP32 memakai `brightness`)
  - `daylight/device/cmd`: `{servo?: "OPEN"|"CLOSED", buzzer?: "ON"|"OFF"}` (tidak retained)
- Pintu: jarak <= `threshold_cm` -> `{servo:"OPEN", buzzer:"ON"}`, 2 dtk kemudian `{buzzer:"OFF"}`; objek hilang 3 dtk -> `{servo:"CLOSED"}`.
- Broker: ESP32 memakai port 1883 (login wajib); Node-RED memakai listener internal 1884.
