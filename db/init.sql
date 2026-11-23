-- ============================================================
-- Smart Daylight Balancing System - PostgreSQL 14+
-- Dijalankan otomatis oleh container postgres saat volume masih kosong.
-- Mode/tipe disesuaikan dengan docs/API_CONTRACT.md (AUTO | MANUAL | OFF).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    user_id        SERIAL PRIMARY KEY,
    username       VARCHAR(50)  NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,
    full_name      VARCHAR(100),
    role           VARCHAR(20)  NOT NULL DEFAULT 'petugas',
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_login     TIMESTAMPTZ
);

CREATE TABLE rooms (
    room_id       VARCHAR(10) PRIMARY KEY CHECK (room_id IN ('room_01', 'room_02')),
    room_name     VARCHAR(50) NOT NULL,
    mode          VARCHAR(10) NOT NULL DEFAULT 'AUTO' CHECK (mode IN ('AUTO', 'MANUAL', 'OFF')),
    target_lux    INT         NOT NULL DEFAULT 400 CHECK (target_lux BETWEEN 0 AND 2000),
    tolerance_lux INT         NOT NULL DEFAULT 30  CHECK (tolerance_lux >= 0),
    step_pct      SMALLINT    NOT NULL DEFAULT 5   CHECK (step_pct BETWEEN 1 AND 100),
    brightness    SMALLINT    NOT NULL DEFAULT 0   CHECK (brightness BETWEEN 0 AND 100),
    latest_lux    NUMERIC(8,2),
    updated_by    INT REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sensor_readings (
    reading_id     BIGSERIAL PRIMARY KEY,
    room_id        VARCHAR(10)  NOT NULL REFERENCES rooms(room_id),
    lux            NUMERIC(8,2) NOT NULL CHECK (lux >= 0),
    brightness_pct SMALLINT CHECK (brightness_pct BETWEEN 0 AND 100),
    mode           VARCHAR(10),
    recorded_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- room_id NULL = kejadian tingkat perangkat (pintu, ESP32 online/offline)
CREATE TABLE activity_logs (
    log_id     BIGSERIAL PRIMARY KEY,
    room_id    VARCHAR(10) REFERENCES rooms(room_id),
    type       VARCHAR(20) NOT NULL CHECK (type IN ('MODE_CHANGE', 'COMMAND', 'ACCESS', 'DEVICE_STATUS')),
    value      VARCHAR(100),
    note       TEXT,
    user_id    INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_readings_room_time ON sensor_readings (room_id, recorded_at DESC);
CREATE INDEX idx_readings_time      ON sensor_readings (recorded_at DESC);
CREATE INDEX idx_activity_time      ON activity_logs (created_at DESC);
CREATE INDEX idx_activity_room_time ON activity_logs (room_id, created_at DESC);

INSERT INTO rooms (room_id, room_name) VALUES
    ('room_01', 'Ruangan 1'),
    ('room_02', 'Ruangan 2');

-- Akun awal. WAJIB ganti password setelah login pertama (lihat docs/DEPLOY.md).
INSERT INTO users (username, password_hash, full_name, role) VALUES
    ('admin', crypt('admin123', gen_salt('bf', 10)), 'Administrator', 'admin');
