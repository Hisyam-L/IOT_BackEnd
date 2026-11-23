/**
 * TEST 7: REST API Validation Logic
 *
 * Menguji logika validasi yang ada di setiap endpoint REST API
 * (parsing dari flows.json function node code).
 */
const fs = require('fs');
const path = require('path');

const flows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'nodered', 'flows.json'), 'utf-8'));
const nodeMap = {};
flows.forEach(n => { if (n.id) nodeMap[n.id] = n; });

function getCode(nodeId) {
  return nodeMap[nodeId] ? nodeMap[nodeId].func || '' : '';
}

describe('REST API Validation Logic', () => {

  // --- POST /api/auth/login ---
  describe('POST /api/auth/login (fn_login)', () => {
    const code = getCode('fn_login');

    test('validasi username dan password wajib diisi', () => {
      expect(code).toContain("typeof b.username !== 'string'");
      expect(code).toContain("typeof b.password !== 'string'");
    });

    test('membatasi panjang username (max 50) dan password (max 200)', () => {
      expect(code).toContain('b.username.length > 50');
      expect(code).toContain('b.password.length > 200');
    });

    test('rate limiting: 10 percobaan per 5 menit per IP', () => {
      expect(code).toContain('rec.n >= 10');
      expect(code).toContain('300000'); // 5 menit dalam ms
    });

    test('mengambil IP dari X-Real-IP header (melalui Nginx)', () => {
      expect(code).toContain("msg.req.headers['x-real-ip']");
    });

    test('verifikasi password menggunakan pgcrypto crypt()', () => {
      expect(code).toContain('crypt($2, password_hash)');
    });

    test('tidak memerlukan JWT token (auth=false)', () => {
      expect(code).not.toMatch(/bearer.*auth.*verify/i);
      // Login handler tidak punya Bearer check
      expect(code).not.toContain("global.get('auth').verify");
    });

    test('mengembalikan token dan expires_at pada sukses', () => {
      expect(code).toContain('t.token');
      expect(code).toContain('t.expires_at');
    });

    test('status 401 untuk username/password salah', () => {
      expect(code).toContain("E(401, 'UNAUTHORIZED'");
    });

    test('status 429 untuk terlalu banyak percobaan', () => {
      expect(code).toContain("E(429, 'TOO_MANY'");
    });

    test('membersihkan counter setelah login sukses', () => {
      expect(code).toContain('delete tries[ip]');
    });
  });

  // --- GET /api/health ---
  describe('GET /api/health (fn_health)', () => {
    const code = getCode('fn_health');

    test('tidak memerlukan autentikasi', () => {
      expect(code).not.toContain("global.get('auth').verify");
    });

    test('mengembalikan ok, ready, dan time', () => {
      expect(code).toContain('ok: true');
      expect(code).toContain('ready:');
      expect(code).toContain('time:');
    });
  });

  // --- GET /api/state ---
  describe('GET /api/state (fn_state)', () => {
    const code = getCode('fn_state');

    test('memerlukan Bearer token', () => {
      expect(code).toContain("global.get('auth').verify");
    });

    test('status 401 jika token tidak valid', () => {
      expect(code).toContain("E(401, 'UNAUTHORIZED'");
    });

    test('status 503 jika server belum siap', () => {
      expect(code).toContain("E(503, 'NOT_READY'");
    });

    test('mengembalikan snapshot()', () => {
      expect(code).toContain('snapshot()');
    });
  });

  // --- POST /api/rooms/:id/light ---
  describe('POST /api/rooms/:id/light (fn_light)', () => {
    const code = getCode('fn_light');

    test('validasi room_id harus room_01 atau room_02', () => {
      expect(code).toContain('ROOMS.includes(id)');
    });

    test('validasi enabled harus boolean', () => {
      expect(code).toContain("typeof b.enabled !== 'boolean'");
    });

    test('status 503 jika ESP32 offline', () => {
      expect(code).toContain("E(503, 'DEVICE_OFFLINE'");
    });

    test('enabled=true pada mode OFF -> kembali ke AUTO', () => {
      expect(code).toContain("b.enabled && r.mode === 'OFF'");
      expect(code).toContain("setMode(user, id, 'AUTO')");
    });

    test('enabled=false -> mode OFF', () => {
      expect(code).toContain("!b.enabled");
      expect(code).toContain("setMode(user, id, 'OFF')");
    });
  });

  // --- POST /api/rooms/:id/mode ---
  describe('POST /api/rooms/:id/mode (fn_mode)', () => {
    const code = getCode('fn_mode');

    test('validasi mode hanya AUTO, MANUAL, atau OFF', () => {
      expect(code).toContain("['AUTO', 'MANUAL', 'OFF'].includes(b.mode)");
    });

    test('status 503 jika ESP32 offline', () => {
      expect(code).toContain("E(503, 'DEVICE_OFFLINE'");
    });

    test('memanggil setMode()', () => {
      expect(code).toContain('setMode(user, id, b.mode)');
    });
  });

  // --- POST /api/rooms/:id/brightness ---
  describe('POST /api/rooms/:id/brightness (fn_bright)', () => {
    const code = getCode('fn_bright');

    test('validasi brightness harus integer 0-100', () => {
      expect(code).toContain('Number.isInteger(b.brightness)');
      expect(code).toContain('b.brightness < 0');
      expect(code).toContain('b.brightness > 100');
    });

    test('status 409 jika mode bukan MANUAL', () => {
      expect(code).toContain("r.mode !== 'MANUAL'");
      expect(code).toContain("E(409, 'CONFLICT'");
    });

    test('menyimpan brightness ke database', () => {
      expect(code).toContain('saveRoom(id, user.sub)');
    });

    test('mencatat log aktivitas', () => {
      expect(code).toContain("logAct(id, 'COMMAND'");
    });
  });

  // --- POST /api/rooms/:id/target ---
  describe('POST /api/rooms/:id/target (fn_target)', () => {
    const code = getCode('fn_target');

    test('validasi target_lux harus integer 0-2000', () => {
      expect(code).toContain('Number.isInteger(b.target_lux)');
      expect(code).toContain('b.target_lux < 0');
      expect(code).toContain('b.target_lux > 2000');
    });

    test('menyimpan target_lux ke database', () => {
      expect(code).toContain('saveRoom(id, user.sub)');
    });
  });

  // --- GET /api/history/readings ---
  describe('GET /api/history/readings (fn_hread)', () => {
    const code = getCode('fn_hread');

    test('validasi room harus room_01, room_02, atau all', () => {
      expect(code).toContain("['room_01', 'room_02'].includes(room)");
    });

    test('validasi format tanggal YYYY-MM-DD', () => {
      expect(code).toMatch(/\\d\{4\}-\\d\{2\}-\\d\{2\}/);
    });

    test('from tidak boleh setelah to', () => {
      expect(code).toContain('from > to');
    });

    test('rentang maksimal 92 hari', () => {
      expect(code).toContain('days > 92');
    });

    test('menggunakan bucket averaging untuk performa grafik', () => {
      expect(code).toContain('AVG(lux)');
      expect(code).toContain('AVG(brightness_pct)');
    });

    test('default ke hari ini jika from/to tidak diisi', () => {
      expect(code).toContain("q.from ? String(q.from) : today");
      expect(code).toContain("q.to ? String(q.to) : today");
    });
  });

  // --- GET /api/history/activity ---
  describe('GET /api/history/activity (fn_hact)', () => {
    const code = getCode('fn_hact');

    test('membatasi 1000 record', () => {
      expect(code).toContain('LIMIT 1000');
    });

    test('mengurutkan terbaru dulu (DESC)', () => {
      expect(code).toContain('ORDER BY created_at DESC');
    });

    test('menyertakan kejadian perangkat (room_id IS NULL) pada semua filter', () => {
      expect(code).toContain('room_id IS NULL');
    });
  });

  // --- MQTT Logic Nodes ---
  describe('MQTT Logic Nodes', () => {
    test('fn_door: logika pintu + buzzer ada', () => {
      const code = getCode('fn_door');
      expect(code).toContain('distance_cm');
      expect(code).toContain('threshold_cm');
      expect(code).toContain('door_open');
      expect(code).toContain("cmdDevice({ servo: 'OPEN', buzzer: 'ON' })");
      expect(code).toContain("cmdDevice({ servo: 'CLOSED' })");
    });

    test('fn_room: logika AUTO brightness ada', () => {
      const code = getCode('fn_room');
      expect(code).toContain('target_lux');
      expect(code).toContain('tolerance_lux');
      expect(code).toContain('step_pct');
      expect(code).toContain("r.mode === 'AUTO'");
    });

    test('fn_status: handle online/offline', () => {
      const code = getCode('fn_status');
      expect(code).toContain("s === 'online'");
      expect(code).toContain("s === 'offline'");
      expect(code).toContain('touch()');
      expect(code).toContain('setOffline');
    });

    test('fn_watch: watchdog 30 detik', () => {
      const code = getCode('fn_watch');
      expect(code).toContain('30000');
      expect(code).toContain('setOffline');
    });

    test('fn_purge: retensi data berdasarkan RETENTION_DAYS', () => {
      const code = getCode('fn_purge');
      expect(code).toContain('RETENTION_DAYS');
      expect(code).toContain('DELETE FROM sensor_readings');
      expect(code).toContain('DELETE FROM activity_logs');
    });

    test('fn_purge: activity_logs disimpan 2x lebih lama', () => {
      const code = getCode('fn_purge');
      expect(code).toContain('days * 2');
    });
  });
});
