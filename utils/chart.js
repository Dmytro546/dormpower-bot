'use strict';

const { createCanvas, drawLine, drawText, encodePng } = require('./png');

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function toNumbers(points) {
  return (points || []).map((point) => {
    const raw = (point && typeof point === 'object' && point.power !== undefined) ? point.power : point;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  });
}

function downsample(points, maxPoints = 144) {
  const nums = toNumbers(points);
  if (maxPoints < 2 || nums.length <= maxPoints) return nums.slice();
  const last = nums.length - 1;
  const out = [];
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(nums[Math.round((i * last) / (maxPoints - 1))]);
  }
  return out;
}

// Текстовий спарклайн: плаский рядок не ділимо на нуль.
function sparkline(points, width = 16) {
  const nums = downsample(points, width);
  if (nums.length === 0) return '';
  const min = Math.min(...nums);
  const span = Math.max(...nums) - min;
  if (span === 0) return BLOCKS[3].repeat(nums.length);
  return nums.map((n) => {
    const index = Math.min(7, Math.floor(((n - min) / span) * 8));
    return BLOCKS[index];
  }).join('');
}

function renderChart({ points, width = 640, height = 360, room = '314А', title = 'DormPower' } = {}) {
  const values = downsample(points, 144);
  const pixels = createCanvas(width, height, [250, 252, 255, 255]);
  const axisColor = [70, 85, 105, 255];
  const gridColor = [220, 226, 235, 255];
  const lineColor = [37, 99, 235, 255];
  const textColor = [30, 41, 59, 255];
  const padL = 52; const padR = 18; const padT = 28; const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  drawLine(pixels, width, height, padL, padT, padL, height - padB, axisColor);
  drawLine(pixels, width, height, padL, height - padB, width - padR, height - padB, axisColor);
  for (let i = 1; i <= 4; i += 1) {
    const y = padT + Math.round((plotH * i) / 5);
    drawLine(pixels, width, height, padL, y, width - padR, y, gridColor);
  }

  if (values.length > 0) {
    const min = Math.min(...values);
    const span = Math.max(...values) - min;
    // Інверсія осі Y: віднімаємо від висоти. Захист від ділення на нуль для плаского графіка.
    const yOf = (v) => span === 0
      ? height - padB - Math.round(plotH / 2)
      : height - padB - Math.round(((v - min) / span) * plotH);
    const xOf = (i) => padL + (values.length === 1 ? 0 : Math.round((i * plotW) / (values.length - 1)));
    for (let i = 1; i < values.length; i += 1) {
      drawLine(pixels, width, height, xOf(i - 1), yOf(values[i - 1]), xOf(i), yOf(values[i]), lineColor);
    }
  }

  drawText(pixels, width, height, padL, 8, `${title} ${room} KW`, textColor);
  drawText(pixels, width, height, 8, padT, 'KW', textColor);
  drawText(pixels, width, height, width - padR - 20, height - 24, '24H', textColor);

  return { buffer: encodePng(width, height, pixels), width, height, points: values.length };
}

module.exports = { sparkline, downsample, renderChart, toNumbers };
