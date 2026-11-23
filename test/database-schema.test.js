/**
 * TEST 3: Database Schema Validation
 *
 * Menguji kebenaran schema SQL (init.sql) dengan mem-parse dan memvalidasi
 * definisi tabel, constraint, indeks, dan data awal.
 */
const fs = require('fs');
const path = require('path');

const SQL_PATH = path.join(__dirname, '..', 'db', 'init.sql');
const sql = fs.readFileSync(SQL_PATH, 'utf-8');

describe('Database Schema (init.sql)', () => {

  // --- Tabel users ---
  describe('Tabel users', () => {
    test('tabel users ada', () => {
      expect(sql).toMatch(/CREATE TABLE users/i);
    });

    test('memiliki kolom user_id sebagai PRIMARY KEY', () => {
      expect(sql).toMatch(/user_id\s+SERIAL\s+PRIMARY KEY/i);
    });

    test('memiliki kolom username UNIQUE', () => {
      expect(sql).toMatch(/username\s+VARCHAR\(50\)\s+NOT NULL\s+UNIQUE/i);
    });

    test('memiliki kolom password_hash NOT NULL', () => {
      expect(sql).toMatch(/password_hash\s+VARCHAR\(255\)\s+NOT NULL/i);
    });

    test('memiliki kolom role dengan default petugas', () => {
      expect(sql).toMatch(/role\s+VARCHAR\(20\)\s+NOT NULL\s+DEFAULT\s+'petugas'/i);
    });

    test('memiliki kolom is_active default TRUE', () => {
      expect(sql).toMatch(/is_active\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+TRUE/i);
    });

    test('memiliki kolom created_at dan last_login', () => {
      expect(sql).toMatch(/created_at\s+TIMESTAMPTZ/i);
      expect(sql).toMatch(/last_login\s+TIMESTAMPTZ/i);
    });
  });

  // --- Tabel rooms ---
  describe('Tabel rooms', () => {
    test('tabel rooms ada', () => {
      expect(sql).toMatch(/CREATE TABLE rooms/i);
    });

    test('room_id dibatasi hanya room_01 dan room_02', () => {
      expect(sql).toMatch(/CHECK\s*\(room_id\s+IN\s*\('room_01',\s*'room_02'\)\)/i);
    });

    test('mode dibatasi AUTO, MANUAL, OFF', () => {
      expect(sql).toMatch(/CHECK\s*\(mode\s+IN\s*\('AUTO',\s*'MANUAL',\s*'OFF'\)\)/i);
    });

    test('target_lux antara 0 dan 2000', () => {
      expect(sql).toMatch(/target_lux\s+INT\s+NOT NULL\s+DEFAULT\s+400\s+CHECK\s*\(target_lux\s+BETWEEN\s+0\s+AND\s+2000\)/i);
    });

    test('brightness antara 0 dan 100', () => {
      expect(sql).toMatch(/brightness\s+SMALLINT\s+NOT NULL\s+DEFAULT\s+0\s+CHECK\s*\(brightness\s+BETWEEN\s+0\s+AND\s+100\)/i);
    });

    test('step_pct antara 1 dan 100', () => {
      expect(sql).toMatch(/step_pct\s+SMALLINT\s+NOT NULL\s+DEFAULT\s+5\s+CHECK\s*\(step_pct\s+BETWEEN\s+1\s+AND\s+100\)/i);
    });

    test('tolerance_lux >= 0', () => {
      expect(sql).toMatch(/tolerance_lux\s+INT\s+NOT NULL\s+DEFAULT\s+30\s+CHECK\s*\(tolerance_lux\s*>=\s*0\)/i);
    });

    test('updated_by merupakan foreign key ke users', () => {
      expect(sql).toMatch(/updated_by\s+INT\s+REFERENCES\s+users\(user_id\)\s+ON DELETE SET NULL/i);
    });

    test('data awal room_01 dan room_02 di-insert', () => {
      expect(sql).toMatch(/INSERT INTO rooms.*room_01.*Ruangan 1/is);
      expect(sql).toMatch(/INSERT INTO rooms.*room_02.*Ruangan 2/is);
    });
  });

  // --- Tabel sensor_readings ---
  describe('Tabel sensor_readings', () => {
    test('tabel sensor_readings ada', () => {
      expect(sql).toMatch(/CREATE TABLE sensor_readings/i);
    });

    test('reading_id adalah BIGSERIAL PRIMARY KEY', () => {
      expect(sql).toMatch(/reading_id\s+BIGSERIAL\s+PRIMARY KEY/i);
    });

    test('room_id merupakan foreign key ke rooms', () => {
      expect(sql).toMatch(/room_id\s+VARCHAR\(10\)\s+NOT NULL\s+REFERENCES\s+rooms\(room_id\)/i);
    });

    test('lux >= 0', () => {
      expect(sql).toMatch(/lux\s+NUMERIC\(8,2\)\s+NOT NULL\s+CHECK\s*\(lux\s*>=\s*0\)/i);
    });

    test('brightness_pct antara 0 dan 100', () => {
      expect(sql).toMatch(/brightness_pct\s+SMALLINT\s+CHECK\s*\(brightness_pct\s+BETWEEN\s+0\s+AND\s+100\)/i);
    });

    test('recorded_at default now()', () => {
      expect(sql).toMatch(/recorded_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT\s+now\(\)/i);
    });
  });

  // --- Tabel activity_logs ---
  describe('Tabel activity_logs', () => {
    test('tabel activity_logs ada', () => {
      expect(sql).toMatch(/CREATE TABLE activity_logs/i);
    });

    test('type dibatasi MODE_CHANGE, COMMAND, ACCESS, DEVICE_STATUS', () => {
      expect(sql).toMatch(/CHECK\s*\(type\s+IN\s*\('MODE_CHANGE',\s*'COMMAND',\s*'ACCESS',\s*'DEVICE_STATUS'\)\)/i);
    });

    test('room_id boleh NULL (kejadian tingkat perangkat)', () => {
      // room_id tidak memiliki NOT NULL constraint di activity_logs
      const activityLogSection = sql.substring(
        sql.indexOf('CREATE TABLE activity_logs'),
        sql.indexOf(');', sql.indexOf('CREATE TABLE activity_logs')) + 2
      );
      // room_id referensi ke rooms tapi TIDAK memiliki NOT NULL
      expect(activityLogSection).toMatch(/room_id\s+VARCHAR\(10\)\s+REFERENCES/i);
      expect(activityLogSection).not.toMatch(/room_id\s+VARCHAR\(10\)\s+NOT NULL/i);
    });

    test('user_id foreign key ke users dengan ON DELETE SET NULL', () => {
      const activityLogSection = sql.substring(
        sql.indexOf('CREATE TABLE activity_logs'),
        sql.indexOf(');', sql.indexOf('CREATE TABLE activity_logs')) + 2
      );
      expect(activityLogSection).toMatch(/user_id\s+INT\s+REFERENCES\s+users\(user_id\)\s+ON DELETE SET NULL/i);
    });
  });

  // --- Indeks ---
  describe('Indeks', () => {
    test('indeks idx_readings_room_time ada', () => {
      expect(sql).toMatch(/CREATE INDEX idx_readings_room_time ON sensor_readings\s*\(room_id,\s*recorded_at\s+DESC\)/i);
    });

    test('indeks idx_readings_time ada', () => {
      expect(sql).toMatch(/CREATE INDEX idx_readings_time\s+ON sensor_readings\s*\(recorded_at\s+DESC\)/i);
    });

    test('indeks idx_activity_time ada', () => {
      expect(sql).toMatch(/CREATE INDEX idx_activity_time\s+ON activity_logs\s*\(created_at\s+DESC\)/i);
    });

    test('indeks idx_activity_room_time ada', () => {
      expect(sql).toMatch(/CREATE INDEX idx_activity_room_time ON activity_logs\s*\(room_id,\s*created_at\s+DESC\)/i);
    });
  });

  // --- Extension & data awal ---
  describe('Extension dan data awal', () => {
    test('pgcrypto extension diaktifkan', () => {
      expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS pgcrypto/i);
    });

    test('akun admin dibuat dengan bcrypt (crypt + gen_salt)', () => {
      expect(sql).toMatch(/INSERT INTO users.*crypt\('admin123',\s*gen_salt\('bf',\s*10\)\)/is);
    });

    test('akun admin memiliki role admin', () => {
      expect(sql).toMatch(/INSERT INTO users.*'admin'.*'admin'/is);
    });
  });

  // --- Konsistensi dengan API CONTRACT ---
  describe('Konsistensi dengan API CONTRACT', () => {
    const apiContract = fs.readFileSync(path.join(__dirname, '..', 'docs', 'API_CONTRACT.md'), 'utf-8');

    test('mode di DB (AUTO, MANUAL, OFF) cocok dengan API contract', () => {
      expect(apiContract).toMatch(/AUTO.*MANUAL.*OFF/);
      expect(sql).toMatch(/CHECK\s*\(mode\s+IN\s*\('AUTO',\s*'MANUAL',\s*'OFF'\)\)/i);
    });

    test('activity type di DB cocok dengan API contract', () => {
      expect(apiContract).toMatch(/MODE_CHANGE.*COMMAND.*ACCESS.*DEVICE_STATUS/);
    });

    test('target_lux range (0-2000) cocok antara DB dan API', () => {
      expect(apiContract).toMatch(/target_lux.*0-2000/);
      expect(sql).toMatch(/target_lux\s+BETWEEN\s+0\s+AND\s+2000/i);
    });

    test('brightness range (0-100) cocok antara DB dan API', () => {
      expect(apiContract).toMatch(/brightness.*0-100/);
      expect(sql).toMatch(/brightness\s+BETWEEN\s+0\s+AND\s+100/i);
    });
  });
});
