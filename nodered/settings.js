// Pengaturan Node-RED untuk Smart Daylight Balancing System.
// Menyediakan koneksi PostgreSQL dan JWT ke function node lewat global context
// (global.get('pool'), global.get('auth')). Semua LOGIKA sistem ada di flows.json.
const crypto = require('crypto');
const { Pool } = require('pg');

const SECRET = process.env.JWT_SECRET || '';
if (SECRET.length < 16) throw new Error('JWT_SECRET wajib diisi (minimal 16 karakter)');
const TTL_S = (Number(process.env.JWT_TTL_HOURS) || 12) * 3600;

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

const pool = new Pool({
  host: process.env.PGHOST || 'localhost', // <-- ubah 'postgres' menjadi 'localhost'
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  max: 5,
});

pool.on('error', (e) => console.error('[pg] pool error:', e.message));

module.exports = {
  flowFile: 'flows.json',
  flowFilePretty: true,
  credentialSecret: process.env.NODE_RED_CREDENTIAL_SECRET || 'daylight-no-credentials',
  uiPort: Number(process.env.PORT) || 1880,
  httpAdminRoot: '/admin', // editor: http://localhost:1880/admin (lewat SSH tunnel)
  httpNodeRoot: '/',       // endpoint REST: /api/...
  mqttReconnectTime: 5000,
  functionTimeout: 0,
  functionExternalModules: false,
  functionGlobalContext: { pool: pool, auth: auth },
  exportGlobalContextKeys: false,
  editorTheme: { projects: { enabled: false } },
  logging: { console: { level: 'info', metrics: false, audit: false } },
}
