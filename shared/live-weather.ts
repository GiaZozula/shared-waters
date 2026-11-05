/** Broad visual presets from Open-Meteo WMO codes; never infer rain from waves. */
export type WeatherKind = 'clear' | 'overcast' | 'rain' | 'storm'
export interface LiveWeather {
  refreshUnavailable?: boolean
  code: number
  cloudCover: number | null
  windSpeedKmh: number | null
  validAt: string
}
export const WEATHER_LABELS: Record<WeatherKind, string> = {
  clear: '☀︎ Clear', overcast: '☁ Overcast', rain: '⛆ Rain', storm: '⛈ Storm',
}
export function weatherKind(code: number): WeatherKind | null {
  if ([0, 1].includes(code)) return 'clear'
  if ([2, 3, 45, 48].includes(code)) return 'overcast'
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain'
  if ([95, 96, 99].includes(code)) return 'storm'
  return null // Snow and unsupported codes have no matching effect.
}
export function freshWeather(weather: LiveWeather | null | undefined, nowMs: number): boolean {
  if (!weather || weather.refreshUnavailable || !weatherKind(weather.code)) return false
  const age = nowMs - Date.parse(weather.validAt)
  return Number.isFinite(age) && age >= -5 * 60_000 && age <= 45 * 60_000
}
