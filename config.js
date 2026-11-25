'use strict';
require('dotenv').config();
const path = require('path');

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  ADMIN_ID: Number(process.env.ADMIN_ID || 0),
  DATA_FILE: path.join(__dirname, 'data', 'data.json'),
  IMPORT_FILE: path.join(__dirname, 'import', 'readings.csv'),
  INGEST_KEY: process.env.INGEST_KEY || '',
  INGEST_PORT: Number(process.env.INGEST_PORT || 3789),
  DASHBOARD_TOKEN: process.env.DASHBOARD_TOKEN || '',
  TIMEZONE: 'Europe/Kiev',
  ROOMS: ['314А', '205', '101Б'],
  TOPICS: ['report', 'alert', 'news'],
  LIMITS: {
    WARN_FROM: 2.5,
    OVERLOAD_ABOVE: 3.5,
    MAX_POWER: 10,
    MAX_ROWS: 500,
    REPORT_LIMIT: 10,
  },
};
