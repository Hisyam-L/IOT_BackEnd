/**
 * TEST 6: WebSocket Custom Node (daylight-ws.js)
 *
 * Menguji logika node kustom WebSocket yang menggunakan JWT
 * untuk autentikasi handshake dan mengelola broadcast/unicast pesan.
 */
const fs = require('fs');
const path = require('path');

const WS_PATH = path.join(__dirname, '..', 'nodered', 'node', 'daylight-ws.js');
const wsCode = fs.readFileSync(WS_PATH, 'utf-8');
const wsHtml = fs.readFileSync(path.join(__dirname, '..', 'nodered', 'node', 'daylight-ws.html'), 'utf-8');
const wsPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'nodered', 'node', 'package.json'), 'utf-8'));

describe('WebSocket Node (daylight-ws.js)', () => {

  // --- Package.json ---
  describe('Package.json', () => {
    test('nama paket adalah node-red-contrib-daylight-ws', () => {
      expect(wsPkg.name).toBe('node-red-contrib-daylight-ws');
    });

    test('memiliki dependensi ws', () => {
      expect(wsPkg.dependencies).toHaveProperty('ws');
    });

    test('mendaftarkan node daylight-ws', () => {
      expect(wsPkg['node-red'].nodes['daylight-ws']).toBe('daylight-ws.js');
    });
  });

  // --- Registrasi node ---
  describe('Registrasi Node-RED', () => {
    test('mendaftarkan type daylight-ws', () => {
      expect(wsCode).toMatch(/RED\.nodes\.registerType\('daylight-ws',\s*DaylightWs\)/);
    });

    test('export function menerima RED', () => {
      expect(wsCode).toMatch(/module\.exports\s*=\s*function\s*\(RED\)/);
    });
  });

  // --- JWT Authentication ---
  describe('Autentikasi JWT pada handshake', () => {
    test('mengambil auth dari global context', () => {
      expect(wsCode).toMatch(/node\.context\(\)\.global\.get\('auth'\)/);
    });

    test('verifikasi token dari query parameter ?token=', () => {
      expect(wsCode).toMatch(/url\.searchParams\.get\('token'\)/);
    });

    test('menolak koneksi dengan 401 jika token tidak valid', () => {
      expect(wsCode).toMatch(/HTTP\/1\.1 401 Unauthorized/);
      expect(wsCode).toMatch(/socket\.destroy\(\)/);
    });

    test('memeriksa pathname sebelum handle (hanya /ws)', () => {
      expect(wsCode).toMatch(/url\.pathname\s*!==\s*path/);
    });
  });

  // --- WebSocket Server ---
  describe('WebSocket Server', () => {
    test('menggunakan noServer mode (upgrade handling)', () => {
      expect(wsCode).toMatch(/new WebSocketServer\(\{\s*noServer:\s*true\s*\}\)/);
    });

    test('listen ke upgrade event dari RED.server', () => {
      expect(wsCode).toMatch(/RED\.server\.on\('upgrade'/);
    });

    test('client ID menggunakan counter berurutan (c1, c2, ...)', () => {
      expect(wsCode).toMatch(/'c'\s*\+\s*\(\+\+seq\)/);
    });
  });

  // --- Client Management ---
  describe('Manajemen klien', () => {
    test('klien disimpan dalam Map', () => {
      expect(wsCode).toMatch(/new Map\(\)/);
    });

    test('klien dihapus saat close', () => {
      expect(wsCode).toMatch(/ws\.on\('close',\s*function\s*\(\)\s*\{\s*clients\.delete\(id\)/);
    });

    test('status menampilkan jumlah klien', () => {
      expect(wsCode).toMatch(/clients\.size\s*\+\s*' klien'/);
    });
  });

  // --- Ping/Pong ---
  describe('Ping/Pong keepalive', () => {
    test('ping interval 25 detik', () => {
      expect(wsCode).toMatch(/setInterval\(function\s*\(\)\s*\{[\s\S]*?\},\s*25000\)/);
    });

    test('terminate koneksi yang tidak membalas pong', () => {
      expect(wsCode).toMatch(/if\s*\(!ws\.isAlive\)\s*\{\s*ws\.terminate\(\)/);
    });

    test('reset isAlive saat pong diterima', () => {
      expect(wsCode).toMatch(/ws\.on\('pong',\s*function\s*\(\)\s*\{\s*ws\.isAlive\s*=\s*true/);
    });
  });

  // --- Input/Output ---
  describe('Input/Output pesan', () => {
    test('input dengan _client mengirim ke satu klien (unicast)', () => {
      expect(wsCode).toMatch(/if\s*\(msg\._client\)/);
      expect(wsCode).toMatch(/clients\.get\(msg\._client\)/);
    });

    test('input tanpa _client mengirim ke semua klien (broadcast)', () => {
      expect(wsCode).toMatch(/clients\.forEach\(function\s*\(ws\)/);
    });

    test('hanya mengirim ke klien yang readyState === 1 (OPEN)', () => {
      expect(wsCode).toMatch(/ws\.readyState\s*===\s*1/);
    });

    test('JSON.stringify untuk payload non-string', () => {
      expect(wsCode).toMatch(/JSON\.stringify\(data\)/);
    });

    test('output mengirim event connect saat klien baru', () => {
      expect(wsCode).toMatch(/node\.send\(\{\s*topic:\s*'connect',\s*_client:\s*id/);
    });

    test('memanggil done() callback', () => {
      expect(wsCode).toMatch(/if\s*\(done\)\s*done\(\)/);
    });
  });

  // --- Cleanup ---
  describe('Cleanup saat close', () => {
    test('clearInterval ping timer', () => {
      expect(wsCode).toMatch(/clearInterval\(ping\)/);
    });

    test('removeListener upgrade event', () => {
      expect(wsCode).toMatch(/RED\.server\.removeListener\('upgrade'/);
    });

    test('terminate semua klien', () => {
      expect(wsCode).toMatch(/clients\.forEach\(function\s*\(ws\)\s*\{\s*try\s*\{\s*ws\.terminate\(\)/);
    });

    test('clear Map dan close WebSocketServer', () => {
      expect(wsCode).toMatch(/clients\.clear\(\)/);
      expect(wsCode).toMatch(/wss\.close\(\)/);
    });
  });

  // --- HTML UI ---
  describe('HTML UI Definition', () => {
    test('mendaftarkan node type daylight-ws di UI', () => {
      expect(wsHtml).toMatch(/RED\.nodes\.registerType\('daylight-ws'/);
    });

    test('memiliki 1 input dan 1 output', () => {
      expect(wsHtml).toMatch(/inputs:\s*1/);
      expect(wsHtml).toMatch(/outputs:\s*1/);
    });

    test('path default /ws', () => {
      expect(wsHtml).toMatch(/path:\s*\{\s*value:\s*'\/ws'/);
    });

    test('memiliki help text', () => {
      expect(wsHtml).toMatch(/data-help-name="daylight-ws"/);
    });
  });
});

describe('Node-RED Flows - Wiring Consistency', () => {
  const flows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'nodered', 'flows.json'), 'utf-8'));
  const nodeMap = {};
  flows.forEach(n => { if (n.id) nodeMap[n.id] = n; });

  test('semua node yang di-wire ada dalam flows', () => {
    const errors = [];
    flows.forEach(node => {
      if (node.wires && Array.isArray(node.wires)) {
        node.wires.forEach((output, idx) => {
          if (Array.isArray(output)) {
            output.forEach(targetId => {
              if (!nodeMap[targetId]) {
                errors.push(`Node "${node.id}" wire output[${idx}] -> "${targetId}" tidak ditemukan`);
              }
            });
          }
        });
      }
    });
    expect(errors).toEqual([]);
  });

  test('setiap http-in terhubung ke function node', () => {
    const httpIns = flows.filter(n => n.type === 'http in');
    httpIns.forEach(httpIn => {
      expect(httpIn.wires).toBeDefined();
      expect(httpIn.wires[0]).toBeDefined();
      expect(httpIn.wires[0].length).toBeGreaterThan(0);
      const targetId = httpIn.wires[0][0];
      const target = nodeMap[targetId];
      expect(target).toBeDefined();
      expect(target.type).toBe('function');
    });
  });

  test('setiap function API terhubung ke http_resp, mqtt_out, dan ws_out', () => {
    const apiFns = flows.filter(n => n.type === 'function' && n.name && n.name.match(/^(GET|POST)/));
    apiFns.forEach(fn => {
      expect(fn.outputs).toBe(3);
      expect(fn.wires).toHaveLength(3);
      expect(fn.wires[0]).toContain('http_resp');
      expect(fn.wires[1]).toContain('mqtt_out');
      expect(fn.wires[2]).toContain('ws_out');
    });
  });

  test('mqtt_tel -> sw_tel -> fn_door / fn_room', () => {
    const mqttTel = nodeMap['mqtt_tel'];
    expect(mqttTel.wires[0]).toContain('sw_tel');
    const swTel = nodeMap['sw_tel'];
    expect(swTel.wires[0]).toContain('fn_door');
    expect(swTel.wires[1]).toContain('fn_room');
  });

  test('fn_door output 3 (MQTT, WS, delay buzzer)', () => {
    const fnDoor = nodeMap['fn_door'];
    expect(fnDoor.outputs).toBe(3);
    expect(fnDoor.wires[0]).toContain('mqtt_out');
    expect(fnDoor.wires[1]).toContain('ws_out');
    expect(fnDoor.wires[2]).toContain('delay_buz');
  });

  test('delay_buz -> mqtt_out', () => {
    const delayBuz = nodeMap['delay_buz'];
    expect(delayBuz.wires[0]).toContain('mqtt_out');
  });

  test('ws_out (daylight-ws) -> fn_snap -> ws_out (loop back)', () => {
    const wsOut = nodeMap['ws_out'];
    expect(wsOut.wires[0]).toContain('fn_snap');
    const fnSnap = nodeMap['fn_snap'];
    expect(fnSnap.wires[0]).toContain('ws_out');
  });

  test('semua REST endpoints yang di-definisikan di API CONTRACT ada di flows', () => {
    const expectedUrls = [
      '/api/auth/login', '/api/health', '/api/state',
      '/api/rooms/:id/light', '/api/rooms/:id/mode',
      '/api/rooms/:id/brightness', '/api/rooms/:id/target',
      '/api/history/readings', '/api/history/activity'
    ];
    const httpIns = flows.filter(n => n.type === 'http in');
    const urls = httpIns.map(n => n.url);
    for (const expected of expectedUrls) {
      expect(urls).toContain(expected);
    }
  });

  test('MQTT broker node menggunakan port 1884 (internal)', () => {
    const broker = nodeMap['broker_mqtt'];
    expect(broker.port).toBe('1884');
    expect(broker.broker).toBe('mosquitto');
  });
});
