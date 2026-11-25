'use strict';

const { validateRoom, parsePower } = require('./validators');

function detectDelimiter(header) {
  return header.includes(';') ? ';' : ',';
}

// Повертає { good, errors }. Рядки нумеруються з 1 (заголовок) → повідомлення про помилку містить номер рядка.
function parseCsv(text, now = new Date().toISOString()) {
  const clean = String(text === null || text === undefined ? '' : text).replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    return { good: [], errors: [{ line: 0, raw: '', error: 'CSV порожній' }] };
  }

  const delimiter = detectDelimiter(lines[0]);
  const header = lines[0].split(delimiter).map((s) => s.trim().toLowerCase());
  const roomIdx = header.indexOf('room');
  const powerIdx = header.indexOf('power');
  const timeIdx = header.indexOf('createdat');

  if (roomIdx < 0 || powerIdx < 0) {
    return {
      good: [],
      errors: [{ line: 1, raw: lines[0], error: 'Заголовок має містити колонки room і power' }],
    };
  }

  const good = [];
  const errors = [];
  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i];
    const cells = raw.split(delimiter).map((s) => s.trim());
    try {
      const room = validateRoom(cells[roomIdx] === undefined ? '' : cells[roomIdx]);
      const power = parsePower(cells[powerIdx] === undefined ? '' : cells[powerIdx]);
      const timeRaw = timeIdx >= 0 ? cells[timeIdx] : '';
      let createdAt = now;
      if (timeRaw) {
        const parsed = new Date(timeRaw);
        if (!Number.isFinite(parsed.getTime())) throw new Error('Некоректна дата createdAt');
        createdAt = parsed.toISOString();
      }
      good.push({ room, power, createdAt, source: 'csv' });
    } catch (err) {
      errors.push({ line: i + 1, raw, error: err.message });
    }
  }
  return { good, errors };
}

function toCsv(records) {
  const lines = ['room;power;createdAt'];
  records.forEach((r) => lines.push(`${r.room};${r.power};${r.createdAt}`));
  return `${lines.join('\n')}\n`;
}

module.exports = { parseCsv, toCsv, detectDelimiter };
