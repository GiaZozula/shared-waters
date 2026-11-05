import {
  frameAt,
  minuteForInstant,
  REPLAY_END,
  REPLAY_START,
  type Notice,
  type Presence,
  type ReplayData,
} from './replay-model.js'

import type {
  AcousticRecord,
  StorySceneInput,
  StorySpeedCategory,
  StoryVesselRecord,
} from './shared-water/world/data/sceneState.js'

import type {
  RestrictionFact,
} from './shared-water/world/facts/types.js'

import {
  occurrenceLabel,
} from './display-labels.js'

export interface StoryReplayWake {
  id: string

  from: {
    lat: number
    lon: number
  }

  toward: {
    lat: number
    lon: number
  }
}

export interface StoryReplayScene {
  input: StorySceneInput

  wakes: StoryReplayWake[]

  mismatches: string[]
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

function unknownRestriction(): RestrictionFact {
  return {
    ...UNKNOWN_RESTRICTION,
  }
}

export function storySceneBeforeReplay(
  selectedTimeMs: number,
): StorySceneInput {
  return {
    mode: 'story',
    selectedTimeMs,
    rangeStartMs: REPLAY_START,
    rangeEndMs: REPLAY_END,
    vessels: [],
    detections: [],
    restriction: unknownRestriction(),
    marine: null,
    fleetCoverage: 'unavailable',
  }
}

function vesselKey(
  value: string | null | undefined,
): string | null {
  return typeof value === 'string' && value.length > 0
    ? value
    : null
}

function previousPosition(
  presence: Presence[],
  vesselId: string,
  hourStart: number,
): { lat: number, lon: number } | null {
  let bestAt = -Infinity
  let best: { lat: number, lon: number } | null = null

  for (const row of presence) {
    if (vesselKey(row.vesselId) !== vesselId) continue

    const eventAt = Date.parse(row.eventAt)

    if (!Number.isFinite(eventAt) || eventAt >= hourStart) continue
    if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) continue
    if (eventAt < bestAt) continue

    bestAt = eventAt
    best = { lat: row.latitude, lon: row.longitude }
  }

  return best
}

function usableShipName(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null

  const collapsed = value.trim().replace(/\s+/g, ' ')

  return collapsed.length > 0 ? collapsed : null
}

function carriedVesselType(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed : null
}

function mapSpeedBand(
  band: string,
  mismatches: string[],
): {
  speedCategory: StorySpeedCategory
  speedBandLabel: string
} | null {
  if (band === 'bands_below_or_up_to_10') {
    return {
      speedCategory: 'through-10',
      speedBandLabel: 'categories through 10 kn',
    }
  }

  if (band === 'bands_from_10_up') {
    return {
      speedCategory: '10-plus',
      speedBandLabel: 'categories from 10 kn upward',
    }
  }

  mismatches.push(`unmapped speedBandGroup: ${band}`)
  return null
}

function mapVessel(
  row: Presence,
  mismatches: string[],
): StoryVesselRecord | null {
  const band = mapSpeedBand(row.speedBandGroup, mismatches)

  if (
    !band ||
    !Number.isFinite(row.latitude) ||
    !Number.isFinite(row.longitude) ||
    typeof row.id !== 'string' ||
    row.id.length === 0
  ) {
    if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) {
      mismatches.push(`presence row ${row.id} has no position`)
    }

    return null
  }

  return {
    id: row.id,
    position: {
      lat: row.latitude,
      lon: row.longitude,
    },
    speedCategory: band.speedCategory,
    speedBandLabel: band.speedBandLabel,
    name: usableShipName(row.shipName),
    vesselType: carriedVesselType(row.vesselType),
  }
}

function fleetCoverageFor(
  status: ReplayData['status'],
  hourRows: number,
  mappedRows: number,
): StorySceneInput['fleetCoverage'] {
  if (status === 'not_imported') return 'not-imported'
  if (status === 'incomplete') return 'incomplete'
  if (status !== 'ready' || mappedRows !== hourRows) return 'unavailable'
  if (hourRows === 0) return 'empty-hour'
  return 'ready'
}

function lengthMetres(
  appliesTo: string,
  mismatches: string[],
): number | null {
  if (appliesTo === 'vessels_over_13_m') return 13
  mismatches.push(`unmapped appliesTo: ${appliesTo}`)
  return null
}

const WHOI_REPLAY_LIMITATION =
  'These timestamps are source-local. Their UTC offset is unresolved, so they are shown as dated evidence and are not positioned at a precise UTC scrub instant. Coordinates locate the glider, not a whale.'

function restrictionFromNotice(
  notice: Notice | null,
  mismatches: string[],
): RestrictionFact {
  if (!notice) return unknownRestriction()

  if (notice.zoneAState === 'no_restriction_stated') {
    return {
      status: 'record-shows-none',
      effectiveAt: notice.effectiveAt,
      publishedAt: notice.publishedAt,
      speedKnots: null,
      minimumLengthMetres: null,
      exceptionsApply: false,
      cancellationReference: notice.cancels,
    }
  }

  if (notice.zoneAState === 'restricted_10_knots') {
    return {
      status: 'active',
      effectiveAt: notice.effectiveAt,
      publishedAt: notice.publishedAt,
      speedKnots: 10,
      minimumLengthMetres: lengthMetres(notice.appliesTo, mismatches),
      exceptionsApply: false,
      cancellationReference: notice.cancels,
    }
  }

  mismatches.push(`unmapped zoneAState: ${notice.zoneAState}`)
  return unknownRestriction()
}

export function adaptStoryReplay(
  data: ReplayData,
  selectedTimeMs: number,
): StoryReplayScene {
  const mismatches: string[] = []

  if (
    !Array.isArray(data.presence) ||
    !Array.isArray(data.notices) ||
    !Array.isArray(data.detections)
  ) {
    return {
      input: storySceneBeforeReplay(selectedTimeMs),
      wakes: [],
      mismatches: ['replay payload is missing presence, notices, or detections'],
    }
  }

  const frame = frameAt(data, minuteForInstant(new Date(selectedTimeMs).toISOString()))
  const vessels: StoryVesselRecord[] = []

  for (const row of frame.presence) {
    const vessel = mapVessel(row, mismatches)

    if (!vessel) continue

    vessels.push(vessel)
  }

  const hourStart = Date.parse(frame.hour)
  const wakes: StoryReplayWake[] = []

  for (const row of frame.presence) {
    const key = vesselKey(row.vesselId)
    const toward = key ? previousPosition(data.presence, key, hourStart) : null

    if (
      !toward ||
      !Number.isFinite(row.latitude) ||
      !Number.isFinite(row.longitude) ||
      (row.latitude === toward.lat && row.longitude === toward.lon)
    ) {
      continue
    }

    wakes.push({
      id: row.id,
      from: {
        lat: row.latitude,
        lon: row.longitude,
      },
      toward,
    })
  }

  const detections: AcousticRecord[] = data.detections.map((row) => ({
    id: row.id,
    gliderPosition: {
      lat: row.platformLatitude,
      lon: row.platformLongitude,
    },
    sourceLocalTime: row.sourceLocalTime,
    reviewDate: row.reviewDate,
    sourceLabel: occurrenceLabel(row.occurrence),
    limitation: WHOI_REPLAY_LIMITATION,
  }))

  return {
    input: {
      mode: 'story',
      selectedTimeMs,
      rangeStartMs: Date.parse(data.start),
      rangeEndMs: Date.parse(data.end),
      vessels,
      detections,
      restriction: restrictionFromNotice(frame.notice, mismatches),
      marine: null,
      fleetCoverage: fleetCoverageFor(data.status, frame.presence.length, vessels.length),
    },
    wakes,
    mismatches,
  }
}
