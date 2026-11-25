'use strict';
// ЛАБ 3 — монолітний зріз: перший бот. Запуск: node steps/lab03.js
require('dotenv').config();
const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN || '');

bot.start((ctx) => ctx.reply('DormPower Bot ⚡ моніторинг енергоспоживання гуртожитку.'));

bot.help((ctx) => ctx.reply('Команди: /start, /help.\nПоказання вводяться у Л5.'));

bot.command('status', (ctx) => ctx.reply('Статус з\'явиться у Л6.'));

bot.on('text', (ctx) => ctx.reply(`Отримав: ${ctx.message.text}. Використайте /help.`));

bot.catch((err) => console.error('[lab03]', err));
bot.launch();
