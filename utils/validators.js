'use strict';

const MAX_POWER = 10;

function parseNumber(raw) {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new Error('Число має бути скінченним');
    return raw;
  }
  if (raw === null || raw === undefined) throw new Error('Введіть число');
  const s = String(raw).trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^[+-]?\d*\.?\d+$/.test(s)) {
    throw new Error(`Некоректне число: ${String(raw).slice(0, 40)}`);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error('Некоректне число');
  return n;
}

function parsePower(raw) {
  const n = parseNumber(raw);
  if (!(n > 0 && n <= MAX_POWER)) {
    throw new Error('Потужність має бути в межах 0 < power ≤ 10 кВт');
  }
  return n;
}

function validateRoom(raw) {
  const s = String(raw === null || raw === undefined ? '' : raw).trim().toUpperCase();
  if (!/^\d{3}[А-ЯЄІЇҐA-Z]?$/.test(s)) {
    throw new Error('Невірний формат кімнати. Приклади: 314А, 205, 101Б');
  }
  return s;
}

function parseId(raw) {
  const n = parseNumber(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error('ID має бути цілим додатнім числом');
  return n;
}

function parseHours(raw) {
  const n = parseNumber(raw);
  if (!(n > 0 && n <= 720)) throw new Error('Години мають бути в межах 0 < h ≤ 720');
  return n;
}

function parseCount(raw) {
  const n = parseNumber(raw);
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error('Кількість має бути від 1 до 20');
  return n;
}

function parseJson(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Некоректний JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON має бути об\'єктом');
  }
  return parsed;
}

// Л6: жорсткі пороги + комбіновані умови && / ||.
function classifyPower(rawPower, room, source = 'manual') {
  const power = parsePower(rawPower);
  const label = room || 'кімната';
  const priority = power > 3.5 || source === 'http';

  if (power > 3.5) {
    return {
      level: 'overload', code: 'overload', power, priority,
      message: `🚨 Кімната ${label}: ${power} кВт — ПЕРЕВАНТАЖЕННЯ. Ризик вибивання автомата!${priority ? ' Пріоритетний алерт.' : ''}`,
    };
  }
  if (power >= 2.5 && power <= 3.5) {
    return {
      level: 'warn', code: 'warn', power, priority,
      message: `⚠️ Кімната ${label}: ${power} кВт — попередження. Зменште навантаження.${priority ? ' Пріоритетний алерт.' : ''}`,
    };
  }
  return {
    level: 'ok', code: 'ok', power, priority,
    message: `✅ Кімната ${label}: ${power} кВт — норма.`,
  };
}

module.exports = {
  parseNumber, parsePower, validateRoom, parseId, parseHours, parseCount,
  parseJson, classifyPower,
};
