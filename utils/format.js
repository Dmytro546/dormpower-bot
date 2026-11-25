'use strict';

const TIMEZONE = 'Europe/Kiev';
const REPORT_LIMIT = 10;

const dtf = new Intl.DateTimeFormat('uk-UA', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatKyiv(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(d.getTime())) throw new Error('Некоректна дата');
  return dtf.format(d);
}

const hourFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE, hourCycle: 'h23', hour: '2-digit',
});

function kyivHour(at = new Date()) {
  return Number(hourFmt.format(at));
}

function kyivDayKey(at = new Date()) {
  return formatKyiv(at).split(',')[0].trim(); // ДД.ММ.РРРР без хвилин
}

function kyivOffsetMs(at = new Date()) {
  const tz = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, timeZoneName: 'longOffset',
  }).format(at).split(', ').pop() || 'GMT+02:00';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(tz);
  if (!m) return 2 * 60 * 60 * 1000;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3])) * 60 * 1000;
}

// Вхід: ДД.ММ.РРРР. Повертає UTC-мілісекунди початку доби в Києві.
function startOfKyivDay(raw) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(raw).trim());
  if (!m) throw new Error('Формат дати: ДД.ММ.РРРР, наприклад 21.11.2026');
  const day = Number(m[1]); const month = Number(m[2]); const year = Number(m[3]);
  const utcGuess = Date.UTC(year, month - 1, day);
  const d = new Date(utcGuess);
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new Error('Такої дати не існує');
  }
  return utcGuess - kyivOffsetMs(d);
}

function parseDayRange(raw) {
  const fromMs = startOfKyivDay(raw);
  return { fromMs, toMs: fromMs + 24 * 60 * 60 * 1000 };
}

function formatAgo(createdAt, now = Date.now()) {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return 'дата невідома';
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'щойно';
  if (min < 60) return `${min} хв тому`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} год тому`;
  return `${Math.floor(hours / 24)} дн тому`;
}

function formatPeriodReport(records, fromMs, toMs, now = Date.now()) {
  const rows = records.filter((r) => {
    const t = Date.parse(r.createdAt);
    return Number.isFinite(t) && t >= fromMs && t <= toMs;
  });
  const lines = [
    `Звіт: ${formatKyiv(new Date(fromMs))} — ${formatKyiv(new Date(toMs))}`,
    `Записів за період: ${rows.length}`,
  ];
  rows.slice(-REPORT_LIMIT).reverse().forEach((r) => {
    lines.push(`• ${r.room}: ${r.power} кВт · ${formatAgo(r.createdAt, now)}`);
  });
  if (rows.length > REPORT_LIMIT) lines.push(`… показано останні ${REPORT_LIMIT} з ${rows.length}`);
  return lines.join('\n');
}

function formatStatsReport(stats) {
  if (!stats) return 'Немає даних за період.';
  return [
    'Статистика споживання:',
    `• записів: ${stats.count}`,
    `• мінімум: ${stats.min} кВт`,
    `• максимум: ${stats.max} кВт`,
    `• середнє: ${stats.avg.toFixed(2)} кВт`,
    `• сума: ${stats.sum.toFixed(2)} кВт`,
  ].join('\n');
}

module.exports = {
  TIMEZONE, formatKyiv, kyivHour, kyivDayKey, kyivOffsetMs,
  startOfKyivDay, parseDayRange, formatAgo, formatPeriodReport, formatStatsReport,
};
