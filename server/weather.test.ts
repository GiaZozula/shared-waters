import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWeatherCurrent } from './weather.js'
const response = { latitude: 49.36, longitude: -64.69, timezone: 'GMT', utc_offset_seconds: 0,
  current_units: { weather_code: 'wmo code', cloud_cover: '%', wind_speed_10m: 'km/h' },
  current: { time: '2026-11-04T16:00', weather_code: 0, cloud_cover: 0, wind_speed_10m: 0 } }
test('weather parsing preserves zero and null and rejects invalid model input', () => {
  assert.deepEqual(parseWeatherCurrent(response), { code: 0, cloudCover: 0, windSpeedKmh: 0, validAt: '2026-11-04T16:00:00Z' })
  assert.equal(parseWeatherCurrent({ ...response, current: { ...response.current, cloud_cover: null } }).cloudCover, null)
  for (const changed of [{ time: '2026-02-30T16:00' }, { weather_code: null }, { cloud_cover: 101 }, { wind_speed_10m: -1 }]) {
    assert.throws(() => parseWeatherCurrent({ ...response, current: { ...response.current, ...changed } }))
  }
  assert.throws(() => parseWeatherCurrent({ ...response, latitude: 52 }))
  assert.throws(() => parseWeatherCurrent({ ...response, current_units: { ...response.current_units, wind_speed_10m: 'm/s' } }))
})
