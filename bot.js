'use strict';
require('dotenv').config();
const { Telegraf } = require('telegraf');
const config = require('./config');
const storage = require('./storage');
const { mainKeyboard } = require('./keyboards');
const { registerCommands } = require('./handlers/commands');
const { registerDialog } = require('./handlers/dialog');
const { createScheduler } = require('./scheduler');
const { createBroadcaster } = require('./broadcast');
const { createAlerts } = require('./alerts');
const { createOutbox } = require('./utils/outbox');
const { createIngest } = require('./ingest');
const { createDashboard } = require('./dashboard');
const { renderChart } = require('./utils/chart');
const { seedChart } = require('./seed_chart');

const bot = new Telegraf(config.BOT_TOKEN);
const broadcaster = createBroadcaster();
const alerts = createAlerts({ broadcaster });
const outbox = createOutbox({ store: storage, send: (item) => Promise.resolve(storage.addReading({ room: item.room, power: item.power, createdAt: item.time, source: 'http' })) });
const scheduler = createScheduler({ broadcaster });
const dashboard = createDashboard({ store: storage, token: config.DASHBOARD_TOKEN, chartProvider: () => renderChart({ points: seedChart() }).buffer });
const ingest = createIngest({ store: storage, alerts, apiKey: config.INGEST_KEY, port: config.INGEST_PORT, outbox, autoFlushMs: 5000, extraHandler: dashboard.handler });

bot.start((ctx) => ctx.reply('DormPower Bot ⚡ /help — довідка.', mainKeyboard()));

registerCommands(bot, { broadcaster, outbox, dashboard });
registerDialog(bot, { alerts });

bot.catch((err, ctx) => { console.error('[DormPower]', err.message); if (ctx && ctx.reply) ctx.reply('Сталася помилка. Спробуйте /cancel.').catch(() => {}); });

scheduler.start(bot); // інваріант: до bot.launch()
ingest.listen().then((addr) => console.log(`Ingest/Dashboard: 127.0.0.1:${addr.port}`)).catch((err) => console.error('[ingest]', err.message));
bot.launch().then(() => console.log('DormPower Bot запущено (long polling)'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
