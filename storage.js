'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { validateRoom, parsePower, parseId } = require('./utils/validators');

// Захист від TOPICS['constructor'] / '__proto__'.
const TOPICS = Object.assign(Object.create(null), { report: true, alert: true, news: true });

function emptyData() {
  return {
    lastId: 0,
    lastReportDay: null,
    users: [],
    readings: [],
    reminders: [],
    subscriptions: { report: [], alert: [], news: [] },
    outbox: [],
  };
}

// Фабрика: основний екземпляр працює з config.DATA_FILE, тести — з os.tmpdir().
function createStorage(dataFile) {
  const file = dataFile || config.DATA_FILE;
  let data = null;

  function loadData() {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return emptyData();
      throw new Error(`Не вдалося прочитати ${file}: ${err.message}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Пошкоджений JSON у ${file}: ${err.message}. Відновіть резервну копію.`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Некоректна структура даних у ${file}`);
    }

    const result = Object.assign(emptyData(), parsed);
    ['users', 'readings', 'reminders', 'outbox'].forEach((key) => {
      if (!Array.isArray(result[key])) result[key] = [];
    });
    if (!result.subscriptions || typeof result.subscriptions !== 'object') {
      result.subscriptions = emptyData().subscriptions;
    }
    const maxId = Math.max(0, ...[].concat(
      result.users, result.readings, result.reminders,
    ).map((row) => Number(row && row.id) || 0));
    if (!Number.isInteger(result.lastId) || result.lastId < maxId) result.lastId = maxId;
    return result;
  }

  function current() {
    if (!data) data = loadData();
    return data;
  }

  function makeCopy(source) {
    return JSON.parse(JSON.stringify(source === undefined ? current() : source));
  }

  // Атомарний запис: спочатку .tmp, потім renameSync.
  function persist(copy) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(copy, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  function saveChanges(copy) {
    if (!copy || typeof copy !== 'object' || Array.isArray(copy)) {
      throw new Error('saveChanges очікує копію даних-об\'єкт');
    }
    persist(copy);
    data = copy;
    return data;
  }

  function nextId(copy) {
    copy.lastId = (Number(copy.lastId) || 0) + 1;
    return copy.lastId;
  }

  function prepareReading(input, now) {
    if (!input || typeof input !== 'object') throw new Error('Немає даних показника');
    const room = validateRoom(input.room);
    const power = parsePower(input.power);
    const source = input.source || 'manual';
    const rawTime = input.createdAt || now;
    const t = Date.parse(rawTime);
    if (!Number.isFinite(t)) throw new Error('Некоректні createdAt');
    return { room, power, source, createdAt: new Date(t).toISOString() };
  }

  function addReading(input) {
    const prepared = prepareReading(input, new Date().toISOString());
    const copy = makeCopy();
    const record = Object.assign({ id: nextId(copy) }, prepared);
    copy.readings.push(record);
    saveChanges(copy);
    return record;
  }

  function getReading(id) {
    const key = parseId(id);
    return current().readings.find((r) => r.id === key) || null;
  }

  function listReadings(limit = 10) {
    const n = Number(limit) || 10;
    return current().readings.slice().reverse().slice(0, n);
  }

  function updateReading(id, patch) {
    const key = parseId(id);
    if (!patch || typeof patch !== 'object') throw new Error('Немає полів для оновлення');
    const copy = makeCopy();
    const record = copy.readings.find((r) => r.id === key);
    if (!record) return null;
    if (Object.prototype.hasOwnProperty.call(patch, 'room')) record.room = validateRoom(patch.room);
    if (Object.prototype.hasOwnProperty.call(patch, 'power')) record.power = parsePower(patch.power);
    if (Object.prototype.hasOwnProperty.call(patch, 'source')) record.source = patch.source;
    saveChanges(copy);
    return record;
  }

  function deleteReading(id) {
    const key = parseId(id);
    const copy = makeCopy();
    const index = copy.readings.findIndex((r) => r.id === key);
    if (index < 0) return false;
    copy.readings.splice(index, 1);
    saveChanges(copy);
    return true;
  }

  // Л11: «все або нічого» — валідуємо ВСІ рядки до першого запису на диск.
  function addManyReadings(items) {
    if (!Array.isArray(items)) throw new Error('addManyReadings очікує масив');
    if (items.length === 0) return [];
    if (items.length > 500) throw new Error('Імпорт обмежено 500 записами за раз');

    const now = new Date().toISOString();
    const prepared = items.map((item, index) => {
      try {
        return prepareReading(item, now);
      } catch (err) {
        throw new Error(`Рядок ${index + 1}: ${err.message}`);
      }
    });

    const copy = makeCopy();
    const inserted = prepared.map((row) => Object.assign({ id: nextId(copy) }, row));
    copy.readings.push(...inserted);
    saveChanges(copy);
    return inserted;
  }

  function saveUser(input) {
    if (!input) throw new Error('Немає даних користувача');
    const telegramId = Number(input.telegramId);
    if (!Number.isInteger(telegramId) || telegramId <= 0) throw new Error('Некоректний Telegram ID');
    const role = input.role === 'admin' ? 'admin' : 'resident';
    const room = input.room ? validateRoom(input.room) : null;

    const copy = makeCopy();
    let user = copy.users.find((u) => u.telegramId === telegramId);
    if (user) {
      user.role = role;
      if (room) user.room = room;
    } else {
      user = {
        id: nextId(copy), telegramId, role, room,
        registeredAt: new Date().toISOString(),
      };
      copy.users.push(user);
    }
    saveChanges(copy);
    return user;
  }

  function findUser(telegramId) {
    const id = Number(telegramId);
    return current().users.find((u) => u.telegramId === id) || null;
  }

  function getReadingsInRange(fromMs, toMs) {
    return current().readings
      .filter((r) => {
        const t = Date.parse(r.createdAt);
        return Number.isFinite(t) && t >= fromMs && t <= toMs;
      })
      .slice()
      .reverse();
  }

  // ---- Л14: нагадування та маркер дати звіту ----
  function addReminder(input) {
    if (!input || !input.text) throw new Error('Немає тексту нагадування');
    const at = Date.parse(input.at);
    if (!Number.isFinite(at)) throw new Error('Некоректна дата нагадування');
    const room = input.room ? validateRoom(input.room) : null;
    const copy = makeCopy();
    const reminder = {
      id: nextId(copy), room, text: String(input.text).slice(0, 300),
      at: new Date(at).toISOString(), createdBy: Number(input.createdBy) || 0,
    };
    copy.reminders.push(reminder);
    saveChanges(copy);
    return reminder;
  }

  function listReminders() {
    return current().reminders.slice();
  }

  function deleteReminder(id) {
    const key = parseId(id);
    const copy = makeCopy();
    const index = copy.reminders.findIndex((r) => r.id === key);
    if (index < 0) return false;
    copy.reminders.splice(index, 1);
    saveChanges(copy);
    return true;
  }

  function getLastReportDay() {
    return current().lastReportDay || null;
  }

  function setLastReportDay(day) {
    const copy = makeCopy();
    copy.lastReportDay = String(day);
    saveChanges(copy);
    return copy.lastReportDay;
  }

  // ---- Л15: підписки на теми ----
  function subscribe(telegramId, topic) {
    const key = String(topic || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(TOPICS, key)) throw new Error('Невідома тема підписки');
    const id = Number(telegramId);
    const copy = makeCopy();
    if (!copy.subscriptions[key]) copy.subscriptions[key] = [];
    if (!copy.subscriptions[key].includes(id)) copy.subscriptions[key].push(id);
    saveChanges(copy);
    return copy.subscriptions[key].slice();
  }

  function unsubscribe(telegramId, topic) {
    const key = String(topic || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(TOPICS, key)) return false;
    const id = Number(telegramId);
    const copy = makeCopy();
    const list = copy.subscriptions[key] || [];
    const index = list.indexOf(id);
    if (index < 0) return false;
    list.splice(index, 1);
    saveChanges(copy);
    return true;
  }

  function unsubscribeAll(telegramId) {
    const id = Number(telegramId);
    const copy = makeCopy();
    let changed = false;
    Object.keys(copy.subscriptions).forEach((key) => {
      const list = copy.subscriptions[key] || [];
      const index = list.indexOf(id);
      if (index >= 0) {
        list.splice(index, 1);
        changed = true;
      }
    });
    if (changed) saveChanges(copy);
    return changed;
  }

  function getSubscribers(topic) {
    const key = String(topic || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(TOPICS, key)) return [];
    return (current().subscriptions[key] || []).slice();
  }

  function getTopics(telegramId) {
    const id = Number(telegramId);
    return Object.keys(current().subscriptions)
      .filter((key) => (current().subscriptions[key] || []).includes(id))
      .slice();
  }

  // ---- Л18: черга надійного потоку ----
  function getOutbox() {
    return current().outbox.slice();
  }

  function setOutbox(queue) {
    if (!Array.isArray(queue)) throw new Error('setOutbox очікує масив');
    const copy = makeCopy();
    copy.outbox = JSON.parse(JSON.stringify(queue));
    saveChanges(copy);
    return copy.outbox.slice();
  }

  return {
    file, loadData, current, makeCopy, saveChanges,
    addReading, getReading, listReadings, updateReading, deleteReading,
    addManyReadings, saveUser, findUser, getReadingsInRange,
    addReminder, listReminders, deleteReminder, getLastReportDay, setLastReportDay,
    subscribe, unsubscribe, unsubscribeAll, getSubscribers, getTopics,
    getOutbox, setOutbox,
  };
}

const defaultStorage = createStorage(config.DATA_FILE);

module.exports = Object.assign(defaultStorage, { createStorage, emptyData });
