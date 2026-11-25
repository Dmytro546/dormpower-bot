'use strict';
// Перевірка Батчу А (Л3–Л13) без тест-фреймворку: node tests/check_batch_a.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  classifyPower, validateRoom, parseNumber, parsePower,
  parseId, parseHours, parseCount, parseJson,
} = require('../utils/validators');
const { createStorage } = require('../storage');
const { parseCsv } = require('../utils/csv');
const { calcStats, groupByRoom, topRooms } = require('../utils/stats');
const { formatKyiv, formatAgo, parseDayRange, formatPeriodReport } = require('../utils/format');
const { registerCommands } = require('../handlers/commands');
const { registerDialog } = require('../handlers/dialog');
const { seed, HOUR } = require('../seed');

let passed = 0;
let failed = 0;

function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || 'рівність'}: очікувано ${JSON.stringify(expected)}, отримано ${JSON.stringify(actual)}`);
  }
}
function ok(condition, label) {
  if (!condition) throw new Error(label || 'умова не виконана');
}
function throws(fn, pattern, label) {
  let error = null;
  try { fn(); } catch (err) { error = err; }
  ok(error !== null, `${label || 'функція'} мала викинути помилку`);
  if (pattern) ok(pattern.test(error.message), `${label}: повідомлення "${error.message}" не збіглося з ${pattern}`);
}
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  OK   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}: ${err.message}`);
  }
}
function section(name) {
  console.log(`\n== ${name} ==`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dormpower-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
function mkStore(name) {
  return createStorage(path.join(tmp, name, 'data.json'));
}

const IMPORT_DIR = path.join(__dirname, '..', 'import');

// ---------------------------------------------------------------- Л6
section('Л6 — межові значення (8 кейсів з PROJECT_BIBLE.md)');
[
  ['2.49', 'ok'], ['2.5', 'warn'], ['2.51', 'warn'],
  ['3.49', 'warn'], ['3.5', 'warn'], ['3.51', 'overload'], ['2,7', 'warn'],
].forEach(([input, level]) => {
  check(`power=${input} → ${level}`, () => {
    eq(classifyPower(input, '314А', 'manual').level, level);
  });
});
check('некоректні входи відхиляються', () => {
  [-1, 0, 'abc', 'NaN', 'null', '100', null, undefined, Infinity, ''].forEach((raw) => {
    throws(() => classifyPower(raw, '314А'), null, `ввід ${String(raw)}`);
  });
});
check('комбіновані умови && / ||', () => {
  ok(classifyPower('2.7', '205', 'manual').level === 'warn', '&&: 2.5–3.5 → warn');
  ok(classifyPower('2.7', '205', 'http').priority === true, '||: http → пріоритетний алерт');
  ok(classifyPower('3.51', '205', 'manual').priority === true, '||: >3.5 → пріоритетний алерт');
});

// ------------------------------------------------------------- Валідатори
section('Л6–Л8 — валідатори');
check('validateRoom', () => {
  eq(validateRoom('314а'), '314А');
  eq(validateRoom(' 205 '), '205');
  eq(validateRoom('101б'), '101Б');
  throws(() => validateRoom('хімія'), null, 'кирилична назва');
  throws(() => validateRoom('31'), null, 'короткий номер');
});
check('parseNumber / parsePower', () => {
  eq(parseNumber('2,7'), 2.7);
  eq(parseNumber(' 3.51 '), 3.51);
  eq(parsePower('2,7'), 2.7);
  throws(() => parsePower('10.01'), null, 'понад 10 кВт');
  throws(() => parsePower(''), null, 'порожній ввід');
});
check('parseId / parseHours / parseCount', () => {
  eq(parseId('12'), 12);
  eq(parseHours('720'), 720);
  eq(parseCount('20'), 20);
  throws(() => parseId('0'), null, 'id=0');
  throws(() => parseHours('721'), null, '721 год');
  throws(() => parseHours('0'), null, '0 год');
  throws(() => parseCount('21'), null, 'count=21');
});
check('parseJson', () => {
  eq(parseJson('{"room":"314А"}').room, '314А');
  throws(() => parseJson('{broken'), /Некоректний JSON/, 'битий JSON');
  throws(() => parseJson('[1,2]'), /об'єктом/, 'масив замість об\'єкта');
});

// ----------------------------------------------------- Сховище / CRUD
section('Л9–Л10 — storage.js: ENOENT, битий JSON, CRUD, атомарний запис');
check('ENOENT → порожня структура', () => {
  const fresh = createStorage(path.join(tmp, 'не-існує', 'data.json')).loadData();
  eq(fresh.lastId, 0);
  eq(fresh.readings.length, 0);
  ok(Array.isArray(fresh.readings), 'readings має бути масивом []');
  eq(fresh.subscriptions.alert.length, 0);
});
check('пошкоджений JSON → зрозуміла помилка', () => {
  const bad = path.join(tmp, 'bad.json');
  fs.writeFileSync(bad, '{broken', 'utf8');
  throws(() => createStorage(bad).loadData(), /Пошкоджений JSON/, 'loadData');
});
const storeA = mkStore('crud');
check('addReading + атомарний запис .tmp → renameSync', () => {
  const rec = storeA.addReading({ room: '314а', power: '2,7' });
  eq(rec.id, 1);
  eq(rec.room, '314А');
  eq(rec.power, 2.7);
  eq(rec.source, 'manual');
  ok(!fs.existsSync(`${storeA.file}.tmp`), ' тимчасовий файл має зникнути');
  const disk = JSON.parse(fs.readFileSync(storeA.file, 'utf8'));
  eq(disk.readings.length, 1);
  eq(disk.lastId, 1);
  ok(!Number.isNaN(Date.parse(disk.readings[0].createdAt)), 'createdAt має бути ISO');
});
check('lastId тільки зростає', () => {
  const second = storeA.addReading({ room: '205', power: 3.4 });
  eq(second.id, 2);
  ok(storeA.deleteReading(2));
  const third = storeA.addReading({ room: '101Б', power: 1.8 });
  eq(third.id, 3, 'після видалення id має бути 3, не 2');
  eq(storeA.getReading(2), null);
  eq(storeA.listReadings().length, 2);
});
check('makeCopy не мутує поточні дані', () => {
  const copy = storeA.makeCopy();
  ok(copy !== storeA.current(), 'має бути нова копія');
  copy.readings[0].power = 99;
  eq(storeA.getReading(1).power, 2.7, 'оригінал не змінився до saveChanges');
  storeA.saveChanges(copy);
  eq(storeA.getReading(1).power, 99, 'після saveChanges значення застосовано');
  storeA.updateReading(1, { power: 2.7 });
  eq(storeA.getReading(1).power, 2.7);
});
check('updateReading / deleteReading / getReading', () => {
  const updated = storeA.updateReading(3, { power: '3,51', room: '101б' });
  eq(updated.power, 3.51);
  eq(updated.room, '101Б');
  throws(() => storeA.updateReading(3, { power: 'abc' }), null, 'некоректна потужність');
  eq(storeA.deleteReading(999), false);
  throws(() => storeA.getReading('abc'), null, 'некоректний id');
});
check('saveUser: роль і кімната', () => {
  const user = storeA.saveUser({ telegramId: 123456789, role: 'admin', room: '314А' });
  eq(user.role, 'admin');
  eq(user.room, '314А');
  const again = storeA.saveUser({ telegramId: 123456789, role: 'resident' });
  eq(again.id, user.id, 'повторна реєстрація не створює дублікат');
  eq(storeA.findUser(123456789).telegramId, 123456789);
});

// ------------------------------------------------------------------ CSV
section('Л11 — utils/csv.js та addManyReadings');
const storeB = mkStore('csv');
const validCsv = fs.readFileSync(path.join(IMPORT_DIR, 'readings.csv'), 'utf8');
const testCsv = fs.readFileSync(path.join(IMPORT_DIR, 'readings_test.csv'), 'utf8');
check('валідний CSV (`;`, BOM, кома в числі)', () => {
  const parsed = parseCsv(`\uFEFF${validCsv}`);
  eq(parsed.good.length, 4);
  eq(parsed.errors.length, 0);
  eq(parsed.good[0].power, 2.7);
  eq(parsed.good[0].source, 'csv');
});
check('помилковий CSV: номер рядка + розділювач `,`', () => {
  const parsed = parseCsv(testCsv);
  eq(parsed.good.length, 2);
  eq(parsed.errors.length, 2);
  eq(parsed.errors[0].line, 3);
  eq(parsed.errors[1].line, 4);
});
check('addManyReadings: «все або нічого»', () => {
  const good = parseCsv(validCsv).good;
  const inserted = storeB.addManyReadings(good);
  eq(inserted.length, 4);
  eq(storeB.listReadings(100).length, 4);
  const before = JSON.stringify(storeB.current());
  throws(() => storeB.addManyReadings([
    { room: '314А', power: 2.7 },
    { room: 'хімія', power: 1.2 },
  ]), /Рядок 2/, 'другий рядок хибний');
  eq(JSON.stringify(storeB.current()), before, 'дані не змінились після помилки');
});
check('ліміт 500 рядків', () => {
  const rows = new Array(501).fill(null).map(() => ({ room: '314А', power: 2 }));
  throws(() => storeB.addManyReadings(rows), /500/, '501 рядок');
});

// --------------------------------------------------------------- Час Л12
section('Л12 — час, доби, seed.js, фільтри');
const storeC = mkStore('time');
const NOW = Date.parse('2026-11-21T12:00:00.000Z');
check('seed.js: 72/48/25/23/5/1 год тому', () => {
  const inserted = seed(storeC, NOW);
  eq(inserted.length, 6);
  eq(storeC.getReadingsInRange(NOW - 2 * HOUR, NOW).length, 1);
  eq(storeC.getReadingsInRange(NOW - 6 * HOUR, NOW).length, 2);
  eq(storeC.getReadingsInRange(NOW - 24 * HOUR, NOW).length, 3); // 23/5/1 год тому
  eq(storeC.getReadingsInRange(NOW - 26 * HOUR, NOW).length, 4);
  eq(storeC.getReadingsInRange(NOW - 49 * HOUR, NOW).length, 5);
  eq(storeC.getReadingsInRange(NOW - 73 * HOUR, NOW).length, 6);
});
check('parseDayRange: доба в Києві = 24 год UTC', () => {
  const { fromMs, toMs } = parseDayRange('21.11.2026');
  eq(toMs - fromMs, 24 * HOUR);
  throws(() => parseDayRange('21-11-2026'), /ДД.ММ.РРРР/, 'невірний формат');
  throws(() => parseDayRange('32.11.2026'), /не існує/, 'невірна дата');
});
check('formatKyiv / formatAgo / formatPeriodReport (ліміт 10)', () => {
  ok(/\d{2}\.\d{2}\.2026/.test(formatKyiv(new Date(NOW))), 'київський формат дати');
  eq(formatAgo(new Date(NOW - 5 * 3600000).toISOString(), NOW), '5 год тому');
  eq(formatAgo(new Date(NOW - 2 * 60000).toISOString(), NOW), '2 хв тому');
  const many = new Array(12).fill(null).map((_, i) => ({
    room: '314А', power: 2 + i / 10, createdAt: new Date(NOW - i * 60000).toISOString(),
  }));
  const report = formatPeriodReport(many, NOW - 60 * 60000, NOW, NOW);
  ok(report.includes('показано останні 10 з 12'), 'у звіті має бути обмеження 10');
});

// ---------------------------------------------------------- Статистика Л13
section('Л13 — utils/stats.js');
check('calcStats: порожньо → null; числа, не конкатенація', () => {
  eq(calcStats([]), null);
  eq(calcStats(null), null);
  const stats = calcStats([{ power: '2' }, { power: 3 }]);
  eq(stats.count, 2);
  eq(stats.sum, 5);
  eq(stats.min, 2);
  eq(stats.max, 3);
  eq(stats.avg, 2.5);
});
check('groupByRoom: Object.create(null)', () => {
  const grouped = groupByRoom([{ room: 'constructor', power: 2 }, { room: '314А', power: 3 }]);
  eq(grouped.constructor.count, 1);
  eq(grouped['314А'].count, 1);
  eq(Object.getPrototypeOf(grouped), null);
});
check('topRooms не мутує оригінал', () => {
  const rows = [
    { room: '314А', power: 2 }, { room: '314А', power: 3 },
    { room: '205', power: 4 }, { room: '101Б', power: 1 },
  ];
  const snapshot = JSON.stringify(rows);
  const top = topRooms(rows, 2);
  eq(top.length, 2);
  eq(top[0].room, '314А'); // 2 + 3 = 5 кВт > 4 кВт
  eq(JSON.stringify(rows), snapshot, 'оригінальний масив не змінено');
});

// -------------------------------------------------------- Реєстрація Бот API
section('Інваріанти реєстрації');
check('порядок: команди → hears → bot.on("text") останнім', () => {
  const calls = [];
  const fakeBot = {
    command(name) { calls.push(['command', name]); },
    hears(words) { calls.push(['hears', words]); },
    on(event) { calls.push(['on', event]); },
    catch() { calls.push(['catch']); },
  };
  registerCommands(fakeBot);
  registerDialog(fakeBot);
  eq(calls[calls.length - 1][0], 'on');
  eq(calls[calls.length - 1][1], 'text');
  ok(calls.some((c) => c[0] === 'command' && String(c[1]).includes('report')));
});
check('bot.js ≤ 40 рядків', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');
  const lines = source.split(/\r?\n/).filter((line) => line.trim() !== '').length;
  ok(lines <= 40, `bot.js має ${lines} непорожніх рядків`);
});

console.log(`\nРЕЗУЛЬТАТ: ${passed} PASS / ${failed} FAIL`);
if (failed > 0) process.exitCode = 1;
