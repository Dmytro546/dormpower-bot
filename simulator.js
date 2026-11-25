'use strict';

const config = require('./config');
const { createSignal } = require('./utils/signal');

// Л17: окремий процес-виробник. Надсилає показання на /ingest.
async function run({
  count = 13,
  port = config.INGEST_PORT,
  key = config.INGEST_KEY,
  host = '127.0.0.1',
  fetchImpl = (...args) => globalThis.fetch(...args),
  signal = createSignal(),
  startMs = Date.now(),
} = {}) {
  const rows = signal.generate(count, startMs);
  const statuses = [];
  for (const row of rows) {
    try {
      const response = await fetchImpl(`http://${host}:${port}/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ room: row.room, power: row.power, time: row.createdAt }),
        signal: AbortSignal.timeout(5000),
      });
      statuses.push(response.status);
    } catch (err) {
      statuses.push({ error: err.message });
    }
  }
  return { rows, statuses };
}

if (require.main === module) {
  const count = Number(process.env.SIM_COUNT || 13);
  run({ count }).then(({ statuses }) => {
    const created = statuses.filter((s) => s === 201).length;
    console.log(`Симулятор: ${created}/${statuses.length} записів прийнято (201).`);
  }).catch((err) => {
    console.error('Симулятор:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { run };
