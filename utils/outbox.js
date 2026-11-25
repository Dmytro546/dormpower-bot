'use strict';

const { validateRoom, parsePower } = require('./validators');

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function codeOf(err) {
  return err && (err.code || (err.response && err.response.statusCode));
}

// Л18: FIFO-черга, ретраї, ідемпотентність за (room, time).
function createOutbox({ store, send, now = () => Date.now(), maxAttempts = MAX_ATTEMPTS } = {}) {
  if (!store || typeof store.getOutbox !== 'function' || typeof store.setOutbox !== 'function') {
    throw new Error('outbox потребує store з getOutbox/setOutbox');
  }
  if (typeof send !== 'function') throw new Error('outbox потребує функції send');

  function writeQueue(queue) {
    const sorted = queue.slice().sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    store.setOutbox(sorted);
    return sorted;
  }

  function normalize(input) {
    if (!input || typeof input !== 'object') throw new Error('Немає даних запису');
    const room = validateRoom(input.room);
    const power = parsePower(input.power);
    const rawTime = input.time || input.createdAt || new Date(now()).toISOString();
    const t = Date.parse(rawTime);
    if (!Number.isFinite(t)) throw new Error('Некоректний time');
    return { room, power, time: new Date(t).toISOString() };
  }

  function isDuplicate(item) {
    const inQueue = store.getOutbox().some((q) => q.room === item.room && q.time === item.time);
    const inStore = store.current().readings.some((r) => r.room === item.room && r.createdAt === item.time);
    return inQueue || inStore;
  }

  function enqueue(input) {
    const item = normalize(input);
    const age = now() - Date.parse(item.time);
    if (age > MAX_AGE_MS) return { accepted: false, reason: 'too-old', status: 400 };
    if (age < -FUTURE_TOLERANCE_MS) return { accepted: false, reason: 'future', status: 400 };
    if (isDuplicate(item)) return { accepted: false, reason: 'duplicate', status: 200, item };

    const queue = store.getOutbox();
    queue.push(Object.assign({ attempt: 0 }, item));
    writeQueue(queue);
    return { accepted: true, status: 201, item };
  }

  async function flush() {
    const result = { delivered: 0, retried: 0, dropped: 0, permanent: 0 };
    for (let guard = 0; guard < 1000; guard += 1) {
      const queue = store.getOutbox();
      if (queue.length === 0) break;
      const item = queue.shift();
      const remaining = () => store.getOutbox().filter((q) => !(q.room === item.room && q.time === item.time));
      try {
        await send(item);
        writeQueue(remaining());
        result.delivered += 1;
      } catch (err) {
        const code = codeOf(err);
        if (code === 400) {
          writeQueue(remaining());
          result.dropped += 1;
          result.permanent += 1;
        } else {
          // 401 — тимчасова помилка; мережеві збої теж повторюємо.
          const next = Object.assign({}, item, { attempt: (item.attempt || 0) + 1 });
          if (next.attempt >= maxAttempts) {
            writeQueue(remaining());
            result.dropped += 1;
          } else {
            const retryQueue = remaining();
            retryQueue.push(next);
            writeQueue(retryQueue);
            result.retried += 1;
          }
        }
      }
    }
    return result;
  }

  function size() {
    return store.getOutbox().length;
  }

  function peek() {
    return store.getOutbox().slice();
  }

  return { enqueue, flush, size, peek, normalize, isDuplicate };
}

module.exports = { createOutbox, MAX_AGE_MS, FUTURE_TOLERANCE_MS, MAX_ATTEMPTS };
