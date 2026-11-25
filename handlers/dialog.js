'use strict';

const config = require('../config');
const defaultStorage = require('../storage');
const state = require('../state');
const fmt = require('../utils/format');
const { validateRoom, parsePower, parseId, classifyPower } = require('../utils/validators');

const YES = ['так', 'yes', 'y', '1', 'підтверджую'];

function reply(ctx, text) {
  return ctx.reply(text).catch((err) => console.error('[reply]', err.message));
}

// Час: ISO 8601 або HH:MM у Києві (сьогодні, якщо вже минув — завтра).
function parseRemindTime(raw, nowMs = Date.now()) {
  const text = String(raw === null || raw === undefined ? '' : raw).trim();
  const iso = Date.parse(text);
  if (Number.isFinite(iso) && /\d{4}-\d{2}-\d{2}/.test(text)) {
    return new Date(iso).toISOString();
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) throw new Error('Час має бути ISO 8601 або HH:MM (Київ)');
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error('Некоректний час');
  const today = fmt.formatKyiv(new Date(nowMs)).split(',')[0].trim();
  let ms = fmt.startOfKyivDay(today) + hours * 3600000 + minutes * 60000;
  if (ms <= nowMs) ms += 24 * 3600000;
  return new Date(ms).toISOString();
}

function isTimeLike(raw) {
  return /^\d{1,2}:\d{2}$/.test(String(raw || '')) || /^\d{4}-\d{2}-\d{2}/.test(String(raw || ''));
}

function createDialogHandlers(deps = {}) {
  const cfg = deps.config || config;
  const store = deps.store || defaultStorage;
  const alerts = deps.alerts || null;

  function begin(ctx, type, extra) {
    state.setState(ctx.from.id, Object.assign({ type, step: 'room', draft: {} }, extra));
    return reply(ctx, 'Введіть номер кімнати (наприклад, 314А) або /cancel.');
  }

  function handleRegister(ctx) {
    try {
      return begin(ctx, 'register');
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleCancel(ctx) {
    state.deleteState(ctx.from.id);
    return reply(ctx, 'Скасовано. Стан діалогу очищено.');
  }

  function handleAdd(ctx) {
    try {
      return begin(ctx, 'add');
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleEdit(ctx) {
    try {
      const raw = (ctx.message.text || '').split(/\s+/)[1];
      if (!raw) return reply(ctx, 'Використання: /edit <id>');
      const id = parseId(raw);
      if (!store.getReading(id)) return reply(ctx, `Запис #${id} не знайдено.`);
      state.setState(ctx.from.id, { type: 'edit', step: 'power', draft: { id } });
      return reply(ctx, `Запис #${id}. Введіть нову потужність у кВт або /cancel.`);
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleDel(ctx) {
    try {
      if (!cfg.ADMIN_ID || Number(ctx.from.id) !== cfg.ADMIN_ID) {
        return reply(ctx, 'Видалення доступне лише коменданту.');
      }
      const raw = (ctx.message.text || '').split(/\s+/)[1];
      if (!raw) return reply(ctx, 'Використання: /del <id>');
      const id = parseId(raw);
      if (!store.getReading(id)) return reply(ctx, `Запис #${id} не знайдено.`);
      state.setState(ctx.from.id, { type: 'del', step: 'confirm_delete', draft: { id } });
      return reply(ctx, `Видалити запис #${id}? Напишіть «так» для підтвердження або /cancel.`);
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  // ---- Л14: /remind ----
  function saveReminder(ctx, text, atRaw) {
    const user = store.findUser(ctx.from.id);
    const reminder = store.addReminder({
      at: parseRemindTime(atRaw),
      text,
      room: user && user.room,
      createdBy: ctx.from.id,
    });
    state.deleteState(ctx.from.id);
    return reply(ctx, `Нагадування #${reminder.id} на ${fmt.formatKyiv(reminder.at)}: ${reminder.text}`);
  }

  function handleRemind(ctx) {
    try {
      const raw = (ctx.message.text || '').replace(/^\/remind\s*/, '').trim();
      const inline = /^(\S+)\s+(.+)$/.exec(raw);
      if (inline && isTimeLike(inline[1])) {
        return saveReminder(ctx, inline[2], inline[1]);
      }
      if (raw) {
        state.setState(ctx.from.id, { type: 'remind', step: 'remindAt', draft: { text: raw } });
        return reply(ctx, 'Введіть час нагадування: HH:MM (Київ) або ISO 8601.');
      }
      state.setState(ctx.from.id, { type: 'remind', step: 'remindText', draft: {} });
      return reply(ctx, 'Введіть текст нагадування.');
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function isYes(text) {
    return YES.includes(String(text).toLowerCase());
  }

  function maybeAlert(ctx, record) {
    if (!alerts || typeof alerts.notifyReading !== 'function') return;
    Promise.resolve(alerts.notifyReading(record, ctx.telegram || null))
      .catch((err) => console.error('[alert]', err.message));
  }

  // Л5: обов'язкові return у кожній гілці; стан зберігається в єдиному Map по ctx.from.id.
  function handleText(ctx) {
    const session = state.getState(ctx.from.id);
    if (!session) return undefined; // кнопки меню обробляються bot.hears у commands.js

    const text = (ctx.message.text || '').trim();
    try {
      if (session.step === 'remindText') {
        session.draft.text = text;
        session.step = 'remindAt';
        return reply(ctx, 'Введіть час нагадування: HH:MM (Київ) або ISO 8601.');
      }
      if (session.step === 'remindAt') {
        return saveReminder(ctx, session.draft.text, text);
      }

      if (session.step === 'room') {
        session.draft.room = validateRoom(text);
        session.step = 'power';
        return reply(ctx, `Кімната ${session.draft.room}. Введіть потужність у кВт або /cancel.`);
      }

      if (session.step === 'power') {
        session.draft.power = parsePower(text);
        session.step = 'confirm';
        return reply(ctx, `Кімната ${session.draft.room}, ${session.draft.power} кВт. Підтвердьте: «так» або /cancel.`);
      }

      if (session.step === 'confirm') {
        if (!isYes(text)) {
          state.deleteState(ctx.from.id);
          return reply(ctx, 'Скасовано.');
        }
        if (session.type === 'register') {
          const role = cfg.ADMIN_ID && Number(ctx.from.id) === cfg.ADMIN_ID ? 'admin' : 'resident';
          const user = store.saveUser({ telegramId: ctx.from.id, role, room: session.draft.room });
          state.deleteState(ctx.from.id);
          return reply(ctx, `Зареєстровано: кімната ${user.room}, роль ${user.role}. Тепер доступний /add.`);
        }
        if (session.type === 'add') {
          const record = store.addReading({
            room: session.draft.room, power: session.draft.power, source: 'manual',
          });
          state.deleteState(ctx.from.id);
          const verdict = classifyPower(record.power, record.room, record.source);
          maybeAlert(ctx, record); // Л15: proactive-алерт після успішного запису
          return reply(ctx, `Записано #${record.id}. ${verdict.message}`);
        }
        if (session.type === 'edit') {
          const record = store.updateReading(session.draft.id, { power: session.draft.power });
          state.deleteState(ctx.from.id);
          return reply(ctx, record ? `Оновлено #${record.id}: ${record.power} кВт.` : 'Запис не знайдено.');
        }
        state.deleteState(ctx.from.id);
        return reply(ctx, 'Невідомий тип wizard. Стан очищено.');
      }

      if (session.step === 'confirm_delete') {
        if (isYes(text)) {
          const removed = store.deleteReading(session.draft.id);
          state.deleteState(ctx.from.id);
          return reply(ctx, removed ? `Запис #${session.draft.id} видалено. lastId не зменшено.` : 'Запис не знайдено.');
        }
        state.deleteState(ctx.from.id);
        return reply(ctx, 'Видалення скасовано.');
      }

      state.deleteState(ctx.from.id);
      return reply(ctx, 'Невідомий крок. Стан очищено.');
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}. Спробуйте ще раз або /cancel.`);
    }
  }

  function register(bot) {
    bot.command('register', handleRegister);
    bot.command('cancel', handleCancel);
    bot.command('add', handleAdd);
    bot.command('edit', handleEdit);
    bot.command('del', handleDel);
    bot.command('remind', handleRemind);
    // Інваріант: bot.on('text') реєструється ОСТАННІМ.
    bot.on('text', handleText);
  }

  return {
    handleRegister, handleCancel, handleAdd, handleEdit, handleDel,
    handleRemind, handleText, register, parseRemindTime,
  };
}

function registerDialog(bot, deps = {}) {
  return createDialogHandlers(deps).register(bot);
}

const defaultDialog = createDialogHandlers();

module.exports = {
  registerDialog, createDialogHandlers,
  handleText: defaultDialog.handleText,
  parseRemindTime,
};
