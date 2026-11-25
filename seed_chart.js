'use strict';

const { createSignal } = require('./utils/signal');

// Л19: 144 точки за 24 год для кімнати 314А.
function seedChart({
  room = '314А', count = 144, hours = 24, now = Date.now(), signal = createSignal(),
} = {}) {
  const startMs = now - hours * 60 * 60 * 1000;
  return signal.generate(count, startMs).map((row) => Object.assign({}, row, { room }));
}

if (require.main === module) {
  const rows = seedChart();
  console.log(`seed_chart: ${rows.length} точок за 24 год для ${rows[0].room}.`);
}

module.exports = { seedChart };
