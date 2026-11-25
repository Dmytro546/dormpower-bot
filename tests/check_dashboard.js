'use strict';
// Л20: рівно 25 перевірок захищеного дашборда.
const { createDashboard, escapeHtml } = require('../dashboard');
const { createIngest } = require('../ingest');
const { renderChart } = require('../utils/chart');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        passed += 1; console.log(`  OK   ${label}`);
      }, (err) => {
        failed += 1; console.error(`  FAIL ${label}: ${err.message}`);
      });
    }
    passed += 1; console.log(`  OK   ${label}`);
    return undefined;
  } catch (err) {
    failed += 1; console.error(`  FAIL ${label}: ${err.message}`);
    return undefined;
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message || 'умова не виконана');
}
function eq(actual, expected, message) {
  assert(actual === expected, `очікувано ${JSON.stringify(expected)}, отримано ${JSON.stringify(actual)}`);
}

const TOKEN = '0123456789abcdef0123456789abcdef';
const PNG = renderChart({ points: [2, 2.5, 3, 2.2], room: '314А' }).buffer;
const XSS = '<script>alert(1)</script>&"';
const store = {
  current: () => ({
    readings: [
      { id: 1, room: XSS, power: 3.51, createdAt: '2026-11-21T09:00:00.000Z', source: 'http' },
      { id: 2, room: '205', power: 2.1, createdAt: '2026-11-21T10:00:00.000Z', source: 'manual' },
    ],
  }),
};

async function main() {
  console.log('== Л20 — захищений дашборд (25 перевірок) ==');
  let dashboard = null;
  let ingest = null;
  let base = '';

  await check('190: DASHBOARD_TOKEN має бути 32 hex', () => {
    let error = null;
    try { createDashboard({ store, token: 'short', chartProvider: () => PNG }); } catch (err) { error = err; }
    assert(error !== null && /32 hex/.test(error.message));
  });

  await check('191: валідний 32-hex токен приймається', () => {
    dashboard = createDashboard({ store, token: TOKEN, chartProvider: () => PNG, adminId: 555 });
    eq(dashboard.token, TOKEN);
  });

  await check('192: авторизація через query-параметр token', () => {
    eq(dashboard.authorized({}, new URL(`http://127.0.0.1/dashboard?token=${TOKEN}`)), true);
  });

  await check('193: авторизація через заголовок x-dashboard-token', () => {
    eq(dashboard.authorized({ headers: { 'x-dashboard-token': TOKEN } }, new URL('http://127.0.0.1/dashboard')), true);
  });

  await check('194: хибний токен відхиляється', () => {
    eq(dashboard.authorized({}, new URL('http://127.0.0.1/dashboard?token=bad')), false);
  });

  await check('195: відсутній токен відхиляється', () => {
    eq(dashboard.authorized({}, new URL('http://127.0.0.1/dashboard')), false);
  });

  await check('196: токен регістронезалежний', () => {
    eq(dashboard.authorized({}, new URL(`http://127.0.0.1/dashboard?token=${TOKEN.toUpperCase()}`)), true);
  });

  await check('197: escapeHtml екранує & першим', () => {
    eq(escapeHtml('&'), '&amp;');
    eq(escapeHtml('&lt;'), '&amp;lt;');
  });

  await check('198: escapeHtml екранує < і >', () => {
    eq(escapeHtml('<b>'), '&lt;b&gt;');
  });

  await check('199: escapeHtml екранує подвійні та одинарні лапки', () => {
    eq(escapeHtml('"\''), '&quot;&#39;');
  });

  await check('200: XSS: сирий <script> не потрапляє в HTML', async () => {
    ingest = createIngest({ store, apiKey: 'k', port: 0, extraHandler: dashboard.handler });
    const address = await ingest.listen(0);
    base = `http://127.0.0.1:${address.port}`;
    const res = await fetch(`${base}/dashboard?token=${TOKEN}`);
    const html = await res.text();
    assert(!html.includes('<script>'), 'сирий тег присутній');
  });

  await check('201: XSS-рядок екрановано (&lt;script&gt;)', async () => {
    const html = await (await fetch(`${base}/dashboard?token=${TOKEN}`)).text();
    assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });

  await check('202: амперсанд у room екрановано (&amp;)', async () => {
    const html = await (await fetch(`${base}/dashboard?token=${TOKEN}`)).text();
    assert(html.includes('&amp;&quot;'));
  });

  await check('203: GET /dashboard з валідним токеном → 200 (text/html)', async () => {
    const res = await fetch(`${base}/dashboard?token=${TOKEN}`);
    eq(res.status, 200);
    assert((res.headers.get('content-type') || '').includes('text/html'));
  });

  await check('205: Cache-Control: no-store', async () => {
    const res = await fetch(`${base}/dashboard?token=${TOKEN}`);
    eq(res.headers.get('cache-control'), 'no-store');
  });

  await check('206: Referrer-Policy: no-referrer', async () => {
    const res = await fetch(`${base}/dashboard?token=${TOKEN}`);
    eq(res.headers.get('referrer-policy'), 'no-referrer');
  });

  await check('207: X-Content-Type-Options: nosniff', async () => {
    const res = await fetch(`${base}/dashboard?token=${TOKEN}`);
    eq(res.headers.get('x-content-type-options'), 'nosniff');
  });

  await check('208: GET /chart.png з валідним токеном → 200', async () => {
    const res = await fetch(`${base}/chart.png?token=${TOKEN}`);
    eq(res.status, 200);
  });

  await check('209: /chart.png віддає image/png', async () => {
    const res = await fetch(`${base}/chart.png?token=${TOKEN}`);
    assert((res.headers.get('content-type') || '').includes('image/png'));
  });

  await check('210: /chart.png містить PNG-сигнатуру', async () => {
    const res = await fetch(`${base}/chart.png?token=${TOKEN}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    eq(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  });

  await check('211: /chart.png має ті самі заголовки безпеки', async () => {
    const res = await fetch(`${base}/chart.png?token=${TOKEN}`);
    eq(res.headers.get('cache-control'), 'no-store');
    eq(res.headers.get('referrer-policy'), 'no-referrer');
    eq(res.headers.get('x-content-type-options'), 'nosniff');
  });

  await check('212: /dashboard з хибним токеном → 401', async () => {
    const res = await fetch(`${base}/dashboard?token=deadbeef`);
    eq(res.status, 401);
  });

  await check('213: /chart.png з хибним токеном → 401', async () => {
    const res = await fetch(`${base}/chart.png?token=deadbeef`);
    eq(res.status, 401);
  });

  await check('214: невідомий маршрут не перехоплюється (false)', () => {
    eq(dashboard.handler({ url: '/ingest', method: 'POST', headers: {} }, {}), false);
  });

  await check('215: POST /dashboard → 405', async () => {
    const res = await fetch(`${base}/dashboard?token=${TOKEN}`, { method: 'POST' });
    eq(res.status, 405);
  });

  if (ingest) await ingest.close();
  eq(passed + failed, 25, 'кількість перевірок рівно 25');
  console.log(`\nРЕЗУЛЬТАТ: ${passed} PASS / ${failed} FAIL`);
  if (failed > 0 || passed !== 25) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
