'use strict';
// ЛАБ 7 — монолітний зріз: захищений бот. Запуск: node steps/lab07.js
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN || '');
const keyboard = Markup.keyboard([['Статус', 'Ввести'], ['Звіт', 'Довідка']]).resize();
const userStates = new Map();

function parseNumber(raw) {
  if (raw === null || raw === undefined) throw new Error('Введіть число');
  const s = String(raw).trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^[+-]?\d*\.?\d+$/.test(s)) throw new Error('Некоректне число');
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error('Число має бути скінченним');
  return n;
}

function validateRoom(raw) {
  const room = String(raw === null || raw === undefined ? '' : raw).trim().toUpperCase();
  if (!/^\d{3}[А-ЯЄІЇҐA-Z]?$/.test(room)) throw new Error('Невірна кімната. Приклад: 314А, 205');
  return room;
}

function validatePower(raw) {
  const power = parseNumber(raw);
  if (!(power > 0 && power <= 10)) throw new Error('Потужність має бути 0 < power ≤ 10 кВт');
  return power;
}

function classifyPower(power, room, source = 'manual') {
  const priority = power > 3.5 || source === 'http'; // комбінована умова ||
  if (power > 3.5) return `🚨 Кімната ${room}: ${power} кВт — ПЕРЕВАНТАЖЕННЯ!${priority ? ' Пріоритетний алерт.' : ''}`;
  if (power >= 2.5 && power <= 3.5) return `⚠️ Кімната ${room}: ${power} кВт — попередження.${priority ? ' Пріоритетний алерт.' : ''}`;
  return `✅ Кімната ${room}: ${power} кВт — норма.`;
}

async function safeReply(ctx, text) {
  try {
    await ctx.reply(text, keyboard);
  } catch (err) {
    console.error('[lab07 reply]', err.message);
  }
}

bot.start(async (ctx) => {
  try {
    await safeReply(ctx, 'DormPower Bot ⚡ /check <кВт> [кімната].');
  } catch (err) {
    console.error('[lab07 start]', err.message);
  }
});

bot.command(['status', 'check'], async (ctx) => {
  try {
    const parts = ctx.message.text.trim().split(/\s+/);
    const room = validateRoom(parts[2] || '314А');
    const power = validatePower(parts[1]);
    await safeReply(ctx, classifyPower(power, room));
    return;
  } catch (err) {
    await safeReply(ctx, `Помилка вводу: ${err.message}`);
    return;
  }
});

bot.on('text', async (ctx) => {
  const state = userStates.get(ctx.from.id);
  if (!state) return;
  try {
    if (state.step === 'room') {
      state.room = validateRoom(ctx.message.text);
      state.step = 'power';
      await safeReply(ctx, 'Введіть потужність у кВт.');
      return;
    }
    if (state.step === 'power') {
      const power = validatePower(ctx.message.text);
      userStates.delete(ctx.from.id);
      await safeReply(ctx, classifyPower(power, state.room));
      return;
    }
  } catch (err) {
    await safeReply(ctx, `Помилка: ${err.message}. Спробуйте /cancel.`);
    return;
  }
});

// Л7: глобальний обробник реєструється ДО bot.launch().
bot.catch((err, ctx) => {
  console.error('[lab07 global]', err);
  if (ctx && ctx.reply) ctx.reply('Сталася помилка. Спробуйте ще раз.').catch(() => {});
});

bot.launch();
