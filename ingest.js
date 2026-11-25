'use strict';

const http = require('http');

// Л17: HTTP-приймання потоку. Тільки 127.0.0.1, ключ перевіряється ДО читання тіла.
function createIngest({
  store,
  alerts = null,
  apiKey = '',
  port = 3789,
  host = '127.0.0.1',
  maxBodyBytes = 16 * 1024,
  extraHandler = null,
  outbox = null,
  autoFlushMs = 0,
  now = () => Date.now(),
} = {}) {
  function send(res, code, payload) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  }

  function handler(req, res) {
    if (extraHandler && extraHandler(req, res)) return;

    const route = String(req.url || '').split('?')[0];
    if (route !== '/ingest') return send(res, 404, { error: 'Not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if (!apiKey || req.headers['x-api-key'] !== apiKey) {
      return send(res, 401, { error: 'Unauthorized' });
    }

    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        tooBig = true;
        chunks.length = 0; // не обриваємо з'єднання — просто не зберігаємо тіло
      } else {
        chunks.push(chunk);
      }
    });
    req.on('error', () => {
      if (!res.headersSent) send(res, 400, { error: 'Bad request' });
    });
    req.on('end', () => {
      if (tooBig) return send(res, 413, { error: 'Payload too large' });
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (err) {
        return send(res, 400, { error: 'Invalid JSON' });
      }
      try {
        const reading = {
          room: payload.room,
          power: payload.power,
          time: payload.time || new Date(now()).toISOString(),
        };
        if (outbox) {
          const result = outbox.enqueue(reading);
          if (!result.accepted) {
            return send(res, result.status, { accepted: false, reason: result.reason });
          }
          return send(res, 201, result.item);
        }
        const record = store.addReading({
          room: reading.room,
          power: reading.power,
          createdAt: reading.time,
          source: 'http',
        });
        send(res, 201, record);
        if (alerts && typeof alerts.notifyReading === 'function') {
          Promise.resolve(alerts.notifyReading(record)).catch((err) => {
            console.error('[ingest alert]', err.message);
          });
        }
        return undefined;
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
    });
    return undefined;
  }

  const server = http.createServer(handler);

  let flushTimer = null;
  if (outbox && autoFlushMs > 0) {
    flushTimer = setInterval(() => {
      Promise.resolve(outbox.flush()).catch((err) => console.error('[ingest flush]', err.message));
    }, autoFlushMs);
    if (flushTimer.unref) flushTimer.unref();
  }

  function listen(listenPort = port) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(listenPort, host, () => {
        server.removeListener('error', reject);
        resolve(server.address());
      });
    });
  }

  function close() {
    if (flushTimer) clearInterval(flushTimer);
    return new Promise((resolve, reject) => {
      if (!server.listening) return resolve();
      server.close((err) => (err ? reject(err) : resolve()));
      return undefined;
    });
  }

  return { server, handler, listen, close, host };
}

module.exports = { createIngest };
