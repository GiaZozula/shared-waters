import { freshWeather, weatherKind } from './live-weather.js';

export function describeWeather(value: unknown, nowMs = Date.now()) {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const code = row?.code, validAt = row?.validAt;
  if (typeof code !== 'number' || !Number.isInteger(code) || code < 0 || code > 99 ||
      typeof validAt !== 'string' || !Number.isFinite(Date.parse(validAt))) {
    return { code: null, validAt: null, state: 'missing', sentence: 'No weather-model reading is available.' };
  }
  const kind = weatherKind(code);
  const state = !kind ? 'unsupported' : freshWeather({code, validAt, cloudCover: null, windSpeedKmh: null, refreshUnavailable: row?.refreshUnavailable === true}, nowMs) ? 'fresh' : 'stale';
  return { code, validAt, state,
    sentence: `The separate weather model records ${kind ?? 'conditions without a matching scene preset'} (WMO code ${code}), valid ${validAt}; ${row?.refreshUnavailable ? 'last known; refresh failed; current conditions unverified; ' : ''}${state === 'fresh' ? 'inside its freshness window' : state === 'stale' ? 'outside its freshness window, so not current' : 'no matching scene effect'}.` };
}
