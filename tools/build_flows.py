#!/usr/bin/env python3
"""Membuat nodered/flows.json. Jalankan: python3 tools/build_flows.py
Semua logika sistem ada di function node di bawah ini (bisa diedit juga lewat editor Node-RED)."""
import json, os

TAB = "tab_daylight"
BROKER = "broker_mqtt"
nodes = []


def add(n):
    n.setdefault("z", TAB)
    nodes.append(n)


def fn(id, name, code, outputs, wires, x, y):
    add({"id": id, "type": "function", "name": name, "func": code.strip() + "\n",
         "outputs": outputs, "timeout": 0, "noerr": 0, "initialize": "", "finalize": "",
         "libs": [], "x": x, "y": y, "wires": wires})


# ============================================================
# 1. INIT + PUSTAKA BERSAMA
# ============================================================
INIT = r'''
// Dijalankan saat start, diulang tiap 10 dtk sampai state berhasil dimuat dari PostgreSQL.
if (global.get('ready')) return null;

// ===== PUSTAKA BERSAMA: dipakai semua function node lewat global.get('lib')(node, M, W) =====
// M = daftar pesan ke MQTT out, W = daftar pesan ke WebSocket
global.set('lib', function (node, M, W) {
  const pool = global.get('pool');
  const ROOMS = ['room_01', 'room_02'];
  const nowIso = () => new Date().toISOString();
  const rooms = () => global.get('rooms');
  const device = () => global.get('device');
  const wsm = (type, data) => ({ payload: { type: type, ts: nowIso(), data: data } });

  const roomUpdate = (id) => {
    const r = rooms()[id];
    return { room_id: id, latest_lux: r.latest_lux, brightness: r.brightness,
             led_enabled: r.mode !== 'OFF', mode: r.mode, target_lux: r.target_lux };
  };
  const deviceUpdate = () => {
    const d = device();
    return { distance_cm: d.distance_cm, object_detected: d.object_detected,
             servo_status: d.servo_status, buzzer_status: d.buzzer_status, last_seen: d.last_seen };
  };
  const snapshot = () => {
    const d = device();
    const s = { server_time: nowIso(),
      device: { device_status: d.device_status, last_seen: d.last_seen, distance_cm: d.distance_cm,
                object_detected: d.object_detected, threshold_cm: d.threshold_cm,
                servo_status: d.servo_status, buzzer_status: d.buzzer_status },
      rooms: {} };
    for (const id of ROOMS) {
      const r = rooms()[id];
      s.rooms[id] = { latest_lux: r.latest_lux, target_lux: r.target_lux,
                      led_enabled: r.mode !== 'OFF', brightness: r.brightness, mode: r.mode };
    }
    return s;
  };

  // perintah ke ESP32
  const cmdRoom = (id) => {
    const r = rooms()[id];
    return { topic: 'daylight/' + id + '/cmd', payload: { mode: r.mode, brightness: r.brightness }, qos: 1, retain: true };
  };
  const cmdDevice = (p) => ({ topic: 'daylight/device/cmd', payload: p, qos: 1, retain: false });

  async function logAct(room_id, type, value, note, user_id) {
    try {
      await pool.query('INSERT INTO activity_logs (room_id, type, value, note, user_id) VALUES ($1,$2,$3,$4,$5)',
        [room_id, type, value, note, user_id || null]);
    } catch (e) { node.warn('gagal mencatat aktivitas: ' + e.message); }
  }
  async function saveRoom(id, userId) {
    const r = rooms()[id];
    await pool.query('UPDATE rooms SET mode=$2, target_lux=$3, brightness=$4, updated_by=$5, updated_at=now() WHERE room_id=$1',
      [id, r.mode, r.target_lux, r.brightness, userId || null]);
  }

  // kirim ulang semua state ke ESP32 (setelah ESP32 online / reboot)
  function resync() {
    for (const id of ROOMS) M.push(cmdRoom(id));
    M.push(cmdDevice({ servo: device().door_open ? 'OPEN' : 'CLOSED', buzzer: 'OFF' }));
  }
  function setOffline(reason) {
    const d = device();
    if (d.device_status === 'OFFLINE') return;
    d.device_status = 'OFFLINE';
    W.push(wsm('device.status', { device_status: 'OFFLINE', last_seen: d.last_seen }));
    W.push(wsm('notification', { level: 'error', message: 'ESP32 offline: ' + reason }));
    logAct(null, 'DEVICE_STATUS', 'OFFLINE', reason);
  }
  // dipanggil setiap ada data dari ESP32
  function touch() {
    const d = device();
    d.last_seen = nowIso();
    if (d.device_status !== 'ONLINE') {
      d.device_status = 'ONLINE';
      W.push(wsm('device.status', { device_status: 'ONLINE', last_seen: d.last_seen }));
      W.push(wsm('notification', { level: 'info', message: 'ESP32 online' }));
      logAct(null, 'DEVICE_STATUS', 'ONLINE', 'ESP32 tersambung');
      resync();
    }
  }
  async function setMode(user, id, mode) {
    const r = rooms()[id];
    const old = r.mode;
    r.mode = mode;
    if (mode === 'OFF') r.brightness = 0;
    M.push(cmdRoom(id));
    W.push(wsm('room.update', roomUpdate(id)));
    await saveRoom(id, user.sub);
    if (old !== mode) await logAct(id, 'MODE_CHANGE', mode, old + ' -> ' + mode + ' oleh ' + user.username, user.sub);
  }

  return { ROOMS, nowIso, rooms, device, wsm, roomUpdate, deviceUpdate, snapshot, cmdRoom, cmdDevice,
           logAct, saveRoom, resync, setOffline, touch, setMode };
});

try {
  const pool = global.get('pool');
  const res = await pool.query('SELECT room_id, mode, target_lux, tolerance_lux, step_pct, brightness, latest_lux FROM rooms');
  const rooms = {};
  for (const x of res.rows) {
    rooms[x.room_id] = { mode: x.mode, target_lux: x.target_lux, tolerance_lux: x.tolerance_lux,
      step_pct: x.step_pct, brightness: x.mode === 'OFF' ? 0 : x.brightness,
      latest_lux: x.latest_lux === null ? null : Number(x.latest_lux), sensor_ok: true, last_save: 0 };
  }
  if (!rooms.room_01 || !rooms.room_02) throw new Error('tabel rooms harus berisi room_01 dan room_02');
  global.set('rooms', rooms);
  global.set('device', { device_status: 'OFFLINE', last_seen: null, distance_cm: null, object_detected: false,
    threshold_cm: Number(env.get('DOOR_THRESHOLD_CM')) || 50, hold_ms: Number(env.get('DOOR_HOLD_MS')) || 3000,
    servo_status: 'CLOSED', buzzer_status: 'OFF', door_open: false, last_detected: 0, _lastPush: 0 });
  global.set('ready', true);
  node.status({ fill: 'green', shape: 'dot', text: 'state dimuat' });
} catch (e) {
  node.status({ fill: 'red', shape: 'ring', text: e.message.slice(0, 40) });
  node.warn('init gagal, coba lagi 10 dtk: ' + e.message);
}
return null;
'''

# ============================================================
# 2. LOGIKA MQTT (telemetri -> keputusan)
# ============================================================
MQTT_HEAD = r'''
if (!global.get('ready')) return null;
const pool = global.get('pool');
const M = [], W = [];
const L = global.get('lib')(node, M, W);
const { ROOMS, rooms, device, wsm, roomUpdate, deviceUpdate, cmdRoom, cmdDevice, logAct, touch, setOffline } = L;
try {
'''
MQTT_TAIL = r'''
} catch (e) { node.error(e); return null; }
'''

DOOR = r'''
// Telemetri perangkat: jarak HC-SR04. Keputusan pintu + buzzer dibuat DI SINI, bukan di ESP32.
const p = msg.payload;
if (!p || typeof p !== 'object') return null;
touch();
const d = device();
const t = Date.now();
const dist = (typeof p.distance_cm === 'number' && p.distance_cm > 0 && p.distance_cm < 400) ? p.distance_cm : null;
const detected = dist !== null && dist <= d.threshold_cm;
const before = d.servo_status + '|' + d.buzzer_status + '|' + d.object_detected;

d.distance_cm = dist === null ? null : Math.round(dist * 10) / 10;
d.object_detected = detected;
if (p.servo === 'OPEN' || p.servo === 'CLOSED') d.servo_status = p.servo;
if (p.buzzer === 'ON' || p.buzzer === 'OFF') d.buzzer_status = p.buzzer;

const D = []; // pesan tertunda (buzzer OFF setelah BUZZER_MS)
if (detected) {
  d.last_detected = t;
  if (!d.door_open) {
    d.door_open = true;
    M.push(cmdDevice({ servo: 'OPEN', buzzer: 'ON' }));
    const m = cmdDevice({ buzzer: 'OFF' });
    m.delay = Number(env.get('BUZZER_MS')) || 2000;
    D.push(m);
    await logAct(null, 'ACCESS', 'OPEN', 'Objek terdeteksi ' + d.distance_cm + ' cm, pintu dibuka, buzzer berbunyi');
    d._lastPush = 0;
  }
} else if (d.door_open && t - d.last_detected >= d.hold_ms) {
  d.door_open = false;
  M.push(cmdDevice({ servo: 'CLOSED' }));
  await logAct(null, 'ACCESS', 'CLOSED', 'Objek hilang, pintu ditutup');
  d._lastPush = 0;
}

const after = d.servo_status + '|' + d.buzzer_status + '|' + d.object_detected;
if (before !== after || t - d._lastPush >= 1000) {
  d._lastPush = t;
  W.push(wsm('device.update', deviceUpdate()));
}
return [M, W, D];
'''

ROOM = r'''
// Telemetri lux per ruangan. Mode AUTO dihitung DI SINI (langkah bertahap menuju target lux).
const id = String(msg.topic).split('/')[1];
const r = rooms()[id];
const p = msg.payload;
if (!r || !p || typeof p !== 'object') return null;
touch();

const lux = (typeof p.lux === 'number' && p.lux >= 0 && p.lux <= 100000) ? p.lux : null;
if (lux === null) {
  if (r.sensor_ok) {
    r.sensor_ok = false;
    W.push(wsm('notification', { level: 'error', message: 'Sensor cahaya ' + id + ' error / tidak terbaca' }));
    await logAct(id, 'DEVICE_STATUS', 'SENSOR_ERROR', 'Sensor BH1750 tidak terbaca');
  }
  return [M, W];   // tanpa data valid, jangan ubah kecerahan
}
if (!r.sensor_ok) {
  r.sensor_ok = true;
  W.push(wsm('notification', { level: 'info', message: 'Sensor cahaya ' + id + ' pulih' }));
  await logAct(id, 'DEVICE_STATUS', 'SENSOR_OK', 'Sensor BH1750 terbaca kembali');
}
r.latest_lux = Math.round(lux * 10) / 10;

if (r.mode === 'AUTO') {
  const low = r.target_lux - r.tolerance_lux;
  const high = r.target_lux + r.tolerance_lux;
  let next = r.brightness;
  if (lux < low)       next = Math.min(100, r.brightness + r.step_pct);
  else if (lux > high) next = Math.max(0, r.brightness - r.step_pct);
  if (next !== r.brightness) { r.brightness = next; M.push(cmdRoom(id)); }
}
W.push(wsm('room.update', roomUpdate(id)));

// simpan riwayat tiap READING_INTERVAL_S detik
const t = Date.now();
const every = (Number(env.get('READING_INTERVAL_S')) || 10) * 1000;
if (t - r.last_save >= every) {
  r.last_save = t;
  await pool.query('INSERT INTO sensor_readings (room_id, lux, brightness_pct, mode) VALUES ($1,$2,$3,$4)',
    [id, r.latest_lux, r.brightness, r.mode]);
  await pool.query('UPDATE rooms SET latest_lux=$2, brightness=$3 WHERE room_id=$1', [id, r.latest_lux, r.brightness]);
}
return [M, W];
'''

STATUS = r'''
// Status koneksi ESP32 (LWT retained): "online" / "offline"
const s = String(msg.payload).trim().toLowerCase();
if (s === 'online') touch();
else if (s === 'offline') setOffline('koneksi MQTT terputus');
else return null;
return [M, W];
'''

WATCH = r'''
// Pengawas: ESP32 dianggap OFFLINE bila tidak ada data > 30 detik
const d = device();
if (d.device_status === 'ONLINE' && d.last_seen && Date.now() - Date.parse(d.last_seen) > 30000) {
  setOffline('tidak ada data lebih dari 30 detik');
}
return [M, W];
'''

SNAP = r'''
// Klien WebSocket baru tersambung -> kirim snapshot hanya ke klien itu
if (!global.get('ready')) return null;
const L = global.get('lib')(node, [], []);
return { _client: msg._client, payload: { type: 'snapshot', ts: new Date().toISOString(), data: L.snapshot() } };
'''

PURGE = r'''
const pool = global.get('pool');
const days = Number(env.get('RETENTION_DAYS')) || 90;
try {
  await pool.query("DELETE FROM sensor_readings WHERE recorded_at < now() - make_interval(days => $1::int)", [days]);
  await pool.query("DELETE FROM activity_logs WHERE created_at < now() - make_interval(days => $1::int)", [days * 2]);
} catch (e) { node.warn('purge gagal: ' + e.message); }
return null;
'''

# ============================================================
# 3. REST API
# ============================================================
HTTP_HEAD = r'''
const pool = global.get('pool');
const M = [], W = [];
const reply = (status, payload) => { msg.statusCode = status; msg.payload = payload; return msg; };
const E = (status, code, message) => [reply(status, { error: { code: code, message: message } }), [], []];
const OK = () => [reply(200, { ok: true }), M, W];
try {
'''
HTTP_AUTH = r'''
  const bearer = /^Bearer\s+(.+)$/i.exec(msg.req.headers['authorization'] || '');
  const user = bearer ? global.get('auth').verify(bearer[1]) : null;
  if (!user) return E(401, 'UNAUTHORIZED', 'Token tidak valid atau kedaluwarsa');
'''
HTTP_STATE = r'''
  if (!global.get('ready')) return E(503, 'NOT_READY', 'Server belum siap, coba lagi sebentar');
  const L = global.get('lib')(node, M, W);
  const { ROOMS, rooms, device, wsm, roomUpdate, snapshot, cmdRoom, logAct, saveRoom, setMode } = L;
'''
HTTP_TAIL = r'''
} catch (e) {
  node.error(e);
  return E(503, 'SERVER_ERROR', 'Terjadi kesalahan pada server');
}
'''

ROOM_ID = r'''
  const id = msg.req.params.id;
  if (!ROOMS.includes(id)) return E(400, 'VALIDATION', 'room_id harus room_01 atau room_02');
  const b = msg.payload || {};
'''
OFFLINE = r'''
  if (device().device_status !== 'ONLINE') return E(503, 'DEVICE_OFFLINE', 'ESP32 sedang offline, perintah tidak dikirim');
'''

B_LOGIN = r'''
  const b = msg.payload;
  if (!b || typeof b.username !== 'string' || typeof b.password !== 'string' || !b.username
      || b.username.length > 50 || b.password.length > 200) {
    return E(400, 'VALIDATION', 'username dan password wajib diisi');
  }
  // pembatas percobaan login: 10 gagal / 5 menit per IP
  const ip = msg.req.headers['x-real-ip'] || msg.req.ip || 'unknown';
  const tries = context.get('tries') || {};
  const nowMs = Date.now();
  const rec = (tries[ip] && nowMs - tries[ip].t < 300000) ? tries[ip] : { n: 0, t: nowMs };
  if (rec.n >= 10) return E(429, 'TOO_MANY', 'Terlalu banyak percobaan login, coba lagi beberapa menit');
  // verifikasi bcrypt dilakukan PostgreSQL (pgcrypto crypt())
  const res = await pool.query(
    'UPDATE users SET last_login = now() WHERE username = $1 AND is_active AND password_hash = crypt($2, password_hash) RETURNING user_id, username, role',
    [b.username, b.password]);
  if (res.rowCount === 0) {
    rec.n++; tries[ip] = rec; context.set('tries', tries);
    return E(401, 'UNAUTHORIZED', 'Username atau password salah');
  }
  delete tries[ip]; context.set('tries', tries);
  const u = res.rows[0];
  const t = global.get('auth').sign({ sub: u.user_id, username: u.username, role: u.role });
  return [reply(200, { token: t.token, expires_at: t.expires_at }), [], []];
'''

B_HEALTH = r'''
  return [reply(200, { ok: true, ready: !!global.get('ready'), time: new Date().toISOString() }), [], []];
'''

B_STATE = r'''
  return [reply(200, snapshot()), [], []];
'''

B_LIGHT = ROOM_ID + r'''
  if (typeof b.enabled !== 'boolean') return E(400, 'VALIDATION', 'enabled harus boolean');
''' + OFFLINE + r'''
  const r = rooms()[id];
  if (b.enabled && r.mode === 'OFF') await setMode(user, id, 'AUTO');   // nyalakan = kembali ke AUTO
  else if (!b.enabled) await setMode(user, id, 'OFF');
  return OK();
'''

B_MODE = ROOM_ID + r'''
  if (!['AUTO', 'MANUAL', 'OFF'].includes(b.mode)) return E(400, 'VALIDATION', 'mode harus AUTO, MANUAL, atau OFF');
''' + OFFLINE + r'''
  await setMode(user, id, b.mode);
  return OK();
'''

B_BRIGHT = ROOM_ID + r'''
  if (!Number.isInteger(b.brightness) || b.brightness < 0 || b.brightness > 100) {
    return E(400, 'VALIDATION', 'brightness harus bilangan bulat 0-100');
  }
''' + OFFLINE + r'''
  const r = rooms()[id];
  if (r.mode !== 'MANUAL') return E(409, 'CONFLICT', 'Brightness hanya bisa diatur pada mode MANUAL');
  r.brightness = b.brightness;
  M.push(cmdRoom(id));
  W.push(wsm('room.update', roomUpdate(id)));
  await saveRoom(id, user.sub);
  await logAct(id, 'COMMAND', 'brightness=' + b.brightness, 'Brightness manual ' + b.brightness + '% oleh ' + user.username, user.sub);
  return OK();
'''

B_TARGET = ROOM_ID + r'''
  if (!Number.isInteger(b.target_lux) || b.target_lux < 0 || b.target_lux > 2000) {
    return E(400, 'VALIDATION', 'target_lux harus bilangan bulat 0-2000');
  }
''' + OFFLINE + r'''
  const r = rooms()[id];
  r.target_lux = b.target_lux;
  W.push(wsm('room.update', roomUpdate(id)));
  await saveRoom(id, user.sub);
  await logAct(id, 'COMMAND', 'target_lux=' + b.target_lux, 'Target lux ' + b.target_lux + ' oleh ' + user.username, user.sub);
  return OK();
'''

HIST_COMMON = r'''
  const q = msg.req.query || {};
  const room = (q.room && q.room !== 'all') ? String(q.room) : null;
  if (room && !['room_01', 'room_02'].includes(room)) return E(400, 'VALIDATION', 'room harus room_01, room_02, atau all');
  const tz = env.get('TZ_NAME') || 'Asia/Jakarta';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const from = q.from ? String(q.from) : today;
  const to = q.to ? String(q.to) : today;
  const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
  if (!okDate(from) || !okDate(to)) return E(400, 'VALIDATION', 'from dan to harus berformat YYYY-MM-DD');
  if (from > to) return E(400, 'VALIDATION', 'from tidak boleh setelah to');
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days > 92) return E(400, 'VALIDATION', 'rentang maksimal 92 hari');
'''

B_HREAD = HIST_COMMON + r'''
  // rata-rata per "bucket" waktu agar grafik ringan (maks ~1500 titik per ruangan)
  const bucket = Math.max(10, Math.ceil(days * 86400 / 1500));
  const res = await pool.query(
    `SELECT to_timestamp(floor(extract(epoch FROM recorded_at) / $4::int) * $4::int) AS ts, room_id,
            ROUND(AVG(lux)::numeric, 1) AS lux, ROUND(AVG(brightness_pct))::int AS brightness
       FROM sensor_readings
      WHERE recorded_at >= ($1::date)::timestamp AT TIME ZONE $3
        AND recorded_at <  (($2::date) + 1)::timestamp AT TIME ZONE $3
        AND ($5::text IS NULL OR room_id = $5::text)
      GROUP BY 1, 2 ORDER BY 1, 2`, [from, to, tz, bucket, room]);
  const items = res.rows.map(x => ({ ts: new Date(x.ts).toISOString(), room_id: x.room_id,
                                      lux: Number(x.lux), brightness: x.brightness }));
  return [reply(200, { items: items }), [], []];
'''

B_HACT = HIST_COMMON + r'''
  const res = await pool.query(
    `SELECT created_at AS ts, room_id, type, value, note
       FROM activity_logs
      WHERE created_at >= ($1::date)::timestamp AT TIME ZONE $3
        AND created_at <  (($2::date) + 1)::timestamp AT TIME ZONE $3
        AND ($4::text IS NULL OR room_id = $4::text OR room_id IS NULL)
      ORDER BY created_at DESC LIMIT 1000`, [from, to, tz, room]);
  const items = res.rows.map(x => ({ ts: new Date(x.ts).toISOString(), room_id: x.room_id,
                                      type: x.type, value: x.value, note: x.note }));
  return [reply(200, { items: items }), [], []];
'''


def http_code(body, auth=True, state=True):
    return HTTP_HEAD + (HTTP_AUTH if auth else "") + (HTTP_STATE if state else "") + body + HTTP_TAIL


# ============================================================
# 4. MERAKIT NODE & KABEL
# ============================================================
add({"id": TAB, "type": "tab", "label": "Smart Daylight", "disabled": False,
     "info": "Semua logika sistem: AUTO/MANUAL lampu, pintu + buzzer, deteksi offline, REST API, WebSocket.\n"
             "ESP32 hanya mengirim data & menjalankan perintah.", "z": None})
nodes[0].pop("z")

add({"id": BROKER, "type": "mqtt-broker", "name": "Mosquitto", "broker": "mosquitto", "port": "1884",
     "clientid": "nodered-daylight", "autoConnect": True, "usetls": False, "protocolVersion": "4",
     "keepalive": "60", "cleansession": True, "autoUnsubscribe": True,
     "birthTopic": "", "birthQos": "0", "birthRetain": "false", "birthPayload": "", "birthMsg": {},
     "closeTopic": "", "closeQos": "0", "closeRetain": "false", "closePayload": "", "closeMsg": {},
     "willTopic": "", "willQos": "0", "willRetain": "false", "willPayload": "", "willMsg": {},
     "userProps": "", "sessionExpiry": ""})
nodes[-1].pop("z")

add({"id": "c1", "type": "comment", "name": "== STATE & PUSTAKA ==", "info": "Memuat state dari PostgreSQL dan mendefinisikan fungsi bersama (global 'lib').", "x": 170, "y": 40, "wires": []})
add({"id": "inj_init", "type": "inject", "name": "Init (start + tiap 10s)", "props": [{"p": "payload"}],
     "repeat": "10", "crontab": "", "once": True, "onceDelay": "2", "topic": "", "payload": "", "payloadType": "date",
     "x": 170, "y": 80, "wires": [["fn_init"]]})
fn("fn_init", "Muat state + pustaka", INIT, 1, [[]], 480, 80)

add({"id": "c2", "type": "comment", "name": "== MQTT: ESP32 -> keputusan -> perintah ==", "info": "", "x": 200, "y": 150, "wires": []})
add({"id": "mqtt_tel", "type": "mqtt in", "name": "telemetry", "topic": "daylight/+/telemetry", "qos": "1",
     "datatype": "auto", "broker": BROKER, "nl": False, "rap": True, "rh": 0, "inputs": 0,
     "x": 170, "y": 200, "wires": [["sw_tel"]]})
add({"id": "sw_tel", "type": "switch", "name": "perangkat / ruangan", "property": "topic", "propertyType": "msg",
     "rules": [{"t": "eq", "v": "daylight/device/telemetry", "vt": "str"},
               {"t": "regex", "v": "^daylight/room_0[12]/telemetry$", "vt": "str", "case": False}],
     "checkall": "false", "repair": False, "outputs": 2, "x": 390, "y": 200,
     "wires": [["fn_door"], ["fn_room"]]})
fn("fn_door", "Logika PINTU + BUZZER", MQTT_HEAD + DOOR + MQTT_TAIL, 3,
   [["mqtt_out"], ["ws_out"], ["delay_buz"]], 650, 160)
fn("fn_room", "Logika LAMPU AUTO", MQTT_HEAD + ROOM + MQTT_TAIL, 2,
   [["mqtt_out"], ["ws_out"]], 650, 240)
add({"id": "delay_buz", "type": "delay", "name": "Buzzer berhenti (msg.delay)", "pauseType": "delayv",
     "timeout": "2", "timeoutUnits": "seconds", "rate": "1", "nbRateUnits": "1", "rateUnits": "second",
     "randomFirst": "1", "randomLast": "5", "randomUnits": "seconds", "drop": False, "allowrate": False,
     "outputs": 1, "x": 930, "y": 120, "wires": [["mqtt_out"]]})

add({"id": "mqtt_stat", "type": "mqtt in", "name": "status ESP32", "topic": "daylight/device/status", "qos": "1",
     "datatype": "auto", "broker": BROKER, "nl": False, "rap": True, "rh": 0, "inputs": 0,
     "x": 170, "y": 320, "wires": [["fn_status"]]})
fn("fn_status", "Status online/offline", MQTT_HEAD + STATUS + MQTT_TAIL, 2,
   [["mqtt_out"], ["ws_out"]], 650, 320)
add({"id": "inj_watch", "type": "inject", "name": "tiap 5 dtk", "props": [{"p": "payload"}],
     "repeat": "5", "crontab": "", "once": False, "onceDelay": "", "topic": "", "payload": "", "payloadType": "date",
     "x": 170, "y": 380, "wires": [["fn_watch"]]})
fn("fn_watch", "Deteksi offline 30 dtk", MQTT_HEAD + WATCH + MQTT_TAIL, 2,
   [["mqtt_out"], ["ws_out"]], 650, 380)

add({"id": "mqtt_out", "type": "mqtt out", "name": "perintah ke ESP32", "topic": "", "qos": "", "retain": "",
     "respTopic": "", "contentType": "", "userProps": "", "correl": "", "expiry": "", "broker": BROKER,
     "x": 1200, "y": 200, "wires": []})

add({"id": "c3", "type": "comment", "name": "== WebSocket /ws?token=JWT ==", "info": "", "x": 190, "y": 450, "wires": []})
add({"id": "ws_out", "type": "daylight-ws", "name": "WebSocket server", "path": "/ws",
     "x": 650, "y": 500, "wires": [["fn_snap"]]})
fn("fn_snap", "Snapshot untuk klien baru", SNAP, 1, [["ws_out"]], 930, 500)

add({"id": "c4", "type": "comment", "name": "== REST API /api/... ==", "info": "", "x": 170, "y": 560, "wires": []})
add({"id": "http_resp", "type": "http response", "name": "", "statusCode": "",
     "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"}, "x": 1200, "y": 900, "wires": []})

routes = [
    ("login",  "post", "/api/auth/login",           http_code(B_LOGIN, auth=False, state=False)),
    ("health", "get",  "/api/health",               http_code(B_HEALTH, auth=False, state=False)),
    ("state",  "get",  "/api/state",                http_code(B_STATE)),
    ("light",  "post", "/api/rooms/:id/light",      http_code(B_LIGHT)),
    ("mode",   "post", "/api/rooms/:id/mode",       http_code(B_MODE)),
    ("bright", "post", "/api/rooms/:id/brightness", http_code(B_BRIGHT)),
    ("target", "post", "/api/rooms/:id/target",     http_code(B_TARGET)),
    ("hread",  "get",  "/api/history/readings",     http_code(B_HREAD, state=False)),
    ("hact",   "get",  "/api/history/activity",     http_code(B_HACT, state=False)),
]
y = 610
for key, method, url, code in routes:
    add({"id": "in_" + key, "type": "http in", "name": "", "url": url, "method": method, "upload": False,
         "swaggerDoc": "", "x": 170, "y": y, "wires": [["fn_" + key]]})
    fn("fn_" + key, method.upper() + " " + url, code, 3,
       [["http_resp"], ["mqtt_out"], ["ws_out"]], 650, y)
    y += 50

add({"id": "inj_purge", "type": "inject", "name": "hapus data lama 03:00", "props": [{"p": "payload"}],
     "repeat": "", "crontab": "00 03 * * *", "once": False, "onceDelay": "", "topic": "", "payload": "", "payloadType": "date",
     "x": 170, "y": y + 40, "wires": [["fn_purge"]]})
fn("fn_purge", "Retensi data", PURGE, 1, [[]], 650, y + 40)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "nodered", "flows.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(nodes, f, indent=2, ensure_ascii=False)
print("ditulis:", os.path.normpath(out), "-", len(nodes), "node")
