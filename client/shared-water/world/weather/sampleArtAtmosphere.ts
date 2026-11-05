import { freshWeather, weatherKind, type LiveWeather } from '../../../../shared/live-weather.js'
import type {
  SceneTimeMode,
} from '../time/createSceneClock'

export interface ArtAtmosphereState {
  lightningAllowed?: boolean

  cloudCover: number

  rain: number

  windStrength: number

  windX: number
  windZ: number

  haze: number

  waterEnergy: number
}

export interface ArtAtmosphereSample {
  weather?: LiveWeather | null
  nowMs?: number
  waveHeightMetres?: number | null
  mode: SceneTimeMode

  storyTimeMs: number

  ambientTime: number
}

/*
 * Story uses cinematic presets; Live uses broad current model conditions.
 *
 * Never presented as measured
 * historical weather, and never
 * treated as a historical weather reconstruction.
 */

const FAIR: ArtAtmosphereState = {
  cloudCover:
    0.36,

  rain:
    0.03,

  windStrength:
    0.26,

  windX:
    -0.52,

  windZ:
    -0.24,

  haze:
    0.16,

  waterEnergy:
    0.28,
}

const PASSING_RAIN: ArtAtmosphereState = {
  cloudCover:
    0.62,

  rain:
    0.24,

  windStrength:
    0.48,

  windX:
    -0.68,

  windZ:
    -0.34,

  haze:
    0.34,

  waterEnergy:
    0.48,
}

const NIGHT_STORM: ArtAtmosphereState = {
  cloudCover:
    0.96,

  rain:
    0.90,

  windStrength:
    0.84,

  windX:
    -0.88,

  windZ:
    -0.50,

  haze:
    0.58,

  waterEnergy:
    0.76,
}

/*
 * Milder daytime beat.
 * 13 Sep 2026, 14:00–20:00 UTC.
 */
const PASSING_RAIN_START =
  Date.parse(
    '2026-09-13T14:00:00Z',
  )

const PASSING_RAIN_END =
  Date.parse(
    '2026-09-13T20:00:00Z',
  )

/*
 * Heavy night storm.
 *
 * 14 Sep 2026 23:30 UTC through
 * 15 Sep 2026 08:30 UTC.
 *
 * At 49.358, -64.687 the sun stays
 * below -9° on this stretch, so
 * getSolarState already treats the
 * scene as night.
 */
export const STORY_STORM_PREVIEW_TIME = Date.parse('2026-09-14T03:00:00Z')
const EARLY_STORM_START = Date.parse('2026-09-13T23:30:00Z')
const EARLY_STORM_END = Date.parse('2026-09-14T08:30:00Z')

const NIGHT_STORM_START =
  Date.parse(
    '2026-09-14T23:30:00Z',
  )

const NIGHT_STORM_END =
  Date.parse(
    '2026-09-15T08:30:00Z',
  )

function lerp(
  from: number,
  to: number,
  t: number,
) {
  return (
    from +
    (
      to - from
    ) *
    t
  )
}

function mixAtmosphere(
  from:
    ArtAtmosphereState,

  to:
    ArtAtmosphereState,

  t: number,
): ArtAtmosphereState {
  return {
    cloudCover:
      lerp(
        from.cloudCover,
        to.cloudCover,
        t,
      ),

    rain:
      lerp(
        from.rain,
        to.rain,
        t,
      ),

    windStrength:
      lerp(
        from.windStrength,
        to.windStrength,
        t,
      ),

    windX:
      lerp(
        from.windX,
        to.windX,
        t,
      ),

    windZ:
      lerp(
        from.windZ,
        to.windZ,
        t,
      ),

    haze:
      lerp(
        from.haze,
        to.haze,
        t,
      ),

    waterEnergy:
      lerp(
        from.waterEnergy,
        to.waterEnergy,
        t,
      ),
  }
}

function storyAtmosphere(
  storyTimeMs: number,
): ArtAtmosphereState {
  for (const [start, end] of [[EARLY_STORM_START, EARLY_STORM_END], [NIGHT_STORM_START, NIGHT_STORM_END]]) {
    if (storyTimeMs < start || storyTimeMs >= end) continue
    // Build and settle over half an hour of Story time rather than snapping.
    const ramp = 30 * 60_000
    const t = Math.min(1, (storyTimeMs - start) / ramp, (end - storyTimeMs) / ramp)
    return mixAtmosphere(FAIR, NIGHT_STORM, t * t * (3 - 2 * t))
  }

  if (
    storyTimeMs >=
      PASSING_RAIN_START &&
    storyTimeMs <
      PASSING_RAIN_END
  ) {
    return PASSING_RAIN
  }

  return FAIR
}

export function liveAtmosphere(weather: LiveWeather | null | undefined, nowMs: number, waveHeight?: number | null): ArtAtmosphereState {
  const neutral = { ...FAIR, rain: 0, lightningAllowed: false }
  if (!freshWeather(weather, nowMs)) return neutral
  const kind = weatherKind(weather!.code)
  const preset = kind === 'storm' ? NIGHT_STORM : kind === 'rain' ? PASSING_RAIN : neutral
  return { ...preset,
    // Story's passing shower is too faint for the Live rain condition.
    rain: kind === 'rain' ? 0.65 : preset.rain,
    lightningAllowed: kind === 'storm',
    cloudCover: weather!.cloudCover === null ? (kind === 'overcast' ? 0.72 : preset.cloudCover) : weather!.cloudCover / 100,
    windStrength: weather!.windSpeedKmh === null ? preset.windStrength : Math.min(1, weather!.windSpeedKmh / 65),
    waterEnergy: typeof waveHeight === 'number' && Number.isFinite(waveHeight) && waveHeight >= 0
      ? Math.min(0.9, 0.2 + waveHeight * 0.18) : preset.waterEnergy }
}

// Smooth only a data-driven target change, never cycle through unrelated weather.
export function createLiveAtmosphere() {
  let from: ArtAtmosphereState | null = null, target: ArtAtmosphereState | null = null
  let started = 0, key = ''
  return (next: ArtAtmosphereState, elapsed: number,
    { hasWeather = true, entering = false }: { hasWeather?: boolean; entering?: boolean } = {},
  ): ArtAtmosphereState => {
    // Unavailable data is not a clear-weather reading. The first usable reading,
    // including on re-entry from Story, establishes conditions immediately.
    if (!hasWeather || !target || entering) {
      from = hasWeather ? next : null
      target = hasWeather ? next : null
      key = hasWeather ? JSON.stringify(next) : ''
      started = elapsed
      return next
    }
    const blend = target && from ? mixAtmosphere(from, target, Math.min(1, Math.max(0, (elapsed - started) / 18))) : next
    const nextKey = JSON.stringify(next)
    if (nextKey !== key) { from = blend; target = next; started = elapsed; key = nextKey }
    return { ...blend, lightningAllowed: next.lightningAllowed }
  }
}

export function sampleArtAtmosphere({
  mode,
  storyTimeMs,
  ambientTime,
  weather,
  nowMs = Date.now(),
  waveHeightMetres,
}: ArtAtmosphereSample): ArtAtmosphereState {
  if (
    mode ===
    'live'
  ) {
    return liveAtmosphere(
      weather, nowMs, waveHeightMetres,
    )
  }

  return storyAtmosphere(
    storyTimeMs,
  )
}
