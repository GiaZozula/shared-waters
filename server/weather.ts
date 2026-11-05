import { MARINE_POINT } from './marine.js'
import type { LiveWeather } from '../shared/live-weather.js'
export const WEATHER_URL = new URL('https://api.open-meteo.com/v1/forecast')
WEATHER_URL.searchParams.set('latitude', String(MARINE_POINT.latitude))
WEATHER_URL.searchParams.set('longitude', String(MARINE_POINT.longitude))
WEATHER_URL.searchParams.set('current', 'weather_code,cloud_cover,wind_speed_10m')
WEATHER_URL.searchParams.set('timezone', 'GMT')
WEATHER_URL.searchParams.set('wind_speed_unit', 'kmh')
export function parseWeatherCurrent(value: unknown): LiveWeather {
  const raw = value as Record<string, any> | null
  const current = raw?.current, units = raw?.current_units
  if (raw?.timezone !== 'GMT' || raw.utc_offset_seconds !== 0 ||
      units?.weather_code !== 'wmo code' || units.cloud_cover !== '%' || units.wind_speed_10m !== 'km/h' ||
      typeof raw.latitude !== 'number' || !Number.isFinite(raw.latitude) ||
      typeof raw.longitude !== 'number' || !Number.isFinite(raw.longitude) ||
      Math.abs(raw.latitude - MARINE_POINT.latitude) > 0.25 || Math.abs(raw.longitude - MARINE_POINT.longitude) > 0.25 ||
      !current || !Number.isInteger(current.weather_code) || current.weather_code < 0 || current.weather_code > 99 ||
      typeof current.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(current.time)) throw new Error('Invalid weather model response')
  const validAt = `${current.time}:00Z`
  if (!Number.isFinite(Date.parse(validAt)) || new Date(validAt).toISOString().replace('.000Z', 'Z') !== validAt) throw new Error('Invalid weather model time')
  function optionalNumber(value: unknown, max: number): number | null {
    if (value === null) return null
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error('Invalid weather model value')
    return value
  }
  return { code: current.weather_code, validAt, cloudCover: optionalNumber(current.cloud_cover, 100),
    windSpeedKmh: optionalNumber(current.wind_speed_10m, 500) }
}
