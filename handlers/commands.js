'use strict';

const fs = require('fs');
const config = require('../config');
const defaultStorage = require('../storage');
const { mainKeyboard } = require('../keyboards');
const validators = require('../utils/validators');
const fmt = require('../utils/format');
const { calcStats, topRooms } = require('../utils/stats');
const { parseCsv } = require('../utils/csv');
const { createBroadcaster, TOPICS } = require('../broadcast');
const { createWeather } = require('../weather');
const { sparkline, renderChart } = require('../utils/chart');

function reply(ctx, text, extra) {
  return ctx.reply(text, extra).catch((err) => console.error('[reply]', err.message));
}

const HELP = [
  'DormPower Bot — довідка:',
  '/start — реєстрація',
  '/register — реєстрація кімнати (wizard)',
  '/add — ввести показання',
  '/status [кімната] — статус (alias /check)',
  '/check [кімната] — порогова оцінка',
  '/me — мій профіль',
  '/data [json] — перевірка parseJson (комендант)',
  '/list — останні 10 записів',
  '/get <id> — один запис',
  '/edit <id> — змінити потужність',
  '/del <id> — видалити (комендант)',
  '/import — CSV-імпорт (комендант)',
  '/time — київський час',
  '/last <год> — за останні години',
  '/day <ДД.ММ.РРРР> — за добу',
  '/report — статистика',
  '/top [N] — топ кімнат (комендант)',
  '/daily — щоденний звіт 09:00 Kyiv (комендант)',
  '/remind <текст> — нагадування (Л14)',
  '/reminders — список нагадувань',
  '/subscribe [report|alert|news] — підписки (Л15)',
  '/id — мій Telegram ID',
  '/broadcast <текст> — розсилка (комендант)',
  '/weather [місто] — вплив холоду на навантаження (Л16)',
  '/compare <a> <b> — порівняння міст',
  '/live — останній потік /ingest (Л17)',
  '/trend — sparkline поточної кімнати',
  '/chart [кімната] — PNG-графік 640×360',
  '/dashboard — захищений дашборд (комендант)',
  '/cancel — скасувати wizard',
].join('\n');

// Фабрика: дозволяє підмінити залежності в тестах, не порушуючи Bulk A API.
function createCommandHandlers(deps = {}) {
  const cfg = deps.config || config;
  const store = deps.store || defaultStorage;
  const broadcaster = deps.broadcaster || createBroadcaster({ store });
  const weather = deps.weather || createWeather();

  function isAdmin(ctx) {
    return Boolean(cfg.ADMIN_ID) && Number(ctx.from.id) === cfg.ADMIN_ID;
  }

  function handleStart(ctx) {
    try {
      store.saveUser({ telegramId: ctx.from.id, role: isAdmin(ctx) ? 'admin' : 'resident' });
      return reply(ctx, 'Вітаємо в DormPower Bot! ⚡\n/register — вказати кімнату, /add — ввести показання.', mainKeyboard());
    } catch (err) {
      return reply(ctx, `Помилка реєстрації: ${err.message}`);
    }
  }

  function handleHelp(ctx) {
    return reply(ctx, HELP);
  }

  function handleCheck(ctx) {
    try {
      const raw = (ctx.message.text || '').trim().split(/\s+/)[1];
      const user = store.findUser(ctx.from.id);
      const room = raw ? validators.validateRoom(raw) : (user && user.room) || cfg.ROOMS[0];
      const rows = store.current().readings.filter((r) => r.room === room);
      if (rows.length === 0) {
        return reply(ctx, `Кімната ${room}: показів ще немає. Використайте /add.`);
      }
      const last = rows[rows.length - 1];
      const verdict = validators.classifyPower(last.power, room, last.source);
      return reply(ctx, `${verdict.message}\nОстанній запис: ${fmt.formatAgo(last.createdAt)}.`);
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleMe(ctx) {
    try {
      const user = store.findUser(ctx.from.id);
      if (!user) return reply(ctx, 'Ви не зареєстровані. Використайте /start.');
      return reply(ctx, `ID: ${user.telegramId}\nРоль: ${user.role}\nКімната: ${user.room || 'не вказано'}`);
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleData(ctx) {
    try {
      if (!isAdmin(ctx)) return reply(ctx, 'Команда доступна лише коменданту.');
      const raw = (ctx.message.text || '').replace(/^\/data\s*/, '').trim();
      const parsed = validators.parseJson(raw || '{"demo":true,"room":"314А"}');
      return reply(ctx, `parseJson OK. Ключі: ${Object.keys(parsed).join(', ') || '(порожньо)'}`);
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleList(ctx) {
    try {
      const rows = store.listReadings(10);
      if (rows.length === 0) return reply(ctx, 'Показів ще немає.');
      const lines = rows.map((r) => `#${r.id} ${r.room}: ${r.power} кВт · ${fmt.formatAgo(r.createdAt)}`);
      return reply(ctx, `Останні ${rows.length} записів:\n${lines.join('\n')}`);
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleGet(ctx) {
    try {
      const id = validators.parseId((ctx.message.text || '').split(/\s+/)[1]);
      const row = store.getReading(id);
      if (!row) return reply(ctx, `Запис #${id} не знайдено.`);
      return reply(ctx, `#${row.id} ${row.room}: ${row.power} кВт\n${fmt.formatKyiv(row.createdAt)} · ${row.source}`);
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleImport(ctx) {
    try {
      if (!isAdmin(ctx)) return reply(ctx, 'Імпорт доступний лише коменданту.');
      const raw = fs.readFileSync(cfg.IMPORT_FILE, 'utf8');
      const { good, errors } = parseCsv(raw);
      if (errors.length > 0) {
        const details = errors.slice(0, 5).map((e) => `рядок ${e.line}: ${e.error}`).join('\n');
        return reply(ctx, `Імпорт скасовано (все або нічого). Помилок: ${errors.length}\n${details}`);
      }
      const inserted = store.addManyReadings(good);
      return reply(ctx, `Імпортовано ${inserted.length} записів з ${cfg.IMPORT_FILE}`);
    } catch (err) {
      return reply(ctx, `Помилка імпорту: ${err.message}`);
    }
  }

  function handleTime(ctx) {
    try {
      return reply(ctx, `Київський час: ${fmt.formatKyiv(new Date())}`);
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleLast(ctx) {
    try {
      const hours = validators.parseHours((ctx.message.text || '').split(/\s+/)[1]);
      const now = Date.now();
      const fromMs = now - hours * 60 * 60 * 1000;
      const rows = store.getReadingsInRange(fromMs, now);
      return reply(ctx, fmt.formatPeriodReport(rows, fromMs, now, now));
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleDay(ctx) {
    try {
      const { fromMs, toMs } = fmt.parseDayRange((ctx.message.text || '').split(/\s+/)[1]);
      const rows = store.getReadingsInRange(fromMs, toMs);
      return reply(ctx, fmt.formatPeriodReport(rows, fromMs, toMs));
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleReport(ctx) {
    try {
      const arg = (ctx.message.text || '').split(/\s+/)[1];
      const rows = arg
        ? store.getReadingsInRange(Date.now() - validators.parseHours(arg) * 3600000, Date.now())
        : store.current().readings;
      return reply(ctx, fmt.formatStatsReport(calcStats(rows)));
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleTop(ctx) {
    try {
      if (!isAdmin(ctx)) return reply(ctx, 'Команда доступна лише коменданту.');
      const raw = (ctx.message.text || '').split(/\s+/)[1];
      const count = raw ? validators.parseCount(raw) : 5;
      const rows = topRooms(store.current().readings, count);
      if (rows.length === 0) return reply(ctx, 'Показів ще немає.');
      return reply(ctx, `Топ кімнат за сумою кВт:\n${rows.map((r, i) => `${i + 1}. ${r.room}: ${r.sum} кВт (${r.count} записів)`).join('\n')}`);
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  // ---- Л14 ----
  function handleDaily(ctx) {
    try {
      if (!isAdmin(ctx)) return reply(ctx, 'Команда доступна лише коменданту.');
      const text = `📊 Щоденний звіт DormPower\n${fmt.formatStatsReport(calcStats(store.current().readings))}`;
      return Promise.resolve(broadcaster.broadcast(ctx.telegram || ctx.bot || null, text, 'report'))
        .then((result) => reply(ctx, `Звіт надіслано: ${result.delivered}, помилок: ${result.failed}.`))
        .catch((err) => reply(ctx, `Помилка: ${err.message}`));
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleReminders(ctx) {
    try {
      const rows = store.listReminders();
      if (rows.length === 0) return reply(ctx, 'Нагадувань немає. Використайте /remind <текст>.');
      const lines = rows.map((r) => `#${r.id} ${fmt.formatKyiv(r.at)} · ${r.room || 'загальне'}: ${r.text}`);
      return reply(ctx, `Нагадування:\n${lines.join('\n')}`);
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  // ---- Л15 ----
  function handleSubscribe(ctx) {
    try {
      const raw = (ctx.message.text || '').trim().split(/\s+/)[1];
      if (!raw) {
        const current = store.getTopics(ctx.from.id);
        return reply(ctx, `Теми: ${Object.keys(TOPICS).join(', ')}.\nВаші підписки: ${current.join(', ') || 'немає'}.\n/subscribe <тема>`);
      }
      const topic = String(raw).toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(TOPICS, topic)) {
        return reply(ctx, `Невідома тема. Доступні: ${Object.keys(TOPICS).join(', ')}.`);
      }
      store.subscribe(ctx.from.id, topic);
      return reply(ctx, `Підписку на «${topic}» додано.`);
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleId(ctx) {
    return reply(ctx, `Ваш Telegram ID: ${ctx.from.id}`);
  }

  function handleBroadcast(ctx) {
    try {
      if (!isAdmin(ctx)) return reply(ctx, 'Розсилка доступна лише коменданту.');
      const text = (ctx.message.text || '').replace(/^\/broadcast\s*/, '').trim();
      if (!text) return reply(ctx, 'Використання: /broadcast <текст>');
      return Promise.resolve(broadcaster.broadcast(ctx.telegram || ctx.bot || null, text, 'news'))
        .then((result) => reply(ctx, `Доставлено: ${result.delivered}, помилок: ${result.failed}.`))
        .catch((err) => reply(ctx, `Помилка: ${err.message}`));
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  // ---- Л16 ----
  function handleWeather(ctx) {
    const city = (ctx.message.text || '').trim().split(/\s+/).slice(1).join(' ') || 'Київ';
    return Promise.resolve(weather.weather(city))
      .then((w) => reply(ctx, `${w.city}: ${w.temperature}°C, вітер ${w.wind} м/с.\n${w.advice}${w.fromCache ? '\n(з кешу)' : ''}`))
      .catch((err) => reply(ctx, `Помилка погоди: ${err.message}`));
  }

  function handleCompare(ctx) {
    const parts = (ctx.message.text || '').trim().split(/\s+/);
    if (!parts[1] || !parts[2]) return reply(ctx, 'Використання: /compare <місто A> <місто B>');
    return Promise.resolve(weather.compare(parts[1], parts[2]))
      .then(({ left, right, delta }) => reply(ctx,
        `${left.city}: ${left.temperature}°C · ${right.city}: ${right.temperature}°C\nРізниця: ${delta}°C`))
      .catch((err) => reply(ctx, `Помилка порівняння: ${err.message}`));
  }

  // ---- Л17–Л19 ----
  function roomOf(ctx) {
    const raw = (ctx.message.text || '').trim().split(/\s+/)[1];
    if (raw) return validators.validateRoom(raw);
    const user = store.findUser(ctx.from.id);
    return (user && user.room) || cfg.ROOMS[0];
  }

  function pointsFor(room) {
    return store.current().readings.filter((r) => r.room === room).map((r) => r.power);
  }

  function handleLive(ctx) {
    try {
      const rows = store.current().readings.filter((r) => r.source === 'http').slice().reverse().slice(0, 10);
      if (rows.length === 0) return reply(ctx, 'Потік /ingest ще не надсилав показів.');
      const lines = rows.map((r) => `${r.room}: ${r.power} кВт · ${fmt.formatKyiv(r.createdAt)}`);
      const queued = deps.outbox ? `\nУ черзі: ${deps.outbox.size()}` : '';
      return reply(ctx, `Останній потік (${rows.length}):\n${lines.join('\n')}${queued}`);
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleTrend(ctx) {
    try {
      const room = roomOf(ctx);
      const points = pointsFor(room);
      if (points.length === 0) return reply(ctx, `Для ${room} немає показів.`);
      return reply(ctx, `${room} ${fmt.formatKyiv(new Date())}:\n${sparkline(points, 24)}\n${points[points.length - 1]} кВт`);
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function handleChart(ctx) {
    try {
      const room = roomOf(ctx);
      const points = pointsFor(room);
      if (points.length === 0) return reply(ctx, `Для ${room} немає показів.`);
      const chart = renderChart({ points, room });
      if (typeof ctx.replyWithPhoto !== 'function') return reply(ctx, `PNG ${chart.width}×${chart.height} згенеровано (${chart.buffer.length} байт).`);
      return ctx.replyWithPhoto({ source: chart.buffer }, { caption: `${room} · ${points.length} точок` })
        .catch((err) => console.error('[chart]', err.message));
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  // ---- Л20 ----
  function handleDashboard(ctx) {
    try {
      if (!isAdmin(ctx)) return reply(ctx, 'Дашборд доступний лише коменданту.');
      const url = deps.dashboard
        ? deps.dashboard.link(cfg.INGEST_PORT)
        : `http://127.0.0.1:${cfg.INGEST_PORT}/dashboard?token=${cfg.DASHBOARD_TOKEN}`;
      return reply(ctx, `Дашборд (не поширюйте посилання): ${url}`);
    } catch (err) {
      return reply(ctx, `Помилка: ${err.message}`);
    }
  }

  function register(bot) {
    bot.command('start', handleStart);
    bot.command('help', handleHelp);
    bot.command(['status', 'check'], handleCheck);
    bot.command('me', handleMe);
    bot.command('data', handleData);
    bot.command('list', handleList);
    bot.command('get', handleGet);
    bot.command('import', handleImport);
    bot.command('time', handleTime);
    bot.command('last', handleLast);
    bot.command('day', handleDay);
    bot.command('report', handleReport);
    bot.command('top', handleTop);
    bot.command('daily', handleDaily);
    bot.command('reminders', handleReminders);
    bot.command('subscribe', handleSubscribe);
    bot.command('id', handleId);
    bot.command('broadcast', handleBroadcast);
    bot.command('weather', handleWeather);
    bot.command('compare', handleCompare);
    bot.command('live', handleLive);
    bot.command('trend', handleTrend);
    bot.command('chart', handleChart);
    bot.command('dashboard', handleDashboard);
    bot.hears(['Статус', 'Ввести', 'Звіт', 'Довідка'], handleButton);
  }

  function handleButton(ctx) {
    const label = (ctx.message.text || '').trim();
    if (label === 'Статус') return handleCheck(ctx);
    if (label === 'Звіт') return handleReport(ctx);
    if (label === 'Довідка') return handleHelp(ctx);
    return reply(ctx, 'Надішліть /add, щоб ввести показання кімнати.');
  }

  return {
    handleStart, handleHelp, handleCheck, handleMe, handleData, handleList,
    handleGet, handleImport, handleTime, handleLast, handleDay, handleReport,
    handleTop, handleDaily, handleReminders, handleSubscribe, handleId,
    handleBroadcast, handleWeather, handleCompare, handleLive, handleTrend,
    handleChart, handleDashboard, handleButton, register, isAdmin,
  };
}

function registerCommands(bot, deps = {}) {
  return createCommandHandlers(deps).register(bot);
}

module.exports = { registerCommands, createCommandHandlers, HELP };
