'use strict';
// Л19: генерація реального chart_check.png без графічних бібліотек.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const png = require('../utils/png');
const { sparkline, downsample, renderChart } = require('../utils/chart');
const { seedChart } = require('../seed_chart');

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

function parseChunks(buffer) {
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const crc = buffer.readUInt32BE(offset + 8 + length);
    chunks.push({ type, data, crc });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

section('Л19 — власний PNG');
const crcCheck = Buffer.from('IEND');
eq(png.crc32(crcCheck), 0xAE426082, '160: CRC32 таблиця коректна (IEND)');

const canvas = png.createCanvas(4, 4, [255, 255, 255, 255]);
png.drawLine(canvas, 4, 4, 0, 0, 3, 3, [0, 0, 0, 255]);
eq(canvas[0], 0, '161: Брезенхем малює піксель (0,0)');
eq(canvas[(3 * 4 + 3) * 4], 0, '162: Брезенхем малює піксель (3,3)');
png.drawText(canvas, 8, 8, 0, 0, '12', [0, 0, 0, 255]);
ok(canvas.some((byte, i) => i % 4 === 0 && byte === 0), '163: растровий шрифт 3×5 малює підпис');

section('Л19 — графік 640×360 та спарклайн');
const points = seedChart().map((r) => r.power);
eq(points.length, 144, '164: seed_chart — 144 точки за 24 год');
eq(downsample(Array.from({ length: 300 }, (_, i) => i)).length, 144, '165: downsample обмежує 144 точками');
eq(sparkline([2, 2, 2, 2]), '▄▄▄▄', '166: плаский спарклайн без ділення на нуль');
ok(sparkline(points, 24).length === 24, '167: sparkline повертає 24 блоки');

const chart = renderChart({ points, room: '314А' });
eq(chart.width, 640, '168: ширина 640');
eq(chart.height, 360, '169: висота 360');
eq(chart.points, 144, '170: у графіку 144 точки');
const file = path.join(__dirname, 'chart_check.png');
fs.writeFileSync(file, chart.buffer);
ok(fs.existsSync(file) && fs.statSync(file).size > 100, '171: створено реальний chart_check.png');

section('Л19 — валідація PNG');
const buffer = fs.readFileSync(file);
eq(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', '172: PNG-сигнатура');
const chunks = parseChunks(buffer);
const types = chunks.map((c) => c.type).join(',');
eq(types.includes('IHDR'), true, '173: наявний IHDR');
eq(types.includes('IDAT'), true, '174: наявний IDAT');
eq(chunks[chunks.length - 1].type, 'IEND', '175: останній чанк IEND');
eq(chunks[0].data.readUInt32BE(0), 640, '176: IHDR width = 640');
eq(chunks[0].data.readUInt32BE(4), 360, '177: IHDR height = 360');
eq(chunks[0].data[8], 8, '178: 8 біт на піксель');
eq(chunks[0].data[9], 6, '179: RGBA');
ok(chunks.every((c) => c.crc === png.crc32(Buffer.concat([
  Buffer.from(c.type, 'ascii'), c.data,
]))), '180: CRC32 кожного чанка збігається');
const idat = chunks.find((c) => c.type === 'IDAT').data;
const raw = zlib.inflateSync(idat);
eq(raw.length, (640 * 4 + 1) * 360, '181: IDAT розтискається в RGBA-растр');
eq(raw[0], 0, '182: filter type None');

section('Л19 — однакові значення');
let flatChart = null;
let flatError = null;
try { flatChart = renderChart({ points: [2, 2, 2, 2] }); } catch (err) { flatError = err; }
eq(flatError, null, '183: плаский графік не викидає помилку');
ok(flatChart && flatChart.buffer.length > 100, '184: плаский графік генерує PNG');
ok(renderChart({ points: [] }).buffer.length > 100, '185: порожній набір точок не ламає рендер');

console.log(`\nРЕЗУЛЬТАТ: ${passed} PASS / ${failed} FAIL`);
if (failed > 0) process.exitCode = 1;
