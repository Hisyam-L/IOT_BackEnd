/**
 * TEST 5: ESP32 Firmware Static Analysis
 *
 * Analisis statis firmware ESP32 (esp32_daylight.ino) untuk memverifikasi
 * kebenaran konfigurasi pin, topik MQTT, format telemetri, dan logika.
 */
const fs = require('fs');
const path = require('path');

const FW_PATH = path.join(__dirname, '..', 'firmware', 'esp32_daylight', 'esp32_daylight.ino');
const firmware = fs.readFileSync(FW_PATH, 'utf-8');
const apiContract = fs.readFileSync(path.join(__dirname, '..', 'docs', 'API_CONTRACT.md'), 'utf-8');
const flowsJson = fs.readFileSync(path.join(__dirname, '..', 'nodered', 'flows.json'), 'utf-8');

describe('ESP32 Firmware Analysis', () => {

  // --- Pin Configuration ---
  describe('Konfigurasi Pin', () => {
    test('I2C: SDA=21, SCL=22', () => {
      expect(firmware).toMatch(/#define\s+PIN_SDA\s+21/);
      expect(firmware).toMatch(/#define\s+PIN_SCL\s+22/);
    });

    test('LED pins: 25 dan 26', () => {
      expect(firmware).toMatch(/LED_PINS\[2\]\s*=\s*\{25,\s*26\}/);
    });

    test('HC-SR04 #1: TRIG=5, ECHO=19', () => {
      expect(firmware).toMatch(/#define\s+PIN_TRIG1\s+5/);
      expect(firmware).toMatch(/#define\s+PIN_ECHO1\s+19/);
    });

    test('HC-SR04 #2: TRIG=16, ECHO=17', () => {
      expect(firmware).toMatch(/#define\s+PIN_TRIG2\s+16/);
      expect(firmware).toMatch(/#define\s+PIN_ECHO2\s+17/);
    });

    test('Servo: pin 18', () => {
      expect(firmware).toMatch(/#define\s+PIN_SERVO\s+18/);
    });

    test('Buzzer: pin 23', () => {
      expect(firmware).toMatch(/#define\s+PIN_BUZZER\s+23/);
    });

    test('tidak ada pin yang duplikat', () => {
      const pinDefs = firmware.match(/#define\s+PIN_\w+\s+(\d+)/g) || [];
      const ledMatch = firmware.match(/LED_PINS\[2\]\s*=\s*\{(\d+),\s*(\d+)\}/);
      const pins = pinDefs.map(d => parseInt(d.match(/\d+$/)[0]));
      if (ledMatch) {
        pins.push(parseInt(ledMatch[1]), parseInt(ledMatch[2]));
      }
      const uniquePins = new Set(pins);
      expect(uniquePins.size).toBe(pins.length);
    });
  });

  // --- BH1750 Addresses ---
  describe('BH1750 Sensor', () => {
    test('alamat I2C: 0x23 (room_01) dan 0x5C (room_02)', () => {
      expect(firmware).toMatch(/BH_ADDR\[2\]\s*=\s*\{0x23,\s*0x5C\}/);
    });

    test('menggunakan mode CONTINUOUS_HIGH_RES', () => {
      expect(firmware).toMatch(/BH1750::CONTINUOUS_HIGH_RES_MODE/);
    });
  });

  // --- MQTT Topics ---
  describe('Topik MQTT', () => {
    test('room telemetry topics cocok dengan API contract', () => {
      expect(firmware).toContain('daylight/room_01/telemetry');
      expect(firmware).toContain('daylight/room_02/telemetry');
      expect(apiContract).toContain('daylight/room_01/telemetry');
      expect(apiContract).toContain('daylight/room_02/telemetry');
    });

    test('device telemetry topic cocok', () => {
      expect(firmware).toContain('daylight/device/telemetry');
      expect(apiContract).toContain('daylight/device/telemetry');
    });

    test('device status topic cocok (LWT)', () => {
      expect(firmware).toContain('daylight/device/status');
      expect(apiContract).toContain('daylight/device/status');
    });

    test('room command topics cocok', () => {
      expect(firmware).toContain('daylight/room_01/cmd');
      expect(firmware).toContain('daylight/room_02/cmd');
    });

    test('device command topic cocok', () => {
      expect(firmware).toContain('daylight/device/cmd');
    });

    test('subscribe ke 3 topic (room_01/cmd, room_02/cmd, device/cmd)', () => {
      expect(firmware).toMatch(/mqtt\.subscribe\(T_ROOM_CMD\[0\]/);
      expect(firmware).toMatch(/mqtt\.subscribe\(T_ROOM_CMD\[1\]/);
      expect(firmware).toMatch(/mqtt\.subscribe\(T_DEV_CMD/);
    });
  });

  // --- MQTT Configuration ---
  describe('Konfigurasi MQTT', () => {
    test('menggunakan port 1883', () => {
      expect(firmware).toMatch(/#define\s+MQTT_PORT\s+1883/);
    });

    test('menggunakan autentikasi (username/password)', () => {
      expect(firmware).toMatch(/#define\s+MQTT_USER\s+"esp32"/);
      expect(firmware).toMatch(/#define\s+MQTT_PASS/);
    });

    test('memiliki client ID yang unik', () => {
      expect(firmware).toMatch(/#define\s+MQTT_CLIENT_ID\s+"esp32-main"/);
    });

    test('LWT (Last Will) dikonfigurasi untuk status offline', () => {
      // mqtt.connect dengan LWT parameter
      expect(firmware).toMatch(/mqtt\.connect\(MQTT_CLIENT_ID,\s*MQTT_USER,\s*MQTT_PASS,\s*T_DEV_STATUS,\s*1,\s*true,\s*"offline"\)/);
    });

    test('publish "online" retained saat tersambung', () => {
      expect(firmware).toMatch(/mqtt\.publish\(T_DEV_STATUS,\s*"online",\s*true\)/);
    });

    test('buffer size 512 bytes (cukup untuk JSON payload)', () => {
      expect(firmware).toMatch(/mqtt\.setBufferSize\(512\)/);
    });
  });

  // --- Telemetry Intervals ---
  describe('Interval Telemetri', () => {
    test('room telemetry setiap 1000ms (1 detik)', () => {
      expect(firmware).toMatch(/#define\s+ROOM_TELEMETRY_MS\s+1000/);
    });

    test('device telemetry setiap 250ms', () => {
      expect(firmware).toMatch(/#define\s+DEVICE_TELEMETRY_MS\s+250/);
    });

    test('sensor retry setiap 5000ms (5 detik)', () => {
      expect(firmware).toMatch(/#define\s+SENSOR_RETRY_MS\s+5000/);
    });
  });

  // --- PWM & Servo ---
  describe('PWM dan Servo', () => {
    test('PWM LED: 5000 Hz, 8-bit resolusi', () => {
      expect(firmware).toMatch(/#define\s+PWM_FREQ\s+5000/);
      expect(firmware).toMatch(/#define\s+PWM_RES_BITS\s+8/);
    });

    test('Servo: 50 Hz, 14-bit resolusi', () => {
      expect(firmware).toMatch(/#define\s+SERVO_FREQ\s+50/);
      expect(firmware).toMatch(/#define\s+SERVO_RES\s+14/);
    });

    test('Servo closed=0°, open=90°', () => {
      expect(firmware).toMatch(/#define\s+SERVO_CLOSED_DEG\s+0/);
      expect(firmware).toMatch(/#define\s+SERVO_OPEN_DEG\s+90/);
    });

    test('Buzzer: 2000 Hz', () => {
      expect(firmware).toMatch(/#define\s+BUZZER_HZ\s+2000/);
    });
  });

  // --- LED Brightness Calculation ---
  describe('Kalkulasi brightness LED', () => {
    test('ledWritePct membatasi 0-100%', () => {
      expect(firmware).toMatch(/constrain\(pct,\s*0,\s*100\)/);
    });

    test('duty cycle dihitung dengan benar untuk 8-bit (max 255)', () => {
      // Formula: (pct * ((1 << 8) - 1)) / 100 = pct * 255 / 100
      expect(firmware).toMatch(/\(uint32_t\)pct\s*\*\s*\(\(1\s*<<\s*PWM_RES_BITS\)\s*-\s*1\)\s*\/\s*100/);
    });

    // Test duty calculation manually
    test('0% = duty 0, 100% = duty 255, 50% = duty ~127', () => {
      const calc = (pct) => Math.floor(pct * 255 / 100);
      expect(calc(0)).toBe(0);
      expect(calc(100)).toBe(255);
      expect(calc(50)).toBe(127);
    });
  });

  // --- HC-SR04 Distance ---
  describe('Kalkulasi jarak HC-SR04', () => {
    test('formula jarak: dur * 0.0343 / 2', () => {
      expect(firmware).toMatch(/dur\s*\*\s*0\.0343f\s*\/\s*2\.0f/);
    });

    test('timeout 30000us (max ~5m range)', () => {
      expect(firmware).toMatch(/#define\s+ECHO_TIMEOUT_US\s+30000UL/);
    });

    test('jarak > 400cm dianggap invalid', () => {
      expect(firmware).toMatch(/cm\s*>\s*400/);
    });

    test('timeout (dur==0) mengembalikan -1', () => {
      expect(firmware).toMatch(/if\s*\(dur\s*==\s*0\)\s*return\s*-1/);
    });
  });

  // --- Servo Microsecond Calculation ---
  describe('Kalkulasi servo microsecond', () => {
    test('range pulse: 500-2400 us', () => {
      expect(firmware).toMatch(/500\s*\+\s*\(uint32_t\)deg\s*\*\s*\(2400\s*-\s*500\)\s*\/\s*180/);
    });

    test('0° = 500us, 90° = ~1450us, 180° = 2400us', () => {
      const usCalc = (deg) => 500 + Math.floor(deg * (2400 - 500) / 180);
      expect(usCalc(0)).toBe(500);
      expect(usCalc(180)).toBe(2400);
      // 90° ≈ 1450us
      expect(usCalc(90)).toBeGreaterThan(1400);
      expect(usCalc(90)).toBeLessThan(1500);
    });
  });

  // --- publishDevice best distance logic ---
  describe('publishDevice: logika jarak terbaik', () => {
    test('mengambil jarak terdekat dari kedua sensor', () => {
      // Logika: min(dist1, dist2) jika keduanya valid
      expect(firmware).toMatch(/min\(lastDist1,\s*lastDist2\)/);
    });

    test('menggunakan dist1 jika hanya dist1 valid', () => {
      expect(firmware).toMatch(/else if\s*\(lastDist1\s*>\s*0\)\s*best\s*=\s*lastDist1/);
    });

    test('menggunakan dist2 jika hanya dist2 valid', () => {
      expect(firmware).toMatch(/else if\s*\(lastDist2\s*>\s*0\)\s*best\s*=\s*lastDist2/);
    });
  });

  // --- onMessage (commands from Node-RED) ---
  describe('onMessage: perintah dari Node-RED', () => {
    test('menerima perintah servo OPEN/CLOSED', () => {
      expect(firmware).toMatch(/strcmp\(doc\["servo"\],\s*"OPEN"\)\s*==\s*0/);
    });

    test('menerima perintah buzzer ON/OFF', () => {
      expect(firmware).toMatch(/strcmp\(doc\["buzzer"\],\s*"ON"\)\s*==\s*0/);
    });

    test('menerima brightness dari room command', () => {
      expect(firmware).toMatch(/doc\["brightness"\]/);
      expect(firmware).toMatch(/ledWritePct\(i,\s*doc\["brightness"\]\.as<int>\(\)\)/);
    });

    test('publishDevice() dipanggil setelah device command', () => {
      // Setelah handle servo/buzzer, publishDevice dipanggil
      const onMsgSection = firmware.substring(firmware.indexOf('void onMessage'));
      expect(onMsgSection).toMatch(/publishDevice\(\);[\s]*return;/);
    });
  });

  // --- WiFi & Reconnection ---
  describe('WiFi dan reconnection', () => {
    test('WiFi mode STA (station)', () => {
      expect(firmware).toMatch(/WiFi\.mode\(WIFI_STA\)/);
    });

    test('auto reconnect diaktifkan', () => {
      expect(firmware).toMatch(/WiFi\.setAutoReconnect\(true\)/);
    });

    test('WiFi reconnection setiap 10 detik', () => {
      expect(firmware).toMatch(/millis\(\)\s*-\s*lastTry\s*<\s*10000/);
    });

    test('MQTT reconnection setiap 5 detik', () => {
      // Di mqttLoopConnect
      const mqttSection = firmware.substring(firmware.indexOf('void mqttLoopConnect'));
      expect(mqttSection).toMatch(/millis\(\)\s*-\s*lastTry\s*<\s*5000/);
    });
  });

  // --- ESP32 Core Compatibility ---
  describe('Kompatibilitas ESP32 Core', () => {
    test('mendukung ESP32 core 2.x dan 3.x (conditional compilation)', () => {
      const coreChecks = firmware.match(/ESP_ARDUINO_VERSION_MAJOR/g);
      expect(coreChecks).not.toBeNull();
      expect(coreChecks.length).toBeGreaterThan(0);
    });

    test('menggunakan ledcAttach untuk core 3.x dan ledcSetup+ledcAttachPin untuk 2.x', () => {
      expect(firmware).toMatch(/ledcAttach\(LED_PINS\[i\]/);
      expect(firmware).toMatch(/ledcSetup\(ledChannel\[i\]/);
      expect(firmware).toMatch(/ledcAttachPin\(LED_PINS\[i\]/);
    });
  });

  // --- MQTT Topic Consistency with Node-RED ---
  describe('Konsistensi topik MQTT dengan Node-RED flows', () => {
    test('Node-RED subscribe ke topik yang sama dengan ESP32 publish', () => {
      // Node-RED subscribes to daylight/+/telemetry dan daylight/device/status
      expect(flowsJson).toContain('daylight/+/telemetry');
      expect(flowsJson).toContain('daylight/device/status');
    });

    test('Node-RED broker menggunakan port 1884 (internal)', () => {
      expect(flowsJson).toMatch(/"port":\s*"1884"/);
    });

    test('ESP32 menggunakan port 1883 (external dengan auth)', () => {
      expect(firmware).toMatch(/#define\s+MQTT_PORT\s+1883/);
    });
  });

  // --- Delay between dual sensors ---
  describe('Delay antar sensor ultrasonik', () => {
    test('ada delay 10ms antara pembacaan sensor 1 dan sensor 2', () => {
      // Ini penting untuk mencegah crosstalk antara kedua HC-SR04
      expect(firmware).toMatch(/readDistanceCm\(PIN_TRIG1.*\);[\s]*delay\(10\);[\s]*.*readDistanceCm\(PIN_TRIG2/);
    });
  });
});
