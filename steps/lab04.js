'use strict';
// ЛАБ 4 — монолітний зріз: команди + кнопкове меню. Запуск: node steps/lab04.js
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN || '');
const keyboard = Markup.keyboard([['Статус', 'Ввести'], ['Звіт', 'Довідка']]).resize();

bot.start((ctx) => ctx.reply('DormPower Bot ⚡. Виберіть кнопку або введіть команду.', keyboard));

bot.help((ctx) => ctx.reply('/start, /help, /status. Кнопки дублюють команди.', keyboard));

bot.command('status', (ctx) => ctx.reply('Кімната 314А: статус з\'явиться у Л6.', keyboard));
bot.command('report', (ctx) => ctx.reply('Звіт з\'явиться у Л13.', keyboard));

bot.hears('Статус', (ctx) => ctx.reply('Кімната 314А: статус з\'явиться у Л6.', keyboard));
bot.hears('Ввести', (ctx) => ctx.reply('Введення показників з\'явиться у Л5.', keyboard));
bot.hears('Звіт', (ctx) => ctx.reply('Звіт з\'явиться у Л13.', keyboard));
bot.hears('Довідка', (ctx) => ctx.reply('/start, /help, /status.', keyboard));

bot.on('text', (ctx) => ctx.reply(`Отримав: ${ctx.message.text}`, keyboard));

bot.catch((err) => console.error('[lab04]', err));
bot.launch();
