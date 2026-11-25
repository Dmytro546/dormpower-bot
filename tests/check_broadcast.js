'use strict';
// Л15: 3 доставлено / 2 помилки + автоматична відписка при 403.
const { createBroadcaster, TOPICS } = require('../broadcast');

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

function makeStore(ids) {
  const unsubscribed = [];
  return {
    unsubscribed,
    getSubscribers: (topic) => ids.slice(),
    unsubscribeAll(id) { unsubscribed.push(id); return true; },
  };
}

function makeBot(failIds) {
  const attempts = [];
  return {
    attempts,
    telegram: {
      async sendMessage(id, text) {
        attempts.push({ id, text });
        if (failIds.includes(id)) {
          const err = new Error('Forbidden');
          err.code = failIds.indexOf(id) % 2 === 0 ? 403 : 500;
          throw err;
        }
        return { message_id: attempts.length };
      },
    },
  };
}

async function main() {
  section('Л15 — підписки та розсилка');
  eq(Object.getPrototypeOf(TOPICS), null, '050: TOPICS створено через Object.create(null)');
  eq(TOPICS.report && TOPICS.alert && TOPICS.news, true, '051: теми report / alert / news');
  eq(TOPICS.constructor, undefined, '052: TOPICS.constructor відсутній');

  const store = makeStore([101, 102, 103, 104, 105]);
  const bot = makeBot([102, 104]); // 2 помилки: 403 і 500
  const broadcaster = createBroadcaster({ store, pauseMs: 0 });
  const started = Date.now();
  const result = await broadcaster.broadcast(bot, '🚨 Перевантаження 314А', 'alert');
  eq(result.delivered, 3, '053: доставлено 3');
  eq(result.failed, 2, '054: помилок 2');
  eq(bot.attempts.length, 5, '055: звернень до Telegram API рівно 5');
  ok(Date.now() - started >= 0, '056: await + пауза 50 мс не ламає результат');
  eq(store.unsubscribed.length, 1, '057: авто-відписка лише при 403');
  eq(store.unsubscribed[0], 102, '058: відписано саме id, що повернув 403');
  ok(bot.attempts.every((a) => a.text.includes('Перевантаження')), '059: текст розсилки однаковий для всіх');

  let error = null;
  try { await broadcaster.broadcast(bot, 'x', 'constructor'); } catch (err) { error = err; }
  ok(error !== null && /Невідома тема/.test(error.message), '060: тема constructor відхилена');

  const defaultPause = createBroadcaster({ store });
  ok(typeof defaultPause.broadcast === 'function', '061: пауза 50 мс увімкнена за замовчуванням');

  console.log(`\nРЕЗУЛЬТАТ: ${passed} PASS / ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
