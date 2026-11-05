import * as THREE from 'three'

import {
  createDetection,
  type Detection,
} from './createDetection'

import type {
  SceneDetectionMark,
} from '../data/sceneState'

export function createDetectionField() {
  const group =
    new THREE.Group()

  const byId =
    new Map<
      string,
      Detection
    >()

  function sync(
    records:
      SceneDetectionMark[],
  ) {
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
        detection,
      ] of byId
    ) {
      if (
        nextIds.has(id)
      ) {
        continue
      }

      group.remove(
        detection.root,
      )

      byId.delete(id)
    }

    for (
      const record of records
    ) {
      let detection =
        byId.get(
          record.id,
        )

      if (!detection) {
        detection =
          createDetection()

        byId.set(
          record.id,
          detection,
        )

        group.add(
          detection.root,
        )
      }

      detection.sceneBinding = {
        id:
          record.id,

        sceneX:
          record.worldX,

        sceneZ:
          record.worldZ,

        sourceLocalTime:
          record.sourceLocalTime,

        reviewDate:
          record.reviewDate,

        sourceLabel:
          record.sourceLabel,

        limitation:
          record.limitation,
      }

      detection.ghostMeta =
        `${record.sourceLabel} · ${record.sourceLocalTime}`
    }
  }

  return {
    group,

    sync,

    get detections() {
      return [
        ...byId.values(),
      ]
    },
  }
}
