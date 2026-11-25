'use strict';
// ЛАБ 6 — монолітний зріз: порогова логіка. Запуск: node steps/lab06.js
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN || '');
const keyboard = Markup.keyboard([['Статус', 'Ввести'], ['Звіт', 'Довідка']]).resize();
const userStates = new Map();

function parseNumber(raw) {
  const s = String(raw).trim().replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n) || s === '') throw new Error('Некоректне число');
  return n;
}

// Пороги: < 2.5 ok, 2.5–3.5 warn, > 3.5 overload.
function classifyPower(rawPower, room, source) {
  const power = parseNumber(rawPower);
  if (!(power > 0 && power <= 10)) throw new Error('Потужність поза межами 0 < power ≤ 10 кВт');
  const priority = power > 3.5 || source === 'http';
  if (power > 3.5) {
    return `🚨 Кімната ${room}: ${power} кВт — ПЕРЕВАНТАЖЕННЯ. Ризик вибивання автомата!`;
  }
  if (power >= 2.5 && power <= 3.5) {
    return `⚠️ Кімната ${room}: ${power} кВт — попередження.${priority ? ' Пріоритетний алерт.' : ''}`;
  }
  return `✅ Кімната ${room}: ${power} кВт — норма.`;
}

function check(ctx) {
  try {
    const parts = ctx.message.text.trim().split(/\s+/);
    const room = (parts[1] || '314А').toUpperCase();
    return ctx.reply(classifyPower(parts[2] || '2.7', room, 'manual'), keyboard);
  } catch (err) {
    return ctx.reply(`Помилка вводу: ${err.message}`);
  }
}

bot.start((ctx) => ctx.reply('DormPower Bot ⚡ /check 2.7 [кімната].', keyboard));
bot.help((ctx) => ctx.reply('/check <кВт> [кімната], /status — alias /check.', keyboard));
bot.command(['status', 'check'], check);
bot.hears('Статус', check);
bot.hears('Ввести', (ctx) => {
  userStates.set(ctx.from.id, { step: 'room' });
  return ctx.reply('Введіть номер кімнати.');
});
bot.hears('Звіт', (ctx) => ctx.reply('Звіт з\'явиться у Л13.', keyboard));
bot.hears('Довідка', (ctx) => ctx.reply('/check <кВт> [кімната].', keyboard));

bot.on('text', (ctx) => {
  const state = userStates.get(ctx.from.id);
  if (!state) return undefined;
  const text = ctx.message.text.trim();
  if (state.step === 'room') {
    state.room = text.toUpperCase();
    state.step = 'power';
    return ctx.reply('Введіть потужність у кВт.');
  }
  if (state.step === 'power') {
    try {
      const message = classifyPower(text, state.room, 'manual');
      userStates.delete(ctx.from.id);
      return ctx.reply(message, keyboard);
    } catch (err) {
      return ctx.reply(`Помилка вводу: ${err.message}`);
    }
  }
  return undefined;
});

bot.catch((err) => console.error('[lab06]', err));
bot.launch();
