'use strict';

const storage = require('./storage');
const { sendSafe } = require('./utils/send');

const TOPICS = Object.assign(Object.create(null), { report: true, alert: true, news: true });

function createBroadcaster({ store = storage, pauseMs = 50 } = {}) {
  async function broadcast(bot, text, topic = 'news') {
    const key = String(topic).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(TOPICS, key)) {
      throw new Error('Невідома тема підписки');
    }
    const ids = store.getSubscribers(key);
    let delivered = 0;
    let failed = 0;
    for (const id of ids) {
      const ok = await sendSafe(bot, id, text, store);
      if (ok) delivered += 1;
      else failed += 1;
      if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
    return { delivered, failed };
  }
  return { broadcast };
}

const defaultBroadcaster = createBroadcaster();

module.exports = {
  TOPICS, createBroadcaster, broadcast: defaultBroadcaster.broadcast,
};
