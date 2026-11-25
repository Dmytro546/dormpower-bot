'use strict';

// Порожній список → null (не NaN), усі числа приведені до Number (не конкатенація рядків).
function calcStats(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const nums = records.map((r) => Number(r.power)).filter((n) => Number.isFinite(n));
  if (nums.length === 0) return null;
  const sum = nums.reduce((acc, n) => acc + n, 0);
  return {
    count: nums.length,
    min: Math.min(...nums),
    max: Math.max(...nums),
    avg: sum / nums.length,
    sum,
  };
}

function groupByRoom(records) {
  const out = Object.create(null); // захист від TOPICS['constructor'] і подібних ключів
  (records || []).forEach((r) => {
    const key = r.room;
    const bucket = out[key] || (out[key] = { room: key, count: 0, sum: 0, max: -Infinity });
    bucket.count += 1;
    bucket.sum += Number(r.power);
    bucket.max = Math.max(bucket.max, Number(r.power));
  });
  Object.keys(out).forEach((key) => {
    out[key].avg = out[key].sum / out[key].count;
    out[key].sum = Math.round(out[key].sum * 1000) / 1000;
  });
  return out;
}

function topRooms(records, count = 5) {
  const groups = groupByRoom((records || []).slice()); // тільки копія — оригінал не змінюється
  return Object.keys(groups)
    .map((key) => groups[key])
    .sort((a, b) => b.sum - a.sum || a.room.localeCompare(b.room, 'uk'))
    .slice(0, count);
}

module.exports = { calcStats, groupByRoom, topRooms };
