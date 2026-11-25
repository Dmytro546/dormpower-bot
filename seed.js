'use strict';

const storage = require('./storage');

const HOUR = 60 * 60 * 1000;

// Л12: керовані дані для перевірки фільтрів без очікування в реальному часі.
const ROWS = [
  { hoursAgo: 72, room: '314А', power: 2.1 },
  { hoursAgo: 48, room: '205', power: 3.4 },
  { hoursAgo: 25, room: '101Б', power: 2.7 },
  { hoursAgo: 23, room: '314А', power: 3.6 },
  { hoursAgo: 5, room: '205', power: 1.8 },
  { hoursAgo: 1, room: '314А', power: 2.9 },
];

function seed(targetStorage = storage, now = Date.now()) {
  const rows = ROWS.map((row) => Object.assign({}, row, {
    createdAt: new Date(now - row.hoursAgo * HOUR).toISOString(),
    source: 'manual',
  }));
  return targetStorage.addManyReadings(rows);
}

if (require.main === module) {
  try {
    const inserted = seed();
    console.log(`Seed: додано ${inserted.length} записів (72/48/25/23/5/1 год тому).`);
  } catch (err) {
    console.error('Seed помилка:', err.message);
    process.exitCode = 1;
  }
}

module.exports = { seed, ROWS, HOUR };
