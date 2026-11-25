'use strict';
// ЛАБ 5 — монолітний зріз: багатокроковий діалог. Запуск: node steps/lab05.js
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN || '');
const keyboard = Markup.keyboard([['Статус', 'Ввести'], ['Звіт', 'Довідка']]).resize();
const userStates = new Map();
const YES = ['так', 'yes', '1'];

bot.start((ctx) => ctx.reply('DormPower Bot ⚡ /register — реєстрація кімнати.', keyboard));
bot.help((ctx) => ctx.reply('/register, /cancel, /status.', keyboard));

bot.command('register', (ctx) => {
  userStates.set(ctx.from.id, { step: 'room', room: null, power: null });
  return ctx.reply('Введіть номер кімнати (напр. 314А) або /cancel.');
});

bot.command('cancel', (ctx) => {
  userStates.delete(ctx.from.id);
  return ctx.reply('Скасовано.', keyboard);
});

bot.hears('Ввести', (ctx) => {
  userStates.set(ctx.from.id, { step: 'room', room: null, power: null });
  return ctx.reply('Введіть номер кімнати (напр. 314А) або /cancel.');
});

bot.hears('Статус', (ctx) => ctx.reply('Статус з\'явиться у Л6.', keyboard));
bot.hears('Звіт', (ctx) => ctx.reply('Звіт з\'явиться у Л13.', keyboard));
bot.hears('Довідка', (ctx) => ctx.reply('/register, /cancel, /status.', keyboard));

bot.on('text', (ctx) => {
  const state = userStates.get(ctx.from.id);
  if (!state) return undefined;
  const text = ctx.message.text.trim();

  if (state.step === 'room') {
    state.room = text.toUpperCase();
    state.step = 'power';
    return ctx.reply(`Кімната ${state.room}. Введіть потужність у кВт.`);
  }
  if (state.step === 'power') {
    const power = Number(text.replace(',', '.'));
    if (!Number.isFinite(power)) {
      return ctx.reply('Некоректне число. Введіть потужність ще раз.');
    }
    state.power = power;
    state.step = 'confirm';
    return ctx.reply(`${state.room}: ${state.power} кВт. Підтвердьте «так».`);
  }
  if (state.step === 'confirm') {
    if (!YES.includes(text.toLowerCase())) {
      userStates.delete(ctx.from.id);
      return ctx.reply('Скасовано.', keyboard);
    }
    userStates.delete(ctx.from.id); // обов'язкове очищення стану
    return ctx.reply(`Збережено: ${state.room}, ${state.power} кВт.`, keyboard);
  }
  return undefined;
});

bot.catch((err) => console.error('[lab05]', err));
bot.launch();
