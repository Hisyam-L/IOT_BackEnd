/*
 * SMART DAYLIGHT BALANCING SYSTEM - FIRMWARE ESP32 (VERSI MQTT)
 *
 * ESP32 TIDAK punya logika keputusan. Semua keputusan (AUTO/MANUAL, buka pintu,
 * buzzer) dihitung di Node-RED. ESP32 hanya:
 *   1. membaca sensor (2x BH1750, 2x HC-SR04) lalu mengirim data lewat MQTT
 *   2. menjalankan perintah dari Node-RED (PWM LED, servo, buzzer)
 *
 * Library (Library Manager): PubSubClient (Nick O'Leary), ArduinoJson (v7),
 *                            BH1750 (Christopher Laws)
 * Board: ESP32 Dev Module (core 2.x maupun 3.x)
 *
 * Pin  : SDA=21 SCL=22 | LED1=25 LED2=26 | TRIG1=5 ECHO1=19 | TRIG2=16 ECHO2=17
 *        Servo=18 | Buzzer=23
 * BH1750 #1 = 0x23 (room_01), #2 = 0x5C (room_02)
 *
 * MQTT publish  : daylight/room_01/telemetry  {"lux":412.5,"sensor_ok":true}
 *                 daylight/room_02/telemetry
 *                 daylight/device/telemetry   {"distance_cm":3.2,"distance1_cm":3.2,
 *                                              "distance2_cm":null,"servo":"CLOSED","buzzer":"OFF"}
 *                 daylight/device/status      "online" | "offline" (retained, LWT)
 * MQTT subscribe: daylight/room_0X/cmd        {"mode":"AUTO","brightness":38}
 *                 daylight/device/cmd         {"servo":"OPEN|CLOSED","buzzer":"ON|OFF"}
 */

#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <BH1750.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ===================== KONFIGURASI (ISI INI) =====================
#define WIFI_SSID      "NAMA_WIFI"
#define WIFI_PASS      "PASSWORD_WIFI"
#define MQTT_HOST      "IP_ATAU_DOMAIN_VPS"
#define MQTT_PORT      1883
#define MQTT_USER      "esp32"
#define MQTT_PASS      "ISI_DARI_FILE_.env_(MQTT_PASSWORD)"
#define MQTT_CLIENT_ID "esp32-main"

// ===================== PIN =====================
#define PIN_SDA     21
#define PIN_SCL     22
#define PIN_TRIG1   5
#define PIN_ECHO1   19
#define PIN_TRIG2   16
#define PIN_ECHO2   17
#define PIN_SERVO   18
#define PIN_BUZZER  23

const uint8_t LED_PINS[2] = {25, 26};
const uint8_t BH_ADDR[2]  = {0x23, 0x5C};

// ===================== PARAMETER =====================
#define PWM_FREQ            5000
#define PWM_RES_BITS        8
#define SERVO_FREQ          50
#define SERVO_RES           14
#define SERVO_CLOSED_DEG    0
#define SERVO_OPEN_DEG      90
#define BUZZER_HZ           2000
#define ECHO_TIMEOUT_US     30000UL
#define ROOM_TELEMETRY_MS   1000
#define DEVICE_TELEMETRY_MS 250
#define SENSOR_RETRY_MS     5000
#define CH_SERVO            8    // channel LEDC core 2.x
#define CH_BUZZER           10   // LED memakai channel 14 dan 15

// ===================== TOPIK =====================
const char* T_ROOM_TEL[2] = {"daylight/room_01/telemetry", "daylight/room_02/telemetry"};
const char* T_ROOM_CMD[2] = {"daylight/room_01/cmd", "daylight/room_02/cmd"};
const char* T_DEV_TEL     = "daylight/device/telemetry";
const char* T_DEV_CMD     = "daylight/device/cmd";
const char* T_DEV_STATUS  = "daylight/device/status";

// ===================== STATE =====================
WiFiClient   net;
PubSubClient mqtt(net);

BH1750 bh[2];
bool   bhOk[2] = {false, false};
int    ledPwm[2] = {0, 0};
float  lastDist1 = -1, lastDist2 = -1;
bool   servoOpen = false;
bool   buzzerOn  = false;
uint8_t ledChannel[2];

// ===================== PWM LED =====================
void ledSetup(int i) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(LED_PINS[i], PWM_FREQ, PWM_RES_BITS);
#else
  ledChannel[i] = 14 + i;
  ledcSetup(ledChannel[i], PWM_FREQ, PWM_RES_BITS);
  ledcAttachPin(LED_PINS[i], ledChannel[i]);
#endif
}

void ledWritePct(int i, int pct) {
  pct = constrain(pct, 0, 100);
  ledPwm[i] = pct;
  uint32_t duty = (uint32_t)pct * ((1 << PWM_RES_BITS) - 1) / 100;
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(LED_PINS[i], duty);
#else
  ledcWrite(ledChannel[i], duty);
#endif
}

// ===================== SERVO (LEDC langsung) =====================
void servoSetup() {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(PIN_SERVO, SERVO_FREQ, SERVO_RES);
#else
  ledcSetup(CH_SERVO, SERVO_FREQ, SERVO_RES);
  ledcAttachPin(PIN_SERVO, CH_SERVO);
#endif
}

void servoWrite(int deg) {
  deg = constrain(deg, 0, 180);
  uint32_t us   = 500 + (uint32_t)deg * (2400 - 500) / 180;
  uint32_t duty = (uint32_t)((uint64_t)us * ((1UL << SERVO_RES) - 1) / 20000UL);
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(PIN_SERVO, duty);
#else
  ledcWrite(CH_SERVO, duty);
#endif
}

void setServo(bool open) {
  servoWrite(open ? SERVO_OPEN_DEG : SERVO_CLOSED_DEG);
  servoOpen = open;
}

// ===================== BUZZER =====================
void buzzerSetup() {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(PIN_BUZZER, BUZZER_HZ, 8);
  ledcWriteTone(PIN_BUZZER, 0);
#else
  ledcSetup(CH_BUZZER, BUZZER_HZ, 8);
  ledcAttachPin(PIN_BUZZER, CH_BUZZER);
  ledcWriteTone(CH_BUZZER, 0);
#endif
}

void setBuzzer(bool on) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWriteTone(PIN_BUZZER, on ? BUZZER_HZ : 0);
#else
  ledcWriteTone(CH_BUZZER, on ? BUZZER_HZ : 0);
#endif
  buzzerOn = on;
}

// ===================== HC-SR04 =====================
float readDistanceCm(uint8_t trigPin, uint8_t echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  unsigned long dur = pulseIn(echoPin, HIGH, ECHO_TIMEOUT_US);
  if (dur == 0) return -1;
  float cm = dur * 0.0343f / 2.0f;
  if (cm <= 0 || cm > 400) return -1;
  return cm;
}

// ===================== PUBLISH =====================
static void fmtNum(char* out, size_t n, float v) {
  if (v < 0) snprintf(out, n, "null");
  else       snprintf(out, n, "%.1f", v);
}

void publishRoom(int i, float lux) {
  char num[16], buf[64];
  fmtNum(num, sizeof(num), lux);
  snprintf(buf, sizeof(buf), "{\"lux\":%s,\"sensor_ok\":%s}", num, lux >= 0 ? "true" : "false");
  mqtt.publish(T_ROOM_TEL[i], buf);
}

void publishDevice() {
  float best = -1;
  if (lastDist1 > 0 && lastDist2 > 0) best = min(lastDist1, lastDist2);
  else if (lastDist1 > 0)             best = lastDist1;
  else if (lastDist2 > 0)             best = lastDist2;

  char d[16], d1[16], d2[16], buf[200];
  fmtNum(d,  sizeof(d),  best);
  fmtNum(d1, sizeof(d1), lastDist1);
  fmtNum(d2, sizeof(d2), lastDist2);
  snprintf(buf, sizeof(buf),
           "{\"distance_cm\":%s,\"distance1_cm\":%s,\"distance2_cm\":%s,\"servo\":\"%s\",\"buzzer\":\"%s\"}",
           d, d1, d2, servoOpen ? "OPEN" : "CLOSED", buzzerOn ? "ON" : "OFF");
  mqtt.publish(T_DEV_TEL, buf);
}

// ===================== PERINTAH DARI NODE-RED =====================
void onMessage(char* topic, byte* payload, unsigned int len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) return;

  if (strcmp(topic, T_DEV_CMD) == 0) {
    if (doc["servo"].is<const char*>()) {
      setServo(strcmp(doc["servo"], "OPEN") == 0);
    }
    if (doc["buzzer"].is<const char*>()) {
      setBuzzer(strcmp(doc["buzzer"], "ON") == 0);
    }
    publishDevice();
    return;
  }
  for (int i = 0; i < 2; i++) {
    if (strcmp(topic, T_ROOM_CMD[i]) == 0 && doc["brightness"].is<int>()) {
      ledWritePct(i, doc["brightness"].as<int>());
    }
  }
}

// ===================== KONEKSI =====================
void wifiLoop() {
  static unsigned long lastTry = 0;
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastTry < 10000 && lastTry != 0) return;
  lastTry = millis();
  Serial.println(F("WiFi: menyambung..."));
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

void mqttLoopConnect() {
  static unsigned long lastTry = 0;
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastTry < 5000 && lastTry != 0) return;
  lastTry = millis();
  Serial.println(F("MQTT: menyambung..."));
  // LWT: broker mengumumkan "offline" jika ESP32 putus
  if (mqtt.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS, T_DEV_STATUS, 1, true, "offline")) {
    mqtt.subscribe(T_ROOM_CMD[0], 1);
    mqtt.subscribe(T_ROOM_CMD[1], 1);
    mqtt.subscribe(T_DEV_CMD, 1);
    mqtt.publish(T_DEV_STATUS, "online", true);
    Serial.println(F("MQTT: tersambung"));
  } else {
    Serial.printf("MQTT: gagal rc=%d\n", mqtt.state());
  }
}

// ===================== SETUP & LOOP =====================
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println(F("\n=== Smart Daylight - ESP32 (MQTT) ==="));

  Wire.begin(PIN_SDA, PIN_SCL);
  for (int i = 0; i < 2; i++) {
    bhOk[i] = bh[i].begin(BH1750::CONTINUOUS_HIGH_RES_MODE, BH_ADDR[i], &Wire);
    ledSetup(i);
    ledWritePct(i, 0);
    Serial.printf("BH1750 #%d (0x%02X): %s\n", i + 1, BH_ADDR[i], bhOk[i] ? "OK" : "TIDAK TERDETEKSI");
  }

  pinMode(PIN_TRIG1, OUTPUT);
  pinMode(PIN_ECHO1, INPUT);
  pinMode(PIN_TRIG2, OUTPUT);
  pinMode(PIN_ECHO2, INPUT);

  servoSetup();
  setServo(false);
  buzzerSetup();

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);
  mqtt.setSocketTimeout(3);
  mqtt.setKeepAlive(15);
}

void loop() {
  static unsigned long tRoom = 0, tDev = 0, tRetry = 0;
  unsigned long now = millis();

  wifiLoop();
  mqttLoopConnect();
  mqtt.loop();

  // --- lux per ruangan ---
  if (now - tRoom >= ROOM_TELEMETRY_MS) {
    tRoom = now;
    for (int i = 0; i < 2; i++) {
      if (!bhOk[i] && now - tRetry >= SENSOR_RETRY_MS) {
        bhOk[i] = bh[i].begin(BH1750::CONTINUOUS_HIGH_RES_MODE, BH_ADDR[i], &Wire);
      }
      float lux = -1;
      if (bhOk[i]) {
        lux = bh[i].readLightLevel();
        if (lux < 0) { bhOk[i] = false; lux = -1; }
      }
      if (mqtt.connected()) publishRoom(i, lux);
    }
    if (now - tRetry >= SENSOR_RETRY_MS) tRetry = now;
  }

  // --- jarak + status servo/buzzer ---
  if (now - tDev >= DEVICE_TELEMETRY_MS) {
    tDev = now;
    lastDist1 = readDistanceCm(PIN_TRIG1, PIN_ECHO1);
    delay(10);
    lastDist2 = readDistanceCm(PIN_TRIG2, PIN_ECHO2);
    if (mqtt.connected()) publishDevice();
  }
}
