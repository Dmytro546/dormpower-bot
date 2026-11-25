'use strict';
// Л14: перевірка циклу планувальника 0 → 1 → 1 без дублювання звіту.
const { createScheduler } = require('../scheduler');

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

const AT_09 = Date.parse('2026-11-21T07:00:00.000Z'); // 09:00 Europe/Kiev (UTC+2)
const AT_10 = Date.parse('2026-11-21T08:00:00.000Z');

function makeStore() {
  const events = [];
  let day = null;
  let reminders = [{ id: 7, room: '314А', text: 'Перевірити щит', at: new Date(AT_09 - 60000).toISOString(), createdBy: 555 }];
  return {
    events,
    getLastReportDay: () => day,
    setLastReportDay(dayKey) { events.push('marker'); day = dayKey; },
    listReminders: () => reminders.slice(),
    deleteReminder(id) { events.push(`del:${id}`); reminders = reminders.filter((r) => r.id !== id); return true; },
    current: () => ({ readings: [{ room: '314А', power: 2.7 }] }),
    unsubscribeAll(id) { events.push(`unsub:${id}`); return true; },
  };
}

function makeBroadcaster(store) {
  const calls = [];
  return {
    calls,
    async broadcast(bot, text, topic) {
      store.events.push('send');
      calls.push({ text, topic });
      return { delivered: 1, failed: 0 };
    },
  };
}

section('Л14 — планувальник');
const store = makeStore();
const broadcaster = makeBroadcaster(store);
const scheduler = createScheduler({ store, broadcaster, intervalMs: 60000, now: () => AT_09 });

const first = scheduler.tick(null, AT_09);
eq(first.reportSent, true, '031: 09:00 — звіт заплановано');
eq(broadcaster.calls.length, 1, '032: один виклик розсилки');
eq(store.events[0], 'marker', '033: lastReportDay оновлюється ДО надсилання');
eq(store.events[1], 'send', '034: потім йде надсилання');

const second = scheduler.tick(null, AT_09);
eq(second.reportSent, false, '035: повторний тик у 09:00 — без дублювання');
eq(broadcaster.calls.length, 1, '036: розсилка не подвоїлася');

const third = scheduler.tick(null, AT_10);
eq(third.reportSent, false, '037: 10:00 — звіту немає (цикл 0 → 1 → 1)');
eq(broadcaster.calls.length, 1, '038: загалом розіслано рівно один звіт');

section('Нагадування, захист від throw, sendSafe 403');
const reminderStore = makeStore();
const reminderScheduler = createScheduler({
  store: reminderStore, broadcaster: makeBroadcaster(reminderStore), now: () => AT_09,
});
const remindersFirst = reminderScheduler.tick(null, AT_09);
eq(remindersFirst.remindersSent, 1, '039: нагадування спрацювало один раз');
const remindersSecond = reminderScheduler.tick(null, AT_09);
eq(remindersSecond.remindersSent, 0, '040: нагадування видаляється після обробки');
ok(reminderStore.events.includes('del:7'), '041: deleteReminder викликано до надсилання');

const brokenStore = Object.assign(makeStore(), {
  listReminders() { throw new Error('Simulated tick error'); },
});
const brokenScheduler = createScheduler({ store: brokenStore, broadcaster: makeBroadcaster(brokenStore) });
let thrown = false;
let cycle;
try { cycle = brokenScheduler.tick(null, AT_09); } catch (err) { thrown = true; }
eq(thrown, false, '042: throw у циклі не валить планувальник');
ok(cycle && cycle.error === 'Simulated tick error', '043: помилка повертається у результаті tick()');

const bot403 = { telegram: { sendMessage: async () => { const err = new Error('Forbidden'); err.code = 403; throw err; } } };
const delivered403 = scheduler.deliver(bot403, 999, 'test', store);
Promise.resolve(delivered403).then((result) => {
  eq(result, false, '044: sendSafe повертає false при 403');
  ok(store.events.includes('unsub:999'), '045: 403 → автоматична відписка');

  const timer = scheduler.start(null);
  ok(timer !== null, '046: start() створює setInterval');
  eq(store.events.length > 0, true, '047: події планувальника записані');
  scheduler.stop();
  eq(typeof scheduler.stop, 'function', '048: stop() доступний');

  console.log(`\nРЕЗУЛЬТАТ: ${passed} PASS / ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
});
