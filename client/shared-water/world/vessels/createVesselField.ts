import * as THREE from 'three'

import {
  createVessel,
  type Vessel,
} from './createVessel'

import type {
  SceneVesselMark,
} from '../data/sceneState'

import type {
  VesselWakeInput,
} from './createVesselWakes'

function usableShipLabel(
  name: string | null,
) {
  if (
    typeof name !==
    'string'
  ) {
    return 'unknown ship'
  }

  const collapsed =
    name
      .trim()
      .replace(
        /\s+/g,
        ' ',
      )

  return collapsed.length > 0
    ? collapsed
    : 'unknown ship'
}

function storyTypeLine(
  vesselType:
    | string
    | null
    | undefined,
) {
  if (
    typeof vesselType !==
    'string'
  ) {
    return null
  }

  const trimmed =
    vesselType.trim()

  if (
    trimmed.length === 0 ||
    trimmed ===
      'INSUFFICIENT_DATA'
  ) {
    return null
  }

  if (
    trimmed ===
    'OTHER_NON_FISHING'
  ) {
    return 'other vessel'
  }

  if (
    trimmed.includes(
      '_',
    )
  ) {
    return trimmed
      .toLowerCase()
      .replaceAll(
        '_',
        ' ',
      )
  }

  return trimmed
}

function storySpeedLine(
  speedBandLabel:
    string | null,
) {
  if (
    speedBandLabel ===
    'categories through 10 kn'
  ) {
    return 'Recorded speed group: up to 10 knots'
  }

  if (
    speedBandLabel ===
    'categories from 10 kn upward'
  ) {
    return 'Recorded speed group: 10 knots and above'
  }

  return 'the speed was not in the record'
}

export function storyClickText(
  record: {
    name: string | null

    vesselType?:
      string | null

    speedBandLabel:
      string | null
  },
) {
  const lines = [
    usableShipLabel(
      record.name,
    ),
  ]

  const typeLine =
    storyTypeLine(
      record.vesselType,
    )

  if (typeLine) {
    lines.push(
      typeLine,
    )
  }

  return {
    lines,

    meta: storySpeedLine(
      record.speedBandLabel,
    ),
  }
}

export function createVesselField() {
  const group =
    new THREE.Group()

  const byId =
    new Map<
      string,
      Vessel
    >()

  function sync(
    records:
      SceneVesselMark[],

    wakeInputs:
      VesselWakeInput[] =
      [],
  ) {
    const wakeById =
      new Map(
        wakeInputs.map(
          wake => [
            wake.id,
            wake,
          ] as const,
        ),
      )

    const nextIds =
      new Set(
        records.map(
          record =>
            record.id,
        ),
      )

    for (
      const [
        id,
        vessel,
      ] of byId
    ) {
      if (
        nextIds.has(id)
      ) {
        continue
      }

      group.remove(
        vessel.root,
      )

      vessel.wake.geometry.dispose()
      vessel.wake.material.dispose()

      byId.delete(id)
    }

    for (
      const record of records
    ) {
      let vessel =
        byId.get(
          record.id,
        )

      if (!vessel) {
        vessel =
          createVessel()

        byId.set(
          record.id,
          vessel,
        )

        group.add(
          vessel.root,
        )
      }

      const wake =
        wakeById.get(
          record.id,
        )

      vessel.sceneBinding = {
        id:
          record.id,

        sceneX:
          record.worldX,

        sceneZ:
          record.worldZ,

        source:
          record.source,

        towardX:
          wake?.towardX ??
          null,

        towardZ:
          wake?.towardZ ??
          null,
      }

      if (
        record.source ===
        'ais'
      ) {
        vessel.ghostLines = [
          record.name ??
            'vessel',
        ]

        vessel.ghostMeta =
          (record.speedKnots ===
          null
            ? 'reported speed unavailable'
            : `${record.speedKnots.toFixed(1)} kn reported`) +
          (record.lastReceivedAt ? ` · received ${record.lastReceivedAt}` : '')
      } else {
        const click =
          storyClickText(
            record,
          )

        vessel.ghostLines =
          click.lines

        vessel.ghostMeta =
          click.meta
      }
    }
  }

  return {
    group,

    sync,

    get vessels() {
      return [
        ...byId.values(),
      ]
    },
  }
}
