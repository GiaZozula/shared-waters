import type {
  NowSceneInput,
  NowVesselRecord,
} from './shared-water/world/data/sceneState.js'

import type {
  MarineFact,
  RestrictionFact,
  WhaleReviewFact,
} from './shared-water/world/facts/types.js'

export interface NowCurrentReads {
  ais: unknown
  whoi: unknown
  navwarn: unknown
  marine: unknown
}

const UNKNOWN_RESTRICTION: RestrictionFact = {
  status: 'unknown',
  effectiveAt: null,
  publishedAt: null,
  speedKnots: null,
  minimumLengthMetres: null,
  exceptionsApply: false,
  cancellationReference: null,
}

function asRecord(
  value: unknown,
): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null
}

function text(
  value: unknown,
): string | null {
  return typeof value === 'string' && value.length > 0
    ? value
    : null
}

function finiteNumber(
  value: unknown,
): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null
}

function unknownRestriction(): RestrictionFact {
  return {
    ...UNKNOWN_RESTRICTION,
  }
}

function mapPosition(
  value: unknown,
): NowVesselRecord | null {
  const row = asRecord(value)
  const latitude = finiteNumber(row?.latitude)
  const longitude = finiteNumber(row?.longitude)
  const id = text(row?.id)

  if (!row || latitude === null || longitude === null || !id) {
    return null
  }

  return {
    id,
    position: {
      lat: latitude,
      lon: longitude,
    },
    name: text(row.shipName),
    speedKnots: finiteNumber(row.speedKnots),
    lastReceivedAt: text(row.receivedAt),
  }
}

function latestReceivedAt(
  vessels: NowVesselRecord[],
): string | null {
  let latest: string | null = null
  let latestMs = Number.NEGATIVE_INFINITY

  for (const vessel of vessels) {
    if (!vessel.lastReceivedAt) continue

    const receivedMs = Date.parse(vessel.lastReceivedAt)

    if (!Number.isFinite(receivedMs) || receivedMs < latestMs) continue

    latestMs = receivedMs
    latest = vessel.lastReceivedAt
  }

  return latest
}

function adaptAis(
  payload: unknown, nowMs: number,
): NowSceneInput['ais'] {
  const connection = asRecord(asRecord(payload)?.connection)
  const connectionStatus = connection?.status
  const status = connectionStatus === 'connecting' || connectionStatus === 'connected' ||
    connectionStatus === 'disconnected' || connectionStatus === 'unconfigured' || connectionStatus === 'unverified'
    ? connectionStatus : 'unavailable'

  if (connection?.status === 'unconfigured') {
    return {
      connection: status,
      state: 'unconfigured',
      lastReceivedAt: null,
      vessels: [],
    }
  }

  const data = asRecord(asRecord(payload)?.data)

  if (status !== 'connected' || data?.status !== 'recent_messages') {
    return {
      connection: status,
      state: 'unknown',
      lastReceivedAt: text(asRecord(data?.lastStored)?.receivedAt),
      vessels: [],
    }
  }

  const positions = Array.isArray(data.positions)
    ? data.positions
    : []
  const vessels: NowVesselRecord[] = []

  for (const row of positions) {
    const vessel = mapPosition(row)

    if (!vessel) continue

    if (vessel.lastReceivedAt && nowMs - Date.parse(vessel.lastReceivedAt) <= (finiteNumber(data?.recentWindowMinutes) ?? 30) * 60_000) vessels.push(vessel)
  }

  return {
    connection: status,
    state: vessels.length ? 'fresh' : 'unknown',
    lastReceivedAt: latestReceivedAt(vessels),
    vessels,
  }
}

function adaptWhoi(
  payload: unknown, nowMs: number,
): WhaleReviewFact {
  const data = asRecord(asRecord(payload)?.data)
  const review = asRecord(data?.latestReview)

  if (data?.status === 'recent_review' || data?.status === 'stale_review') {
    return {
      state: data.status === 'recent_review' && Math.floor((nowMs - Date.parse(String(review?.reviewDate))) / 86400_000) >= 0 && Math.floor((nowMs - Date.parse(String(review?.reviewDate))) / 86400_000) <= 2 ? 'recent' : 'stale',
      reviewDate: text(review?.reviewDate),
      rightWhaleRows: finiteNumber(review?.detectionCount),
    }
  }

  return {
    state: 'missing',
    reviewDate: null,
    rightWhaleRows: null,
  }
}

function limitedNotice(
  status: 'unverified' | 'pending',
  notice: Record<string, unknown>,
): RestrictionFact {
  return {
    status,
    effectiveAt: text(notice.effectiveAt),
    publishedAt: text(notice.publishedAt),
    speedKnots: notice.zoneAState === 'restricted_10_knots' ? 10 : null,
    minimumLengthMetres: notice.appliesTo === 'vessels_over_13_m' ? 13 : null,
    exceptionsApply: false,
    cancellationReference: text(notice.cancels),
  }
}

function adaptNavwarn(
  payload: unknown, nowMs: number,
): RestrictionFact {
  const data = asRecord(asRecord(payload)?.data)
  const notice = asRecord(data?.notice)

  const success = text(asRecord(asRecord(payload)?.fetch)?.lastSuccessAt)
  if ((success && nowMs - Date.parse(success) > 6 * 3600_000 || data?.status === 'unverified' || asRecord(payload)?.refreshUnavailable === true) && notice) {
    return limitedNotice('unverified', notice)
  }

  if (data?.status === 'pending_effective_time' && notice) {
    return limitedNotice('pending', notice)
  }

  if (data?.status !== 'latest_published_notice' || !notice) {
    return unknownRestriction()
  }

  if (notice.zoneAState === 'restricted_10_knots') {
    return {
      status: 'active',
      effectiveAt: text(notice.effectiveAt),
      publishedAt: text(notice.publishedAt),
      speedKnots: 10,
      minimumLengthMetres: notice.appliesTo === 'vessels_over_13_m' ? 13 : null,
      exceptionsApply: false,
      cancellationReference: text(notice.cancels),
    }
  }

  if (notice.zoneAState === 'no_restriction_stated') {
    return {
      status: 'record-shows-none',
      effectiveAt: text(notice.effectiveAt),
      publishedAt: text(notice.publishedAt),
      speedKnots: null,
      minimumLengthMetres: null,
      exceptionsApply: false,
      cancellationReference: text(notice.cancels),
    }
  }

  return unknownRestriction()
}

function currentSpeedMs(
  velocityKmh: number | null,
): number | null {
  if (velocityKmh === null) return null

  // Open-Meteo oceanCurrentVelocityKmh is kilometres per hour; divide by 3.6 for metres per second.
  return velocityKmh / 3.6
}

function adaptWeather(value: unknown) {
  const weather = asRecord(value)
  const code = finiteNumber(weather?.code), validAt = text(weather?.validAt)
  if (code === null || !Number.isInteger(code) || code < 0 || code > 99 || !validAt || !Number.isFinite(Date.parse(validAt))) return null
  const cloud = finiteNumber(weather?.cloudCover), wind = finiteNumber(weather?.windSpeedKmh)
  return { code, validAt, refreshUnavailable: weather?.refreshUnavailable === true, cloudCover: cloud !== null && cloud >= 0 && cloud <= 100 ? cloud : null,
    windSpeedKmh: wind !== null && wind >= 0 && wind <= 500 ? wind : null }
}

function adaptMarine(
  payload: unknown, nowMs: number,
): MarineFact {
  const body = asRecord(payload)
  const data = asRecord(body?.data)
  const observation = asRecord(data?.observation)
  const status = data?.status
  const validAt = text(observation?.validAt)
  const age = validAt ? nowMs - Date.parse(validAt) : Infinity
  const refreshUnavailable = body?.refreshUnavailable === true
  const state = observation && (refreshUnavailable || age > 45 * 60_000 || age < -5 * 60_000) ? 'stale' : status === 'fresh' || status === 'stale' || status === 'missing'
    ? status
    : 'missing'

  return {
    state,
    weather: adaptWeather(refreshUnavailable && asRecord(body?.weather) ? {...asRecord(body?.weather), refreshUnavailable: true} : body?.weather),
    waveHeightMetres: finiteNumber(observation?.waveHeightM),
    seaSurfaceTemperatureC: finiteNumber(observation?.seaSurfaceTemperatureC),
    currentSpeedMs: currentSpeedMs(finiteNumber(observation?.oceanCurrentVelocityKmh)),
    validAt: text(observation?.validAt),
    fetchedAt: text(asRecord(body?.fetch)?.lastSuccessAt),
  }
}

export function adaptNowReads(
  reads: NowCurrentReads, nowMs = Date.now(),
): NowSceneInput {
  return {
    mode: 'now',
    ais: adaptAis(reads.ais, nowMs),
    restriction: {...adaptNavwarn(reads.navwarn, nowMs), refreshUnavailable: asRecord(reads.navwarn)?.refreshUnavailable === true},
    whaleReview: {...adaptWhoi(reads.whoi, nowMs), refreshUnavailable: asRecord(reads.whoi)?.refreshUnavailable === true},
    marine: {...adaptMarine(reads.marine, nowMs), refreshUnavailable: asRecord(reads.marine)?.refreshUnavailable === true},
  }
}
