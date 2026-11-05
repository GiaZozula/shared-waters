import assert from 'node:assert/strict'
import test from 'node:test'
import { freshWeather, weatherKind, WEATHER_LABELS } from '../shared/live-weather.js'
import { createLiveAtmosphere, liveAtmosphere, sampleArtAtmosphere } from './shared-water/world/weather/sampleArtAtmosphere.js'
import * as THREE from 'three'
import { createRain } from './shared-water/world/weather/createRain.js'
import { adaptNowReads } from './adapt-now-reads.js'
const now = Date.parse('2026-11-04T16:00:00Z')
const weather = (code: number) => ({ code, cloudCover: null, windSpeedKmh: null, validAt: new Date(now).toISOString() })
test('WMO conditions select the four requested symbols without treating snow or unknown as rain', () => {
  for (const [code, kind, symbol] of [[0,'clear','☀︎'], [3,'overcast','☁'], [63,'rain','⛆'], [95,'storm','⛈']] as const) {
    assert.equal(weatherKind(code), kind)
    assert.ok(WEATHER_LABELS[kind].startsWith(symbol))
  }
  assert.equal(weatherKind(71), null)
  assert.equal(weatherKind(999), null)
})
test('freshness and missing data select neutral weather rather than a timed storm', () => {
  assert.equal(freshWeather(weather(0), now), true)
  assert.equal(freshWeather(weather(0), now + 46 * 60_000), false)
  assert.equal(freshWeather(weather(0), now - 6 * 60_000), false)
  for (const value of [null, { ...weather(95), validAt: 'bad' }, weather(71)]) {
    assert.equal(liveAtmosphere(value, now).rain, 0)
    assert.equal(liveAtmosphere(value, now).lightningAllowed, false)
  }
  assert.equal(liveAtmosphere(weather(95), now + 46 * 60_000).rain, 0)
  assert.equal(liveAtmosphere(weather(0), now, 8).rain, 0)
  assert.equal(liveAtmosphere(weather(3), now).rain, 0)
  assert.ok(liveAtmosphere(weather(63), now).rain > 0)
  assert.equal(liveAtmosphere(weather(63), now).lightningAllowed, false)
  assert.equal(liveAtmosphere(weather(95), now).lightningAllowed, true)
})
test('weather transitions blend over 18 seconds and settle without cycling', () => {
  const smooth = createLiveAtmosphere(), clear = liveAtmosphere(weather(0), now), storm = liveAtmosphere(weather(95), now)
  assert.equal(smooth(clear, 0).rain, 0)
  assert.equal(smooth(storm, 10).rain, 0)
  assert.ok(smooth(storm, 19).rain > 0 && smooth(storm, 19).rain < storm.rain)
  assert.equal(smooth(storm, 28).rain, storm.rain)
  assert.equal(smooth(storm, 1000).rain, storm.rain)
  assert.equal(smooth(clear, 1001).lightningAllowed, false)
})
test('Story ignores Live weather; adapter preserves explicit zero and validates weather', () => {
  const sample = { mode: 'story' as const, storyTimeMs: Date.parse('2026-09-14T03:00:00Z'), ambientTime: 0 }
  assert.deepEqual(sampleArtAtmosphere(sample), sampleArtAtmosphere({ ...sample, weather: weather(0) }))
  const reads = { ais: null, whoi: null, navwarn: null, marine: { weather: { ...weather(0), cloudCover: 0, windSpeedKmh: 0 } } }
  assert.equal(adaptNowReads(reads).marine?.weather?.cloudCover, 0)
  assert.equal(adaptNowReads({ ...reads, marine: { weather: { code: '95', validAt: weather(0).validAt } } }).marine?.weather, null)
})

test('Live rain produces clearly stronger streaks than the Story passing shower', () => {
  const field = createRain(), camera = new THREE.PerspectiveCamera()
  const solar = { altitude: 0, azimuth: 0, sunDirection: new THREE.Vector3(0,1,0), dayAmount: 1, nightAmount: 0, twilightAmount: 0, daylightStrength: 1 }
  try {
    const shower = sampleArtAtmosphere({ mode: 'story', storyTimeMs: Date.parse('2026-09-13T16:00:00Z'), ambientTime: 20 })
    const live = liveAtmosphere(weather(63), now)
    field.update(camera, 20, shower, solar)
    const peak = () => Math.max(...Array.from(field.rain.geometry.getAttribute('aAlpha').array))
    const showerPeak = peak(), showerCount = field.rain.geometry.drawRange.count
    field.update(camera, 20, live, solar)
    assert.ok(peak() > showerPeak * 3)
    assert.ok(field.rain.geometry.drawRange.count > showerCount)
    assert.ok(live.rain < liveAtmosphere(weather(95), now).rain)
    assert.equal(live.lightningAllowed, false)
  } finally { field.rain.geometry.dispose(); field.rain.material.dispose() }
})


test('Live entry applies the first available weather immediately, including after loading or revisiting', () => {
  const smooth = createLiveAtmosphere()
  const neutral = liveAtmosphere(null, now), rain = liveAtmosphere(weather(63), now), storm = liveAtmosphere(weather(95), now)
  assert.deepEqual(smooth(neutral, 0, { hasWeather: false, entering: true }), neutral)
  assert.deepEqual(smooth(neutral, 1, { hasWeather: false }), neutral)
  assert.deepEqual(smooth(rain, 2), rain)
  assert.equal(smooth(storm, 3).rain, rain.rain) // A later update still blends.
  assert.deepEqual(smooth(storm, 4, { entering: true }), storm) // Return from Story.
  smooth(neutral, 5, { hasWeather: false })
  assert.deepEqual(smooth(rain, 6), rain) // Recovery also establishes conditions immediately.
})
