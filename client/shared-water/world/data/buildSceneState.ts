import {
  geoToWorld,
} from '../geo/zoneProjection'

import type {
  NowSceneInput,
  NowSceneState,
  SceneDetectionMark,
  SceneState,
  SceneVesselMark,
  StorySceneInput,
  StorySceneState,
} from './sceneState'

function unknownFleetNote(
  coverage:
    | 'ready'
    | 'empty-hour'
    | 'not-imported'
    | 'incomplete'
    | 'unavailable'
    | undefined,
) {
  if (
    coverage ===
    'not-imported'
  ) {
    return 'GFW historical snapshot has not been imported. Vessel-hour counts are unavailable.'
  }

  if (
    coverage ===
    'incomplete'
  ) {
    return 'GFW replay has fewer or more than the 358 checked rows for these seven days. Treat displayed counts as incomplete.'
  }

  if (
    coverage ===
    'unavailable'
  ) {
    return 'vessel-hour counts are unavailable'
  }

  return 'an empty hour does not prove zero vessel traffic'
}

function formatUtcHour(
  timestampMs: number,
) {
  return (
    new Date(timestampMs)
      .toISOString()
      .slice(
        0,
        13,
      ) +
    ':00Z'
  )
}

function buildStoryState(
  input:
    StorySceneInput,
): StorySceneState {
  const vessels:
    SceneVesselMark[] =
    input.vessels.map(
      vessel => {
        const world =
          geoToWorld(
            vessel.position.lat,
            vessel.position.lon,
          )

        return {
          id: vessel.id,

          source: 'gfw',

          worldX: world.x,
          worldZ: world.z,

          name:
            vessel.name,

          speedKnots: null,

          speedBandLabel:
            vessel.speedBandLabel,

          vesselType:
            vessel.vesselType,

          headingDegrees: null,
        }
      },
    )

  const throughTenKnots =
    input.vessels.filter(
      vessel =>
        vessel.speedCategory ===
        'through-10',
    ).length

  const tenAndAbove =
    input.vessels.filter(
      vessel =>
        vessel.speedCategory ===
        '10-plus',
    ).length

  const detections:
    SceneDetectionMark[] =
    input.detections.map(
      detection => {
        const world =
          geoToWorld(
            detection
              .gliderPosition
              .lat,

            detection
              .gliderPosition
              .lon,
          )

        return {
          id:
            detection.id,

          worldX:
            world.x,

          worldZ:
            world.z,

          sourceLocalTime:
            detection
              .sourceLocalTime,

          reviewDate:
            detection
              .reviewDate ??
            '',

          sourceLabel:
            detection
              .sourceLabel,

          limitation:
            detection
              .limitation,
        }
      },
    )

  return {
    mode: 'story',

    selectedTimeMs:
      input.selectedTimeMs,

    rangeStartMs:
      input.rangeStartMs,

    rangeEndMs:
      input.rangeEndMs,

    vessels,

    detections,

    restriction:
      input.restriction,

    fleet: {
      state:
        input.fleetCoverage ===
          'not-imported' ||
        input.fleetCoverage ===
          'incomplete' ||
        input.fleetCoverage ===
          'unavailable' ||
        input.fleetCoverage ===
          'empty-hour' ||
        vessels.length === 0
          ? 'unknown'
          : 'available',

      note:
        input.fleetCoverage ===
          'not-imported' ||
        input.fleetCoverage ===
          'incomplete' ||
        input.fleetCoverage ===
          'unavailable' ||
        input.fleetCoverage ===
          'empty-hour' ||
        vessels.length === 0
          ? unknownFleetNote(
              input.fleetCoverage,
            )
          : null,

      throughTenKnots,

      tenAndAbove,

      total:
        vessels.length,

      selectedHour:
        formatUtcHour(
          input.selectedTimeMs,
        ),

      coverage:
        input.fleetCoverage ??
        (
          vessels.length === 0
            ? 'empty-hour'
            : 'ready'
        ),
    },

    marine:
      input.marine,
  }
}

function buildNowState(
  input:
    NowSceneInput,
): NowSceneState {
  // Only current, connected AIS records become marks. Do not invent tracks.
  const vessels: SceneVesselMark[] = input.ais.state === 'fresh'
    ? input.ais.vessels.map(vessel => {
        const world = geoToWorld(vessel.position.lat, vessel.position.lon)
        return {
          id: vessel.id,
          source: 'ais',
          lastReceivedAt: vessel.lastReceivedAt,
          worldX: world.x,
          worldZ: world.z,
          name: vessel.name,
          speedKnots: vessel.speedKnots,
          speedBandLabel: null,
          vesselType: null,
          headingDegrees: null,
        }
      })
    : []

  return {
    mode: 'now',

    vessels,

    restriction:
      input.restriction,

    ais: {
      connection: input.ais.connection,
      state:
        input.ais.state,

      /*
       * A count exists only
       * for a fresh window.
       */
      vesselCount:
        input.ais.state ===
        'fresh'
          ? vessels.length
          : null,

      lastReceivedAt:
        input.ais
          .lastReceivedAt,
    },

    whaleReview:
      input.whaleReview,

    marine:
      input.marine,
  }
}

export function buildSceneState(
  input:
    StorySceneInput |
    NowSceneInput,
): SceneState {
  return input.mode ===
    'story'
    ? buildStoryState(
        input,
      )
    : buildNowState(
        input,
      )
}
