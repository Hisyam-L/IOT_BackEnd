/**
 * TEST 4: Infrastructure & Configuration Validation
 *
 * Menguji konfigurasi Docker Compose, Nginx, Mosquitto, Dockerfile,
 * .env, dan setup.sh untuk memastikan konsistensi dan kebenaran.
 */
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(BASE, f), 'utf-8');

const dockerCompose = read('docker-compose.yml');
const nginxConf = read('nginx/default.conf');
const mosquittoConf = read('mosquitto/mosquitto.conf');
const dockerfile = read('nodered/Dockerfile');
const envExample = read('.env.example');
const envFile = read('.env');
const setupSh = read('setup.sh');

describe('Docker Compose', () => {

  describe('Service definitions', () => {
    test('mendefinisikan 4 service: postgres, mosquitto, nodered, nginx', () => {
      expect(dockerCompose).toMatch(/postgres:/);
      expect(dockerCompose).toMatch(/mosquitto:/);
      expect(dockerCompose).toMatch(/nodered:/);
      expect(dockerCompose).toMatch(/nginx:/);
    });

    test('postgres menggunakan image postgres:16-alpine', () => {
      expect(dockerCompose).toMatch(/image:\s*postgres:16-alpine/);
    });

    test('mosquitto menggunakan image eclipse-mosquitto:2.0', () => {
      expect(dockerCompose).toMatch(/image:\s*eclipse-mosquitto:2\.0/);
    });

    test('nginx menggunakan image nginx:1.27-alpine', () => {
      expect(dockerCompose).toMatch(/image:\s*nginx:1\.27-alpine/);
    });

    test('semua service menggunakan restart: unless-stopped', () => {
      const matches = dockerCompose.match(/restart:\s*unless-stopped/g);
      expect(matches).not.toBeNull();
      expect(matches.length).toBe(4);
    });
  });

  describe('Dependencies', () => {
    test('nodered depends on postgres (healthy) dan mosquitto', () => {
      expect(dockerCompose).toMatch(/depends_on:[\s\S]*?postgres:[\s\S]*?condition:\s*service_healthy/);
      expect(dockerCompose).toMatch(/depends_on:[\s\S]*?mosquitto:[\s\S]*?condition:\s*service_started/);
    });

    test('nginx depends on nodered', () => {
      // Cek bagian nginx
      const nginxSection = dockerCompose.substring(dockerCompose.indexOf('nginx:'));
      expect(nginxSection).toMatch(/depends_on:[\s\S]*?nodered/);
    });
  });

  describe('Ports', () => {
    test('mosquitto expose port 1883 (untuk ESP32)', () => {
      expect(dockerCompose).toMatch(/"1883:1883"/);
    });

    test('nodered hanya di-bind ke 127.0.0.1:1880 (SSH tunnel only)', () => {
      expect(dockerCompose).toMatch(/"127\.0\.0\.1:1880:1880"/);
    });

    test('nginx expose port 8080 (HTTP) dan 443 (HTTPS)', () => {
      expect(dockerCompose).toMatch(/"8080:80"/);
      expect(dockerCompose).toMatch(/"443:443"/);
    });

    test('postgres TIDAK mempublikasikan port ke luar', () => {
      // Di bagian postgres tidak ada "ports:"
      const pgSection = dockerCompose.substring(
        dockerCompose.indexOf('postgres:'),
        dockerCompose.indexOf('mosquitto:')
      );
      expect(pgSection).not.toMatch(/^\s+ports:/m);
    });
  });

  describe('Volumes', () => {
    test('mendefinisikan named volumes: pgdata dan mosquitto_data', () => {
      expect(dockerCompose).toMatch(/^volumes:$/m);
      expect(dockerCompose).toMatch(/pgdata:/);
      expect(dockerCompose).toMatch(/mosquitto_data:/);
    });

    test('init.sql di-mount ke postgres entrypoint', () => {
      expect(dockerCompose).toMatch(/init\.sql:\/docker-entrypoint-initdb\.d\/01-init\.sql/);
    });
  });

  describe('Environment variables', () => {
    test('nodered menerima semua environment yang diperlukan', () => {
      const noderedSection = dockerCompose.substring(
        dockerCompose.indexOf('nodered:'),
        dockerCompose.indexOf('nginx:')
      );
      const requiredEnvs = [
        'PGHOST', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD',
        'JWT_SECRET', 'DOOR_THRESHOLD_CM', 'DOOR_HOLD_MS', 'BUZZER_MS',
        'READING_INTERVAL_S', 'RETENTION_DAYS'
      ];
      for (const env of requiredEnvs) {
        expect(noderedSection).toContain(env);
      }
    });

    test('postgres healthcheck menggunakan pg_isready', () => {
      expect(dockerCompose).toMatch(/pg_isready/);
    });
  });
});

describe('Nginx Configuration', () => {

  test('WebSocket upgrade map didefinisikan', () => {
    expect(nginxConf).toMatch(/map\s+\$http_upgrade\s+\$connection_upgrade/);
  });

  test('/api/ di-proxy ke nodered:1880', () => {
    expect(nginxConf).toMatch(/location\s+\/api\//);
    expect(nginxConf).toMatch(/proxy_pass\s+http:\/\/nodered:1880/);
  });

  test('/ws di-proxy ke nodered:1880 dengan WebSocket upgrade', () => {
    expect(nginxConf).toMatch(/location\s+\/ws/);
    expect(nginxConf).toMatch(/proxy_http_version\s+1\.1/);
    expect(nginxConf).toMatch(/proxy_set_header\s+Upgrade\s+\$http_upgrade/);
    expect(nginxConf).toMatch(/proxy_set_header\s+Connection\s+\$connection_upgrade/);
  });

  test('WebSocket timeout cukup panjang (3600s)', () => {
    expect(nginxConf).toMatch(/proxy_read_timeout\s+3600s/);
    expect(nginxConf).toMatch(/proxy_send_timeout\s+3600s/);
  });

  test('X-Real-IP header di-forward (untuk rate limiting login)', () => {
    expect(nginxConf).toMatch(/proxy_set_header\s+X-Real-IP\s+\$remote_addr/);
  });

  test('Frontend SPA fallback ke index.html', () => {
    expect(nginxConf).toMatch(/try_files\s+\$uri\s+\$uri\/\s+\/index\.html/);
  });

  test('client_max_body_size dibatasi (1m)', () => {
    expect(nginxConf).toMatch(/client_max_body_size\s+1m/);
  });
});

describe('Mosquitto Configuration', () => {

  test('persistence diaktifkan', () => {
    expect(mosquittoConf).toMatch(/^persistence\s+true$/m);
  });

  test('per_listener_settings diaktifkan', () => {
    expect(mosquittoConf).toMatch(/^per_listener_settings\s+true$/m);
  });

  test('port 1883 menggunakan autentikasi (allow_anonymous false)', () => {
    // Harus ada listener 1883 diikuti allow_anonymous false
    const idx1883 = mosquittoConf.indexOf('listener 1883');
    expect(idx1883).toBeGreaterThan(-1);
    const after1883 = mosquittoConf.substring(idx1883, mosquittoConf.indexOf('listener 1884'));
    expect(after1883).toMatch(/allow_anonymous\s+false/);
    expect(after1883).toMatch(/password_file/);
  });

  test('port 1884 (internal) mengizinkan anonymous', () => {
    const idx1884 = mosquittoConf.indexOf('listener 1884');
    expect(idx1884).toBeGreaterThan(-1);
    const after1884 = mosquittoConf.substring(idx1884);
    expect(after1884).toMatch(/allow_anonymous\s+true/);
  });

  test('port 1884 TIDAK di-publish di docker-compose.yml (tidak ada port mapping)', () => {
    // Port 1884 mungkin muncul di komentar, tapi TIDAK boleh ada di port mapping
    expect(dockerCompose).not.toMatch(/"1884:1884"/);
    expect(dockerCompose).not.toMatch(/".*1884.*"/);
    // Pastikan hanya port 1883 yang di-mapping di bagian mosquitto
    const mqSection = dockerCompose.substring(
      dockerCompose.indexOf('mosquitto:'),
      dockerCompose.indexOf('nodered:')
    );
    const portMappings = mqSection.match(/"(\d+:\d+)"/g) || [];
    expect(portMappings).toEqual(['"1883:1883"']);
  });
});

describe('Node-RED Dockerfile', () => {

  test('base image adalah nodered/node-red:3.1', () => {
    expect(dockerfile).toMatch(/FROM\s+nodered\/node-red:3\.1/);
  });

  test('menginstal custom node dan pg driver', () => {
    expect(dockerfile).toMatch(/npm install.*daylight-ws.*pg@8/s);
  });

  test('menyalin settings.js dan flows.json ke /data/', () => {
    expect(dockerfile).toMatch(/COPY.*settings\.js\s+flows\.json\s+\/data\//);
  });

  test('menggunakan ownership node-red:node-red (non-root)', () => {
    expect(dockerfile).toMatch(/--chown=node-red:node-red/);
  });
});

describe('Environment Files', () => {

  describe('.env.example', () => {
    test('memiliki semua variabel yang diperlukan', () => {
      const required = [
        'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD',
        'JWT_SECRET', 'JWT_TTL_HOURS',
        'MQTT_USER', 'MQTT_PASSWORD',
        'DOOR_THRESHOLD_CM', 'DOOR_HOLD_MS', 'BUZZER_MS',
        'READING_INTERVAL_S', 'RETENTION_DAYS', 'TZ_NAME'
      ];
      for (const v of required) {
        expect(envExample).toContain(v + '=');
      }
    });

    test('placeholder values berisi GANTI', () => {
      expect(envExample).toMatch(/POSTGRES_PASSWORD=GANTI/);
      expect(envExample).toMatch(/JWT_SECRET=GANTI/);
      expect(envExample).toMatch(/MQTT_PASSWORD=GANTI/);
    });
  });

  describe('.env (generated)', () => {
    test('password dan secret sudah diganti dari placeholder', () => {
      expect(envFile).not.toMatch(/POSTGRES_PASSWORD=GANTI/);
      expect(envFile).not.toMatch(/JWT_SECRET=GANTI/);
      expect(envFile).not.toMatch(/MQTT_PASSWORD=GANTI/);
    });

    test('JWT_SECRET minimal 16 karakter (syarat settings.js)', () => {
      const match = envFile.match(/JWT_SECRET=(.+)/);
      expect(match).not.toBeNull();
      expect(match[1].length).toBeGreaterThanOrEqual(16);
    });

    test('POSTGRES_PASSWORD tidak kosong', () => {
      const match = envFile.match(/POSTGRES_PASSWORD=(.+)/);
      expect(match).not.toBeNull();
      expect(match[1].length).toBeGreaterThan(0);
    });

    test('TZ_NAME diisi Asia/Jakarta', () => {
      expect(envFile).toMatch(/TZ_NAME=Asia\/Jakarta/);
    });
  });
});

describe('Setup Script', () => {
  test('setup.sh ada dan bisa dibaca', () => {
    expect(setupSh).toBeDefined();
    expect(setupSh.length).toBeGreaterThan(0);
  });

  test('menggunakan openssl untuk generate random secrets', () => {
    expect(setupSh).toMatch(/openssl\s+rand\s+-hex/);
  });

  test('membuat akun MQTT via mosquitto_passwd', () => {
    expect(setupSh).toMatch(/mosquitto_passwd/);
  });

  test('chmod 600 pada .env (file sensitif)', () => {
    expect(setupSh).toMatch(/chmod\s+600\s+\.env/);
  });

  test('tidak menimpa .env yang sudah ada', () => {
    expect(setupSh).toMatch(/if\s*\[\s*-f\s*\.env\s*\]/);
  });
});
