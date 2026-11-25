'use strict';

const storage = require('./storage');
const { calcStats } = require('./utils/stats');
const { formatStatsReport, kyivHour, kyivDayKey } = require('./utils/format');
const { createBroadcaster } = require('./broadcast');
const { sendSafe } = require('./utils/send');

// Л14: планувальник. marker дати/нагадування оновлюється ДО надсилання.
function createScheduler({
  store = storage,
  broadcaster = createBroadcaster({ store }),
  intervalMs = 60000,
  now = () => Date.now(),
} = {}) {
  let timer = null;

  function deliver(bot, telegramId, text) {
    return sendSafe(bot, telegramId, text, store);
  }

  function tick(bot, atMs = now()) {
    let reportSent = false;
    let remindersSent = 0;
    let error = null;
    try {
      const at = new Date(atMs);
      const day = kyivDayKey(at);
      if (kyivHour(at) === 9 && store.getLastReportDay() !== day) {
        store.setLastReportDay(day); // Маркер ДО надсилання — захист від дублювання.
        const text = `📊 Щоденний звіт DormPower\n${formatStatsReport(calcStats(store.current().readings))}`;
        Promise.resolve(broadcaster.broadcast(bot, text, 'report')).catch((err) => {
          error = err.message;
          console.error('[scheduler report]', err.message);
        });
        reportSent = true;
      }

      store.listReminders()
        .filter((r) => Date.parse(r.at) <= atMs)
        .forEach((reminder) => {
          try {
            store.deleteReminder(reminder.id); // Спочатку видалення, потім надсилання.
            Promise.resolve(deliver(bot, reminder.createdBy, `⏰ Нагадування: ${reminder.text}`))
              .catch((err) => { error = err.message; });
            remindersSent += 1;
          } catch (err) {
            error = err.message;
          }
        });
    } catch (err) {
      error = err.message;
      console.error('[scheduler cycle]', err.message);
    }
    return { reportSent, remindersSent, error };
  }

  function start(bot) {
    if (timer) clearInterval(timer);
    timer = setInterval(() => { tick(bot); }, intervalMs);
    if (timer.unref) timer.unref();
    return timer;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { tick, start, stop, deliver };
}

const defaultScheduler = createScheduler();

module.exports = {
  createScheduler,
  tick: defaultScheduler.tick,
  start: defaultScheduler.start,
  stop: defaultScheduler.stop,
  deliver: defaultScheduler.deliver,
};
