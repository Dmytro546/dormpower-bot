'use strict';
// Л18: FIFO outbox, повтор при 401, 400 — остаточна, ідемпотентність (room, time) → 200.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createOutbox, MAX_AGE_MS, FUTURE_TOLERANCE_MS, MAX_ATTEMPTS } = require('../utils/outbox');
const { createStorage } = require('../storage');

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

const NOW = Date.parse('2026-11-21T12:00:00.000Z');
const at = (offsetMs) => new Date(NOW + offsetMs).toISOString();

async function main() {
  section('Л18 — черга надійного потоку');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dormpower-outbox-'));
  process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
  const store = createStorage(path.join(tmp, 'data.json'));

  eq(MAX_AGE_MS, 7 * 24 * 60 * 60 * 1000, '120: максимальний вік — 7 діб');
  eq(FUTURE_TOLERANCE_MS, 5 * 60 * 1000, '121: допуск у майбутнє — 5 хв');
  eq(MAX_ATTEMPTS, 5, '122: не більше 5 спроб');

  let attempts = 0;
  const send = async (item) => {
    attempts += 1;
    if (attempts === 1) {
      const err = new Error('Unauthorized');
      err.code = 401; // тимчасова помилка — повторюємо
      throw err;
    }
    store.addReading({ room: item.room, power: item.power, createdAt: item.time, source: 'http' });
    return { ok: true };
  };
  const outbox = createOutbox({ store, send, now: () => NOW });

  const first = outbox.enqueue({ room: '314А', power: 2.7, time: at(-120000) });
  const second = outbox.enqueue({ room: '205', power: '3,51', time: at(-60000) });
  eq(first.status, 201, '123: перший запис прийнято (201)');
  eq(second.status, 201, '124: другий запис прийнято (201)');
  eq(second.item.power, 3.51, '125: кома → крапка');
  eq(outbox.size(), 2, '126: у черзі 2 записи');
  eq(outbox.peek()[0].room, '314А', '127: FIFO — хронологічний порядок');
  eq(outbox.peek()[1].room, '205', '128: FIFO — другий запис');

  const duplicate = outbox.enqueue({ room: '314А', power: 2.7, time: at(-120000) });
  eq(duplicate.accepted, false, '129: дублікат не додано');
  eq(duplicate.status, 200, '130: дублікат повертає 200, не помилку');
  eq(duplicate.reason, 'duplicate', '131: причина — duplicate');
  eq(outbox.size(), 2, '132: розмір черги не змінився');

  const tooOld = outbox.enqueue({ room: '314А', power: 2, time: at(-(MAX_AGE_MS + 1000)) });
  eq(tooOld.status, 400, '133: запис старше 7 діб → 400');
  const future = outbox.enqueue({ room: '314А', power: 2, time: at(FUTURE_TOLERANCE_MS + 1000) });
  eq(future.status, 400, '134: майбутнє > 5 хв → 400');

  const reloaded = createOutbox({ store, send, now: () => NOW });
  eq(reloaded.size(), 2, '135: черга збережена в data.json');

  const firstFlush = await outbox.flush();
  eq(firstFlush.retried, 1, '136: 401 → один повтор');
  eq(firstFlush.delivered, 2, '137: після повтору обидва записи доставлено');
  eq(outbox.size(), 0, '138: черга порожня після flush');
  eq(attempts, 3, '139: 3 спроби (1 тимчасова помилка + 2 успіхи)');

  const secondFlush = await outbox.flush();
  eq(secondFlush.delivered, 0, '140: повторний flush нічого не доставляє');
  eq(outbox.size(), 0, '141: черга залишається порожньою');

  const duplicateAfterFlush = outbox.enqueue({ room: '205', power: 3.51, time: at(-60000) });
  eq(duplicateAfterFlush.status, 200, '142: ідемпотентність за (room, time) після збереження');

  const bad = createOutbox({
    store,
    now: () => NOW,
    send: async () => { const err = new Error('Bad request'); err.code = 400; throw err; },
  });
  bad.enqueue({ room: '101Б', power: 2.1, time: at(-30000) });
  const permanent = await bad.flush();
  eq(permanent.permanent, 1, '143: 400 — остаточна помилка, запис скинуто');
  eq(bad.size(), 0, '144: черга очищена після 400');

  const exhausted = createOutbox({
    store, now: () => NOW,
    send: async () => { const err = new Error('Unauthorized'); err.code = 401; throw err; },
  });
  exhausted.enqueue({ room: '314А', power: 2.2, time: at(-15000) });
  const givesUp = await exhausted.flush();
  eq(givesUp.dropped, 1, '145: після 5 спроб запис відкинуто');
  eq(exhausted.size(), 0, '146: черга не росте безкінечно');

  console.log(`\nРЕЗУЛЬТАТ: ${passed} PASS / ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
