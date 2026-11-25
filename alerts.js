'use strict';

const config = require('./config');
const storage = require('./storage');
const { classifyPower } = require('./utils/validators');
const { createBroadcaster } = require('./broadcast');
const { sendSafe } = require('./utils/send');

// Л15: proactive-алерти з дедуплікацією 10 хв на кімнату + доповідь коменданту.
function createAlerts({
  store = storage,
  broadcaster = createBroadcaster({ store }),
  adminId = config.ADMIN_ID,
  dedupMs = 10 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  const lastSent = new Map();

  async function notifyReading(record, bot) {
    if (!record) return { sent: false, reason: 'no-record' };
    const verdict = classifyPower(record.power, record.room, record.source || 'manual');
    if (verdict.level === 'ok') return { sent: false, level: 'ok' };

    const key = `${record.room}:${verdict.level}`;
    const at = now();
    const previous = lastSent.get(key);
    if (previous !== undefined && at - previous < dedupMs) {
      return { sent: false, level: verdict.level, reason: 'dedup' };
    }
    lastSent.set(key, at);

    const text = `⚡ ${verdict.message}`;
    const result = await broadcaster.broadcast(bot, text, 'alert');
    let adminDelivered = false;
    if (adminId) {
      adminDelivered = await sendSafe(bot, adminId, `🛡️ Комендант: ${text}`, store);
    }
    return Object.assign({ sent: true, level: verdict.level, adminDelivered }, result);
  }

  function clearDedup() {
    lastSent.clear();
  }

  return { notifyReading, lastSent, clearDedup };
}

const defaultAlerts = createAlerts();

module.exports = { createAlerts, notifyReading: defaultAlerts.notifyReading };
