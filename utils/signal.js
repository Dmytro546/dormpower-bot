'use strict';

// Л17: симулятор лічильника. LCG + хвиля + шум + аномалії.
const DEFAULTS = {
  seed: 15,
  base: 2.0,
  amplitude: 0.6,
  period: 6,
  noiseAmplitude: 0.4,
  anomalyAt: [8, 17],
  anomalyDelta: [1.4, 2.8],
  rooms: ['314А', '205', '101Б'],
};

function createSignal(options = {}) {
  const cfg = Object.assign({}, DEFAULTS, options);
  let state = cfg.seed >>> 0;

  function rnd() {
    state = (state * 1664525 + 1013904223) >>> 0; // LCG згідно з PROJECT_BIBLE.md
    return state / 4294967296;
  }

  function reset(seed = cfg.seed) {
    state = seed >>> 0;
  }

  function generate(count = 13, startMs = Date.now()) {
    if (!Number.isInteger(count) || count < 1) throw new Error('count має бути цілим додатнім числом');
    const rows = [];
    for (let i = 0; i < count; i += 1) {
      let power = cfg.base + cfg.amplitude * Math.sin(i / cfg.period) + (rnd() - 0.5) * cfg.noiseAmplitude;
      const anomalyIndex = cfg.anomalyAt.indexOf(i);
      if (anomalyIndex >= 0) power += cfg.anomalyDelta[anomalyIndex];
      rows.push({
        room: cfg.rooms[i % cfg.rooms.length],
        power: Math.round(power * 100) / 100,
        createdAt: new Date(startMs + i * 1000).toISOString(),
        source: 'http',
      });
    }
    return rows;
  }

  return { generate, rnd, reset, config: cfg };
}

const defaultSignal = createSignal();

module.exports = { createSignal, generate: defaultSignal.generate, DEFAULTS };
