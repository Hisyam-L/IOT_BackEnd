// WebSocket server untuk dashboard.
//  - Klien tersambung ke  ws(s)://host/ws?token=<jwt>  (token diverifikasi saat handshake)
//  - Saat klien tersambung, node ini mengeluarkan msg { topic:'connect', _client:<id> }
//    di output. Flow membalas dengan snapshot lewat input node ini (msg._client = id).
//  - Pesan masuk ke input TANPA msg._client dikirim ke semua klien (broadcast).
module.exports = function (RED) {
  const { WebSocketServer } = require('ws');

  function DaylightWs(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const path = config.path || '/ws';
    const wss = new WebSocketServer({ noServer: true });
    const clients = new Map();
    let seq = 0;

    function status() {
      node.status({ fill: 'green', shape: 'dot', text: clients.size + ' klien' });
    }

    function onUpgrade(req, socket, head) {
      let url;
      try { url = new URL(req.url, 'http://localhost'); } catch (e) { return; }
      if (url.pathname !== path) return; // biarkan handler lain (editor Node-RED) menangani

      const auth = node.context().global.get('auth');
      const user = auth && auth.verify(url.searchParams.get('token') || '');
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, function (ws) {
        const id = 'c' + (++seq);
        ws.isAlive = true;
        clients.set(id, ws);
        status();
        ws.on('pong', function () { ws.isAlive = true; });
        ws.on('error', function () {});
        ws.on('close', function () { clients.delete(id); status(); });
        node.send({ topic: 'connect', _client: id, user: user });
      });
    }

    RED.server.on('upgrade', onUpgrade);

    // ping berkala: buang koneksi mati & jaga koneksi lewat Nginx
    const ping = setInterval(function () {
      clients.forEach(function (ws, id) {
        if (!ws.isAlive) { ws.terminate(); clients.delete(id); return; }
        ws.isAlive = false;
        try { ws.ping(); } catch (e) {}
      });
      status();
    }, 25000);

    node.on('input', function (msg, send, done) {
      let data = msg.payload;
      if (data !== undefined && data !== null) {
        if (typeof data !== 'string') data = JSON.stringify(data);
        if (msg._client) {
          const ws = clients.get(msg._client);
          if (ws && ws.readyState === 1) ws.send(data);
        } else {
          clients.forEach(function (ws) { if (ws.readyState === 1) ws.send(data); });
        }
      }
      if (done) done();
    });

    node.on('close', function (removed, done) {
      clearInterval(ping);
      RED.server.removeListener('upgrade', onUpgrade);
      clients.forEach(function (ws) { try { ws.terminate(); } catch (e) {} });
      clients.clear();
      wss.close();
      done();
    });

    status();
  }

  RED.nodes.registerType('daylight-ws', DaylightWs);
};
