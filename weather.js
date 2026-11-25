'use strict';

const TIMEOUT_MS = 5000;
const TTL_MS = 10 * 60 * 1000;

// Л16: Open-Meteo через вбудований fetch + TTL-кеш. Підміна globalThis.fetch працює.
function createWeather({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  ttlMs = TTL_MS,
} = {}) {
  const cache = new Map();

  async function getJson(url) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response || typeof response.json !== 'function') {
      throw new Error('Некоректна відповідь сервера');
    }
    if (!response.ok) throw new Error(`HTTP ${response.status || 'невідомий'}`);
    return response.json();
  }

  async function weather(city) {
    const name = String(city === null || city === undefined ? '' : city).trim();
    if (!name) throw new Error('Вкажіть місто');

    const key = name.toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) {
      return Object.assign({}, hit.data, { fromCache: true });
    }

    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=uk&format=json`;
    const geo = await getJson(geoUrl);
    if (!geo || !Array.isArray(geo.results) || geo.results.length === 0) {
      throw new Error('Місто не знайдено');
    }
    const place = geo.results[0];
    if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
      throw new Error('Некоректні координати міста');
    }

    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,wind_speed_10m`;
    const forecast = await getJson(forecastUrl);
    if (!forecast || !forecast.current || !Number.isFinite(forecast.current.temperature_2m)) {
      throw new Error('Некоректна структура прогнозу');
    }

    const temperature = forecast.current.temperature_2m;
    const wind = Number.isFinite(forecast.current.wind_speed_10m) ? forecast.current.wind_speed_10m : 0;
    const heatingKw = Math.round(Math.max(0, 18 - temperature) * 0.12 * 100) / 100;
    const data = {
      city: place.name || name,
      temperature,
      wind,
      heatingKw,
      advice: heatingKw > 0
        ? `Холод додає ~${heatingKw} кВт до пікового навантаження обігрівачів`
        : 'Опалення не впливає на пік навантаження',
    };
    cache.set(key, { at: now(), data });
    return Object.assign({}, data, { fromCache: false });
  }

  async function compare(a, b) {
    const left = await weather(a);
    const right = await weather(b);
    return {
      left, right,
      delta: Math.round((left.temperature - right.temperature) * 10) / 10,
    };
  }

  function clearCache() {
    cache.clear();
  }

  return { weather, compare, cache, clearCache };
}

const defaultWeather = createWeather();

module.exports = {
  createWeather,
  weather: defaultWeather.weather,
  compare: defaultWeather.compare,
  clearCache: defaultWeather.clearCache,
};
