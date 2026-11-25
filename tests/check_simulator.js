'use strict';
// Л17: 13 записів із seed=15 + реальні HTTP-запити на порт 0.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSignal } = require('../utils/signal');
const { createIngest } = require('../ingest');
const { run } = require('../simulator');
const { createStorage } = require('../storage');

let passed = 0;
let failed = 0;
function ok(condition, label) {
  if (condition) { passed += 1; console.log(`  OK   ${label}`); }
  else { failed += 1; console.error(`  FAIL ${label}`); }
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} (очікувано ${JSON.stringify(expected)}, отримано ${JSON.stringify(actual)})`);
}
function section(name) { console.log(`\n== ${name} ==`); }

const START = Date.parse('2026-11-21T07:00:00.000Z');

async function main() {
  section('Л17 — LCG-симулятор');
  const signal = createSignal();
  const rows = signal.generate(13, START);
  eq(rows.length, 13, '100: згенеровано 13 записів');
  eq(createSignal().generate(13, START).map((r) => r.power).join(','),
    rows.map((r) => r.power).join(','), '101: seed=15 дає відтворювану послідовність');
  eq(rows[0].room, '314А', '102: перша кімната 314А');
  eq(rows[1].room, '205', '103: друга кімната 205');
  eq(rows[2].room, '101Б', '104: третя кімната 101Б');
  ok(rows.every((r) => r.source === 'http'), '105: джерело http');
  ok(rows.every((r) => Number.isFinite(r.power) && r.power > 0 && r.power <= 10), '106: power у межах 0 < p ≤ 10');
  ok(rows.every((r) => !Number.isNaN(Date.parse(r.createdAt))), '107: createdAt — ISO 8601');
  const rnd = createSignal().rnd();
  eq(Math.abs(rnd - 1038872098 / 2 ** 32) < 1e-12, true, '108: LCG (15 * 1664525 + 1013904223) >>> 0');
  const long = createSignal().generate(18, START);
  ok(long[8].power > long[7].power + 1, '109: аномалія на індексі 8 (+1.4)');
  ok(long[17].power > 3.5, '110: аномалія на індексі 17 (+2.8) → overload');

  section('Л17 — HTTP /ingest на порту 0');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dormpower-sim-'));
  process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
  const store = createStorage(path.join(tmp, 'data.json'));
  const ingest = createIngest({ store, apiKey: 'secret-key', port: 0, host: '127.0.0.1' });
  const address = await ingest.listen(0);
  ok(address.port > 0, '111: сервер слухає динамічний порт');
  eq(ingest.host, '127.0.0.1', '112: тільки loopback');

  const result = await run({
    count: 13, port: address.port, key: 'secret-key',
    fetchImpl: globalThis.fetch, signal: createSignal(), startMs: START,
  });
  eq(result.statuses.length, 13, '113: симулятор відправив 13 запитів');
  eq(result.statuses.every((s) => s === 201), true, '114: усі запити повернули 201');
  eq(store.current().readings.length, 13, '115: у сховищі 13 записів');
  eq(store.current().readings[0].source, 'http', '116: збережено source: http');
  eq(store.current().readings[0].power, rows[0].power, '117: значення збігаються з генератором');

  const unauthorized = await fetch(`http://127.0.0.1:${address.port}/ingest`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ room: '314А', power: 2 }),
  });
  eq(unauthorized.status, 401, '118: хибний/відсутній x-api-key → 401');
  await ingest.close();

  console.log(`\nРЕЗУЛЬТАТ: ${passed} PASS / ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
