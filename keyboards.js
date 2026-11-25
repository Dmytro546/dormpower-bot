'use strict';
const { Markup } = require('telegraf');

// Л4: кнопкове меню дублює команди (/status, /add, /report, /help).
function mainKeyboard() {
  return Markup.keyboard([['Статус', 'Ввести'], ['Звіт', 'Довідка']]).resize();
}

module.exports = { mainKeyboard };
