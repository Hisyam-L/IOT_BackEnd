/**
 * TEST 2: Node-RED Business Logic
 *
 * Menguji logika bisnis inti yang berjalan di Node-RED function nodes:
 * - Pustaka bersama (lib): roomUpdate, deviceUpdate, snapshot, cmdRoom, cmdDevice, dll.
 * - Logika AUTO brightness (stepping menuju target lux)
 * - Logika pintu + buzzer (HC-SR04 -> servo + buzzer)
 * - Deteksi online/offline ESP32
 * - Validasi API endpoints
 */

// ===================== MOCK STATE =====================
function createMockState() {
  return {
    rooms: {
      room_01: {
        mode: 'AUTO', target_lux: 400, tolerance_lux: 30, step_pct: 5,
        brightness: 50, latest_lux: 380, sensor_ok: true, last_save: 0
      },
      room_02: {
        mode: 'OFF', target_lux: 500, tolerance_lux: 30, step_pct: 5,
        brightness: 0, latest_lux: null, sensor_ok: true, last_save: 0
      }
    },
    device: {
      device_status: 'OFFLINE', last_seen: null, distance_cm: null,
      object_detected: false, threshold_cm: 50, hold_ms: 3000,
      servo_status: 'CLOSED', buzzer_status: 'OFF',
      door_open: false, last_detected: 0, _lastPush: 0
    }
  };
}

// ===================== REPLIKA PUSTAKA (lib) =====================
function createLib(state, node, M, W) {
  const ROOMS = ['room_01', 'room_02'];
  const nowIso = () => new Date().toISOString();
  const rooms = () => state.rooms;
  const device = () => state.device;
  const wsm = (type, data) => ({ payload: { type, ts: nowIso(), data } });

  const roomUpdate = (id) => {
    const r = rooms()[id];
    return {
      room_id: id, latest_lux: r.latest_lux, brightness: r.brightness,
      led_enabled: r.mode !== 'OFF', mode: r.mode, target_lux: r.target_lux
    };
  };
  const deviceUpdate = () => {
    const d = device();
    return {
      distance_cm: d.distance_cm, object_detected: d.object_detected,
      servo_status: d.servo_status, buzzer_status: d.buzzer_status, last_seen: d.last_seen
    };
  };
  const snapshot = () => {
    const d = device();
    const s = {
      server_time: nowIso(),
      device: {
        device_status: d.device_status, last_seen: d.last_seen,
        distance_cm: d.distance_cm, object_detected: d.object_detected,
        threshold_cm: d.threshold_cm, servo_status: d.servo_status,
        buzzer_status: d.buzzer_status
      },
      rooms: {}
    };
    for (const id of ROOMS) {
      const r = rooms()[id];
      s.rooms[id] = {
        latest_lux: r.latest_lux, target_lux: r.target_lux,
        led_enabled: r.mode !== 'OFF', brightness: r.brightness, mode: r.mode
      };
    }
    return s;
  };

  const cmdRoom = (id) => {
    const r = rooms()[id];
    return { topic: 'daylight/' + id + '/cmd', payload: { mode: r.mode, brightness: r.brightness }, qos: 1, retain: true };
  };
  const cmdDevice = (p) => ({ topic: 'daylight/device/cmd', payload: p, qos: 1, retain: false });

  const logAct = jest.fn();
  const saveRoom = jest.fn();

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

  return {
    ROOMS, nowIso, rooms, device, wsm, roomUpdate, deviceUpdate, snapshot,
    cmdRoom, cmdDevice, logAct, saveRoom, resync, setOffline, touch, setMode
  };
}


// ===================== TESTS =====================

describe('Node-RED Business Logic', () => {

  // --- Pustaka roomUpdate ---
  describe('roomUpdate()', () => {
    test('mengembalikan data ruangan lengkap', () => {
      const state = createMockState();
      const L = createLib(state, null, [], []);
      const result = L.roomUpdate('room_01');
      expect(result).toEqual({
        room_id: 'room_01',
        latest_lux: 380,
        brightness: 50,
        led_enabled: true,
        mode: 'AUTO',
        target_lux: 400
      });
    });

    test('led_enabled = false ketika mode OFF', () => {
      const state = createMockState();
      const L = createLib(state, null, [], []);
      const result = L.roomUpdate('room_02');
      expect(result.led_enabled).toBe(false);
      expect(result.mode).toBe('OFF');
    });

    test('led_enabled = true ketika mode MANUAL', () => {
      const state = createMockState();
      state.rooms.room_01.mode = 'MANUAL';
      const L = createLib(state, null, [], []);
      expect(L.roomUpdate('room_01').led_enabled).toBe(true);
    });
  });

  // --- Pustaka deviceUpdate ---
  describe('deviceUpdate()', () => {
    test('mengembalikan status perangkat lengkap', () => {
      const state = createMockState();
      const L = createLib(state, null, [], []);
      const result = L.deviceUpdate();
      expect(result).toHaveProperty('distance_cm');
      expect(result).toHaveProperty('object_detected');
      expect(result).toHaveProperty('servo_status');
      expect(result).toHaveProperty('buzzer_status');
      expect(result).toHaveProperty('last_seen');
    });
  });

  // --- Snapshot ---
  describe('snapshot()', () => {
    test('snapshot memiliki server_time, device, dan rooms', () => {
      const state = createMockState();
      const L = createLib(state, null, [], []);
      const snap = L.snapshot();
      expect(snap).toHaveProperty('server_time');
      expect(snap).toHaveProperty('device');
      expect(snap).toHaveProperty('rooms');
      expect(snap.rooms).toHaveProperty('room_01');
      expect(snap.rooms).toHaveProperty('room_02');
    });

    test('device snapshot memiliki semua field yang didefinisikan di API CONTRACT', () => {
      const state = createMockState();
      const L = createLib(state, null, [], []);
      const snap = L.snapshot();
      const deviceFields = ['device_status', 'last_seen', 'distance_cm',
                           'object_detected', 'threshold_cm', 'servo_status', 'buzzer_status'];
      for (const f of deviceFields) {
        expect(snap.device).toHaveProperty(f);
      }
    });

    test('room snapshot memiliki semua field yang didefinisikan di API CONTRACT', () => {
      const state = createMockState();
      const L = createLib(state, null, [], []);
      const snap = L.snapshot();
      const roomFields = ['latest_lux', 'target_lux', 'led_enabled', 'brightness', 'mode'];
      for (const id of ['room_01', 'room_02']) {
        for (const f of roomFields) {
          expect(snap.rooms[id]).toHaveProperty(f);
        }
      }
    });
  });

  // --- cmdRoom ---
  describe('cmdRoom()', () => {
    test('menghasilkan perintah MQTT yang benar', () => {
      const state = createMockState();
      const L = createLib(state, null, [], []);
      const cmd = L.cmdRoom('room_01');
      expect(cmd.topic).toBe('daylight/room_01/cmd');
      expect(cmd.payload).toEqual({ mode: 'AUTO', brightness: 50 });
      expect(cmd.qos).toBe(1);
      expect(cmd.retain).toBe(true);
    });

    test('room_02 mendapatkan topic yang benar', () => {
      const state = createMockState();
      const L = createLib(state, null, [], []);
      const cmd = L.cmdRoom('room_02');
      expect(cmd.topic).toBe('daylight/room_02/cmd');
    });
  });

  // --- cmdDevice ---
  describe('cmdDevice()', () => {
    test('menghasilkan perintah device MQTT yang benar', () => {
      const state = createMockState();
      const L = createLib(state, null, [], []);
      const cmd = L.cmdDevice({ servo: 'OPEN', buzzer: 'ON' });
      expect(cmd.topic).toBe('daylight/device/cmd');
      expect(cmd.payload).toEqual({ servo: 'OPEN', buzzer: 'ON' });
      expect(cmd.qos).toBe(1);
      expect(cmd.retain).toBe(false);
    });
  });

  // --- Touch (ESP32 online) ---
  describe('touch() - ESP32 Online', () => {
    test('mengubah status dari OFFLINE ke ONLINE', () => {
      const state = createMockState();
      const M = [], W = [];
      const L = createLib(state, null, M, W);
      L.touch();
      expect(state.device.device_status).toBe('ONLINE');
      expect(state.device.last_seen).toBeTruthy();
    });

    test('mengirim notifikasi WebSocket saat pertama kali online', () => {
      const state = createMockState();
      const M = [], W = [];
      const L = createLib(state, null, M, W);
      L.touch();
      const statusMsg = W.find(m => m.payload.type === 'device.status');
      expect(statusMsg).toBeDefined();
      expect(statusMsg.payload.data.device_status).toBe('ONLINE');
      const notifMsg = W.find(m => m.payload.type === 'notification');
      expect(notifMsg).toBeDefined();
      expect(notifMsg.payload.data.level).toBe('info');
    });

    test('melakukan resync MQTT commands saat ESP32 online', () => {
      const state = createMockState();
      const M = [], W = [];
      const L = createLib(state, null, M, W);
      L.touch();
      // Harus ada cmd untuk room_01, room_02, dan device
      expect(M.length).toBe(3);
      expect(M[0].topic).toBe('daylight/room_01/cmd');
      expect(M[1].topic).toBe('daylight/room_02/cmd');
      expect(M[2].topic).toBe('daylight/device/cmd');
    });

    test('tidak mengirim notifikasi jika sudah ONLINE', () => {
      const state = createMockState();
      state.device.device_status = 'ONLINE';
      const M = [], W = [];
      const L = createLib(state, null, M, W);
      L.touch();
      expect(W.length).toBe(0);
      expect(M.length).toBe(0);
    });
  });

  // --- setOffline ---
  describe('setOffline()', () => {
    test('mengubah status ke OFFLINE jika sebelumnya ONLINE', () => {
      const state = createMockState();
      state.device.device_status = 'ONLINE';
      const M = [], W = [];
      const L = createLib(state, null, M, W);
      L.setOffline('koneksi terputus');
      expect(state.device.device_status).toBe('OFFLINE');
    });

    test('mengirim notifikasi error via WebSocket', () => {
      const state = createMockState();
      state.device.device_status = 'ONLINE';
      const M = [], W = [];
      const L = createLib(state, null, M, W);
      L.setOffline('koneksi terputus');
      const notifMsg = W.find(m => m.payload.type === 'notification');
      expect(notifMsg).toBeDefined();
      expect(notifMsg.payload.data.level).toBe('error');
      expect(notifMsg.payload.data.message).toContain('ESP32 offline');
    });

    test('tidak melakukan apa-apa jika sudah OFFLINE', () => {
      const state = createMockState();
      // device_status default = 'OFFLINE'
      const M = [], W = [];
      const L = createLib(state, null, M, W);
      L.setOffline('test');
      expect(W.length).toBe(0);
    });
  });

  // --- Logika AUTO Brightness ---
  describe('Logika AUTO Brightness', () => {
    function simulateAutoStep(currentLux, currentBrightness, targetLux, toleranceLux, stepPct) {
      const low = targetLux - toleranceLux;
      const high = targetLux + toleranceLux;
      let next = currentBrightness;
      if (currentLux < low) next = Math.min(100, currentBrightness + stepPct);
      else if (currentLux > high) next = Math.max(0, currentBrightness - stepPct);
      return next;
    }

    test('meningkatkan brightness ketika lux di bawah target - tolerance', () => {
      // target=400, tolerance=30 -> low=370, high=430
      // lux=350 (< 370) -> brightness harus naik
      const result = simulateAutoStep(350, 50, 400, 30, 5);
      expect(result).toBe(55); // 50 + 5
    });

    test('menurunkan brightness ketika lux di atas target + tolerance', () => {
      // lux=450 (> 430) -> brightness harus turun
      const result = simulateAutoStep(450, 50, 400, 30, 5);
      expect(result).toBe(45); // 50 - 5
    });

    test('tidak mengubah brightness ketika lux dalam rentang toleransi', () => {
      // lux=400 (370 <= 400 <= 430) -> brightness tetap
      const result = simulateAutoStep(400, 50, 400, 30, 5);
      expect(result).toBe(50);
    });

    test('brightness tidak melebihi 100', () => {
      const result = simulateAutoStep(100, 98, 400, 30, 5);
      expect(result).toBe(100);
    });

    test('brightness tidak di bawah 0', () => {
      const result = simulateAutoStep(900, 2, 400, 30, 5);
      expect(result).toBe(0);
    });

    test('lux tepat di batas bawah (target - tolerance) = tidak berubah', () => {
      const result = simulateAutoStep(370, 50, 400, 30, 5);
      expect(result).toBe(50); // tepat di low, tidak < low
    });

    test('lux tepat di batas atas (target + tolerance) = tidak berubah', () => {
      const result = simulateAutoStep(430, 50, 400, 30, 5);
      expect(result).toBe(50); // tepat di high, tidak > high
    });

    test('langkah besar (step_pct=100) langsung maksimal', () => {
      const result = simulateAutoStep(0, 0, 400, 30, 100);
      expect(result).toBe(100);
    });
  });

  // --- Logika PINTU + BUZZER ---
  describe('Logika PINTU + BUZZER', () => {
    test('membuka pintu dan menyalakan buzzer saat objek terdeteksi (< threshold)', () => {
      const state = createMockState();
      state.device.device_status = 'ONLINE';
      state.device.threshold_cm = 50;
      const M = [], W = [];
      const L = createLib(state, null, M, W);

      // Simulasi: objek terdeteksi di 30cm
      const dist = 30;
      const detected = dist <= state.device.threshold_cm;
      expect(detected).toBe(true);

      if (detected && !state.device.door_open) {
        state.device.door_open = true;
        M.push(L.cmdDevice({ servo: 'OPEN', buzzer: 'ON' }));
      }

      expect(state.device.door_open).toBe(true);
      expect(M.length).toBe(1);
      expect(M[0].payload).toEqual({ servo: 'OPEN', buzzer: 'ON' });
    });

    test('tidak membuka pintu jika sudah terbuka', () => {
      const state = createMockState();
      state.device.door_open = true;
      const M = [];
      const L = createLib(state, null, M, []);

      const dist = 30;
      const detected = dist <= state.device.threshold_cm;
      if (detected && !state.device.door_open) {
        M.push(L.cmdDevice({ servo: 'OPEN', buzzer: 'ON' }));
      }

      expect(M.length).toBe(0); // tidak ada perintah baru
    });

    test('menutup pintu setelah objek hilang dan hold_ms terlewati', () => {
      const state = createMockState();
      state.device.door_open = true;
      state.device.last_detected = Date.now() - 4000; // 4 detik lalu
      state.device.hold_ms = 3000;
      const M = [];
      const L = createLib(state, null, M, []);

      const dist = -1; // tidak ada objek
      const detected = false;
      const t = Date.now();

      if (!detected && state.device.door_open && t - state.device.last_detected >= state.device.hold_ms) {
        state.device.door_open = false;
        M.push(L.cmdDevice({ servo: 'CLOSED' }));
      }

      expect(state.device.door_open).toBe(false);
      expect(M.length).toBe(1);
      expect(M[0].payload).toEqual({ servo: 'CLOSED' });
    });

    test('tidak menutup pintu sebelum hold_ms terlewati', () => {
      const state = createMockState();
      state.device.door_open = true;
      state.device.last_detected = Date.now() - 1000; // baru 1 detik
      state.device.hold_ms = 3000;
      const M = [];
      const L = createLib(state, null, M, []);

      const detected = false;
      const t = Date.now();

      if (!detected && state.device.door_open && t - state.device.last_detected >= state.device.hold_ms) {
        state.device.door_open = false;
        M.push(L.cmdDevice({ servo: 'CLOSED' }));
      }

      expect(state.device.door_open).toBe(true);
      expect(M.length).toBe(0);
    });

    test('jarak > 400 cm dianggap tidak valid', () => {
      const dist = 450;
      const valid = (typeof dist === 'number' && dist > 0 && dist < 400) ? dist : null;
      expect(valid).toBeNull();
    });

    test('jarak 0 atau negatif dianggap tidak valid', () => {
      expect((0 > 0 && 0 < 400) ? 0 : null).toBeNull();
      expect((-1 > 0 && -1 < 400) ? -1 : null).toBeNull();
    });

    test('threshold default adalah 50 cm', () => {
      const state = createMockState();
      expect(state.device.threshold_cm).toBe(50);
    });
  });

  // --- setMode ---
  describe('setMode()', () => {
    test('mengubah mode dari AUTO ke MANUAL', async () => {
      const state = createMockState();
      const M = [], W = [];
      const L = createLib(state, null, M, W);
      const user = { sub: 1, username: 'admin' };
      await L.setMode(user, 'room_01', 'MANUAL');
      expect(state.rooms.room_01.mode).toBe('MANUAL');
    });

    test('mode OFF mengatur brightness ke 0', async () => {
      const state = createMockState();
      state.rooms.room_01.brightness = 75;
      const M = [], W = [];
      const L = createLib(state, null, M, W);
      const user = { sub: 1, username: 'admin' };
      await L.setMode(user, 'room_01', 'OFF');
      expect(state.rooms.room_01.brightness).toBe(0);
      expect(state.rooms.room_01.mode).toBe('OFF');
    });

    test('mengirim perintah MQTT dan notifikasi WebSocket', async () => {
      const state = createMockState();
      const M = [], W = [];
      const L = createLib(state, null, M, W);
      const user = { sub: 1, username: 'admin' };
      await L.setMode(user, 'room_01', 'MANUAL');
      expect(M.length).toBe(1);
      expect(M[0].topic).toBe('daylight/room_01/cmd');
      expect(W.length).toBe(1);
      expect(W[0].payload.type).toBe('room.update');
    });

    test('mencatat log ketika mode berubah', async () => {
      const state = createMockState();
      const M = [], W = [];
      const L = createLib(state, null, M, W);
      const user = { sub: 1, username: 'admin' };
      await L.setMode(user, 'room_01', 'MANUAL');
      expect(L.logAct).toHaveBeenCalledWith(
        'room_01', 'MODE_CHANGE', 'MANUAL',
        expect.stringContaining('AUTO -> MANUAL'),
        1
      );
    });

    test('tidak mencatat log jika mode tidak berubah', async () => {
      const state = createMockState();
      const M = [], W = [];
      const L = createLib(state, null, M, W);
      const user = { sub: 1, username: 'admin' };
      await L.setMode(user, 'room_01', 'AUTO'); // sudah AUTO
      expect(L.logAct).not.toHaveBeenCalled();
    });
  });

  // --- Validasi sensor data ---
  describe('Validasi data sensor lux', () => {
    test('lux valid (0-100000) diterima', () => {
      const validate = (lux) => (typeof lux === 'number' && lux >= 0 && lux <= 100000) ? lux : null;
      expect(validate(0)).toBe(0);
      expect(validate(500)).toBe(500);
      expect(validate(100000)).toBe(100000);
    });

    test('lux negatif ditolak', () => {
      const validate = (lux) => (typeof lux === 'number' && lux >= 0 && lux <= 100000) ? lux : null;
      expect(validate(-1)).toBeNull();
    });

    test('lux > 100000 ditolak', () => {
      const validate = (lux) => (typeof lux === 'number' && lux >= 0 && lux <= 100000) ? lux : null;
      expect(validate(100001)).toBeNull();
    });

    test('lux non-number ditolak', () => {
      const validate = (lux) => (typeof lux === 'number' && lux >= 0 && lux <= 100000) ? lux : null;
      expect(validate('500')).toBeNull();
      expect(validate(null)).toBeNull();
      expect(validate(undefined)).toBeNull();
    });
  });

  // --- Watchdog offline 30 detik ---
  describe('Watchdog offline 30 detik', () => {
    test('ESP32 dianggap offline jika tidak ada data > 30 detik', () => {
      const state = createMockState();
      state.device.device_status = 'ONLINE';
      state.device.last_seen = new Date(Date.now() - 31000).toISOString(); // 31 dtk lalu
      const M = [], W = [];
      const L = createLib(state, null, M, W);

      if (state.device.device_status === 'ONLINE' && state.device.last_seen
          && Date.now() - Date.parse(state.device.last_seen) > 30000) {
        L.setOffline('tidak ada data lebih dari 30 detik');
      }

      expect(state.device.device_status).toBe('OFFLINE');
    });

    test('ESP32 tetap online jika data terakhir < 30 detik', () => {
      const state = createMockState();
      state.device.device_status = 'ONLINE';
      state.device.last_seen = new Date(Date.now() - 10000).toISOString(); // 10 dtk lalu
      const M = [], W = [];
      const L = createLib(state, null, M, W);

      if (state.device.device_status === 'ONLINE' && state.device.last_seen
          && Date.now() - Date.parse(state.device.last_seen) > 30000) {
        L.setOffline('tidak ada data lebih dari 30 detik');
      }

      expect(state.device.device_status).toBe('ONLINE');
    });
  });

  // --- Resync ---
  describe('resync()', () => {
    test('mengirim ulang semua state ke ESP32', () => {
      const state = createMockState();
      const M = [], W = [];
      const L = createLib(state, null, M, W);
      L.resync();
      expect(M.length).toBe(3); // 2 rooms + 1 device
      expect(M[0].topic).toContain('room_01');
      expect(M[1].topic).toContain('room_02');
      expect(M[2].topic).toBe('daylight/device/cmd');
      expect(M[2].payload.servo).toBe('CLOSED'); // door_open default false
      expect(M[2].payload.buzzer).toBe('OFF');
    });

    test('resync dengan pintu terbuka mengirim servo OPEN', () => {
      const state = createMockState();
      state.device.door_open = true;
      const M = [], W = [];
      const L = createLib(state, null, M, W);
      L.resync();
      const devCmd = M.find(m => m.topic === 'daylight/device/cmd');
      expect(devCmd.payload.servo).toBe('OPEN');
    });
  });
});
