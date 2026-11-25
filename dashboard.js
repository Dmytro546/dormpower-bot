'use strict';

const TOKEN_RE = /^[0-9a-f]{32}$/i;

// Л20: екранування ВСЬОГО зовнішнього. '&' обов'язково першим.
function escapeHtml(input) {
  return String(input === null || input === undefined ? '' : input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Мінімальний захищений дашборд на тому самому HTTP-сервері, що й /ingest.
function createDashboard({ store, token, chartProvider = null, adminId = 0 } = {}) {
  if (!TOKEN_RE.test(String(token || ''))) {
    throw new Error('DASHBOARD_TOKEN має бути 32 hex-символами');
  }
  const secret = String(token).toLowerCase();
  const securityHeaders = Object.assign(Object.create(null), {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });

  function send(res, code, body, contentType) {
    const headers = Object.assign(Object.create(null), securityHeaders, {
      'Content-Type': contentType,
    });
    res.writeHead(code, headers);
    res.end(body);
  }

  function authorized(req, url) {
    const headers = (req && req.headers) || Object.create(null);
    const candidates = [url.searchParams.get('token'), headers['x-dashboard-token']];
    return candidates.some((raw) => {
      const candidate = String(raw || '');
      return TOKEN_RE.test(candidate) && candidate.toLowerCase() === secret;
    });
  }

  function renderHtml(url) {
    const rows = store.current().readings.slice().reverse().slice(0, 50);
    const safeToken = escapeHtml(url.searchParams.get('token') || '');
    const body = rows.map((r) => [
      '<tr>',
      `<td>${escapeHtml(r.id)}</td>`,
      `<td>${escapeHtml(r.room)}</td>`,
      `<td>${escapeHtml(r.power)}</td>`,
      `<td>${escapeHtml(r.createdAt)}</td>`,
      `<td>${escapeHtml(r.source)}</td>`,
      '</tr>',
    ].join('')).join('\n');
    return [
      '<!doctype html><html lang="uk"><head><meta charset="utf-8">',
      '<title>DormPower Dashboard</title></head><body>',
      '<h1>DormPower ⚡ Dashboard</h1>',
      `<p>Записів у таблиці: ${escapeHtml(rows.length)} · комендант: ${escapeHtml(adminId || '—')}</p>`,
      '<table border="1"><thead><tr><th>ID</th><th>room</th><th>power</th><th>createdAt</th><th>source</th></tr></thead>',
      `<tbody>${body}</tbody></table>`,
      `<p><img src="/chart.png?token=${safeToken}" alt="Графік споживання"></p>`,
      `<p style="display:none">${safeToken}</p>`,
      '</body></html>',
    ].join('\n');
  }

  // Повертає true, якщо маршрут оброблено (сумісний з extraHandler в ingest.js).
  function handler(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1');
    } catch (err) {
      send(res, 400, 'Bad request', 'text/plain; charset=utf-8');
      return true;
    }
    if (url.pathname !== '/dashboard' && url.pathname !== '/chart.png') return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
      return true;
    }
    if (!authorized(req, url)) {
      send(res, 401, 'Unauthorized', 'text/plain; charset=utf-8');
      return true;
    }
    if (url.pathname === '/chart.png') {
      const png = typeof chartProvider === 'function' ? chartProvider() : Buffer.alloc(0);
      send(res, 200, png, 'image/png');
      return true;
    }
    send(res, 200, renderHtml(url), 'text/html; charset=utf-8');
    return true;
  }

  function link(port) {
    return `http://127.0.0.1:${port}/dashboard?token=${secret}`;
  }

  return {
    handler, renderHtml, authorized, link, securityHeaders,
    token: secret, escapeHtml,
  };
}

module.exports = { createDashboard, escapeHtml, TOKEN_RE };
