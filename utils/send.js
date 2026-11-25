'use strict';

function isForbidden(err) {
  const code = err && (err.code || (err.response && err.response.statusCode));
  return code === 403 || String((err && err.message) || '').includes('403');
}

// Надійне надсилання: .catch + авто-відписка при 403.
async function sendSafe(bot, telegramId, text, store) {
  try {
    const client = bot && bot.telegram ? bot.telegram : bot; // bot або ctx.telegram
    await client.sendMessage(Number(telegramId), text);
    return true;
  } catch (err) {
    if (isForbidden(err) && store && typeof store.unsubscribeAll === 'function') {
      store.unsubscribeAll(Number(telegramId));
    }
    return false;
  }
}

module.exports = { sendSafe, isForbidden };
