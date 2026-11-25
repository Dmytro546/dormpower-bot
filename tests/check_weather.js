'use strict';
// Л16: підміна globalThis.fetch, 5 типів мережевих збоїв і TTL-кеш.
const { createWeather } = require('../weather');

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

const originalFetch = globalThis.fetch;
let mode = 'ok';
let urls = [];

function jsonResponse(payload, okFlag = true, status = 200) {
  return { ok: okFlag, status, json: async () => payload };
}

globalThis.fetch = async (url) => {
  urls.push(String(url));
  if (mode === 'network') throw new Error('ECONNRESET');
  if (mode === 'http') return jsonResponse({}, false, 503);
  if (mode === 'bad-shape') return { ok: true, status: 200 };
  if (String(url).includes('geocoding-api')) {
    if (mode === 'no-results') return jsonResponse({ results: [] });
    if (mode === 'bad-coords') return jsonResponse({ results: [{ name: 'X', latitude: 'N/A', longitude: null }] });
    const name = decodeURIComponent(String(url).split('name=')[1].split('&')[0]);
    return jsonResponse({ results: [{ name, latitude: 50.45, longitude: 30.52 }] });
  }
  if (mode === 'bad-forecast') return jsonResponse({ current: {} });
  return jsonResponse({ current: { temperature_2m: -5, wind_speed_10m: 3 } });
};

async function expectError(weather, city, label) {
  let error = null;
  try { await weather.weather(city); } catch (err) { error = err; }
  ok(error !== null, label);
  return error;
}

async function main() {
  section('Л16 — Open-Meteo та TTL-кеш');
  const weather = createWeather();
  const first = await weather.weather('Київ');
  eq(first.city, 'Київ', '070: геокодинг повернув місто');
  eq(first.temperature, -5, '071: температура з прогнозу');
  ok(first.heatingKw > 0, '072: холод додає навантаження обігрівачів');
  ok(first.advice.includes('кВт'), '073: порада містить кВт');
  eq(first.fromCache, false, '074: перший запит не з кешу');
  ok(urls[0].includes('%D0%9A'), '075: encodeURIComponent для назви міста');
  ok(urls[0].includes('geocoding-api.open-meteo.com'), '076: геокодинг API');
  ok(urls[1].includes('api.open-meteo.com/v1/forecast'), '077: forecast API');
  ok(urls[1].includes('current=temperature_2m'), '078: запит поточної температури');

  const countBefore = urls.length;
  const cached = await weather.weather('КИЇВ');
  eq(cached.fromCache, true, '079: повторний запит — з кешу (10 хв, регістронезалежно)');
  eq(urls.length, countBefore, '080: кеш не робить зайвих HTTP-запитів');

  mode = 'network';
  let error = await expectError(weather, 'Lviv', '081: мережевий збій оброблено');
  ok(/ECONNRESET/.test(error.message), '082: повідомлення мережевої помилки збережено');

  mode = 'http';
  weather.clearCache();
  error = await expectError(weather, 'Lviv', '083: HTTP 503 оброблено');
  ok(/HTTP 503/.test(error.message), '084: response.ok перевіряється');

  mode = 'no-results';
  error = await expectError(weather, 'Nowhere', '085: порожній геокодинг оброблено');
  ok(/Місто не знайдено/.test(error.message), '086: зрозуміле повідомлення');

  mode = 'bad-coords';
  error = await expectError(weather, 'Lviv', '087: хибні координати оброблено');
  ok(/координат/.test(error.message), '088: перевірка структури координат');

  mode = 'bad-forecast';
  error = await expectError(weather, 'Lviv', '089: хибний прогноз оброблено');
  ok(/структура прогнозу/.test(error.message), '090: перевірка структури forecast');

  mode = 'bad-shape';
  error = await expectError(weather, 'Lviv', '091: відповідь без json() оброблено');
  ok(/Некоректна відповідь/.test(error.message), '092: перевірка форми response');

  mode = 'ok';
  let clock = Date.parse('2026-11-21T10:00:00.000Z');
  const expiring = createWeather({ now: () => clock, ttlMs: 10 * 60 * 1000 });
  await expiring.weather('Kyiv');
  clock += 9 * 60 * 1000;
  eq((await expiring.weather('Kyiv')).fromCache, true, '093: кеш живий через 9 хв');
  clock += 2 * 60 * 1000;
  eq((await expiring.weather('Kyiv')).fromCache, false, '094: кеш оновився через 11 хв');

  const compared = await weather.compare('Київ', 'Харків');
  eq(compared.delta, 0, '095: /compare повертає різницю температур');
  ok(compared.left && compared.right, '096: /compare повертає два міста');

  console.log(`\nРЕЗУЛЬТАТ: ${passed} PASS / ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
}).finally(() => { globalThis.fetch = originalFetch; });
