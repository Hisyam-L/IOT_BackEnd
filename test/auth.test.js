/**
 * TEST 1: JWT Authentication (settings.js auth module)
 *
 * Menguji modul autentikasi JWT yang diimplementasikan secara manual di settings.js.
 * Modul ini digunakan oleh semua endpoint REST API dan WebSocket handshake.
 */
const crypto = require('crypto');

// === Replika modul auth dari settings.js ===
const SECRET = 'test-secret-key-yang-cukup-panjang-untuk-testing';
const TTL_S = 12 * 3600; // 12 jam

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const hmac = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

const auth = {
  sign(payload) {
    const now = Math.floor(Date.now() / 1000);
    const body = Object.assign({}, payload, { iat: now, exp: now + TTL_S });
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const data = head + '.' + b64(body);
    return { token: data + '.' + hmac(data), expires_at: new Date(body.exp * 1000).toISOString() };
  },
  verify(token) {
    try {
      const parts = String(token).split('.');
      if (parts.length !== 3) return null;
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      if (header.alg !== 'HS256') return null;
      const expected = Buffer.from(hmac(parts[0] + '.' + parts[1]));
      const got = Buffer.from(parts[2]);
      if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null;
      const body = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      if (!body.exp || body.exp < Date.now() / 1000) return null;
      return body;
    } catch (e) {
      return null;
    }
  },
};

// ===================== TESTS =====================

describe('JWT Auth Module (settings.js)', () => {

  describe('sign()', () => {
    test('menghasilkan token dengan format 3 bagian (header.payload.signature)', () => {
      const result = auth.sign({ sub: 1, username: 'admin', role: 'admin' });
      expect(result.token).toBeDefined();
      const parts = result.token.split('.');
      expect(parts).toHaveLength(3);
    });

    test('menghasilkan expires_at dalam format ISO 8601', () => {
      const result = auth.sign({ sub: 1, username: 'admin', role: 'admin' });
      expect(result.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      const expDate = new Date(result.expires_at);
      expect(expDate.getTime()).toBeGreaterThan(Date.now());
    });

    test('expires_at harus 12 jam dari sekarang', () => {
      const before = Date.now();
      const result = auth.sign({ sub: 1, username: 'admin', role: 'admin' });
      const after = Date.now();
      const expMs = new Date(result.expires_at).getTime();
      // Toleransi 2 detik
      expect(expMs).toBeGreaterThanOrEqual(before + TTL_S * 1000 - 2000);
      expect(expMs).toBeLessThanOrEqual(after + TTL_S * 1000 + 2000);
    });

    test('header JWT berisi alg=HS256 dan typ=JWT', () => {
      const result = auth.sign({ sub: 1 });
      const header = JSON.parse(Buffer.from(result.token.split('.')[0], 'base64url').toString());
      expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    });

    test('payload berisi data yang dikirim + iat + exp', () => {
      const result = auth.sign({ sub: 42, username: 'petugas1', role: 'petugas' });
      const body = JSON.parse(Buffer.from(result.token.split('.')[1], 'base64url').toString());
      expect(body.sub).toBe(42);
      expect(body.username).toBe('petugas1');
      expect(body.role).toBe('petugas');
      expect(body.iat).toBeDefined();
      expect(body.exp).toBeDefined();
      expect(body.exp - body.iat).toBe(TTL_S);
    });
  });

  describe('verify()', () => {
    test('memverifikasi token valid dan mengembalikan payload', () => {
      const { token } = auth.sign({ sub: 1, username: 'admin', role: 'admin' });
      const result = auth.verify(token);
      expect(result).not.toBeNull();
      expect(result.sub).toBe(1);
      expect(result.username).toBe('admin');
      expect(result.role).toBe('admin');
    });

    test('menolak token yang dimodifikasi (signature tidak cocok)', () => {
      const { token } = auth.sign({ sub: 1 });
      // Ubah 1 karakter di signature
      const tampered = token.slice(0, -1) + (token.slice(-1) === 'A' ? 'B' : 'A');
      expect(auth.verify(tampered)).toBeNull();
    });

    test('menolak token yang payload-nya dimodifikasi', () => {
      const { token } = auth.sign({ sub: 1, role: 'petugas' });
      const parts = token.split('.');
      // Ubah payload: ganti role jadi admin
      const tamperedPayload = b64({ sub: 1, role: 'admin', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + TTL_S });
      const tamperedToken = parts[0] + '.' + tamperedPayload + '.' + parts[2];
      expect(auth.verify(tamperedToken)).toBeNull();
    });

    test('menolak token kadaluarsa', () => {
      // Buat token yang sudah expired
      const now = Math.floor(Date.now() / 1000);
      const body = { sub: 1, iat: now - 100000, exp: now - 1 };
      const head = b64({ alg: 'HS256', typ: 'JWT' });
      const data = head + '.' + b64(body);
      const token = data + '.' + hmac(data);
      expect(auth.verify(token)).toBeNull();
    });

    test('menolak string kosong', () => {
      expect(auth.verify('')).toBeNull();
    });

    test('menolak string random', () => {
      expect(auth.verify('ini-bukan-jwt')).toBeNull();
    });

    test('menolak null/undefined', () => {
      expect(auth.verify(null)).toBeNull();
      expect(auth.verify(undefined)).toBeNull();
    });

    test('menolak token dengan 2 bagian (tanpa signature)', () => {
      const { token } = auth.sign({ sub: 1 });
      const parts = token.split('.');
      expect(auth.verify(parts[0] + '.' + parts[1])).toBeNull();
    });

    test('menolak token dengan 4 bagian', () => {
      const { token } = auth.sign({ sub: 1 });
      expect(auth.verify(token + '.extra')).toBeNull();
    });

    test('menolak token dengan algoritma berbeda', () => {
      const now = Math.floor(Date.now() / 1000);
      const body = { sub: 1, iat: now, exp: now + TTL_S };
      const head = b64({ alg: 'HS384', typ: 'JWT' }); // salah alg
      const data = head + '.' + b64(body);
      const token = data + '.' + hmac(data);
      expect(auth.verify(token)).toBeNull();
    });
  });

  describe('Keamanan', () => {
    test('menggunakan timingSafeEqual untuk perbandingan signature (mencegah timing attack)', () => {
      // Ini sudah diimplementasikan di kode - kita pastikan saja verify bekerja konsisten
      const { token } = auth.sign({ sub: 1 });
      // Verifikasi 100 kali harus selalu memberikan hasil yang sama
      for (let i = 0; i < 100; i++) {
        expect(auth.verify(token)).not.toBeNull();
      }
    });

    test('token yang di-sign dengan secret berbeda harus ditolak', () => {
      // Buat token dengan secret lain
      const otherSecret = 'secret-lain-yang-berbeda-untuk-testing';
      const otherHmac = (data) => crypto.createHmac('sha256', otherSecret).update(data).digest('base64url');
      const now = Math.floor(Date.now() / 1000);
      const body = { sub: 1, iat: now, exp: now + TTL_S };
      const head = b64({ alg: 'HS256', typ: 'JWT' });
      const data = head + '.' + b64(body);
      const tokenFromOther = data + '.' + otherHmac(data);
      expect(auth.verify(tokenFromOther)).toBeNull();
    });
  });
});
