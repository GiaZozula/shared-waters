import * as THREE from 'three'

import {
  getOceanHeight,
} from '../oceanHeight'

import type {
  Detection,
} from './createDetection'

import type {
  ArtAtmosphereState,
} from '../weather/sampleArtAtmosphere'

import {
  detectionIsRevealed,
} from './detectionReveal'

export function updateDetections(
  detections:
    Detection[],

  ambientTime:
    number,

  atmosphere:
    ArtAtmosphereState,

  selectedTimeMs?:
    number,
) {
  for (
    const detection
    of detections
  ) {
    const {
      sceneX,
      sceneZ,
    } =
      detection
        .sceneBinding

    detection.root.position.set(
      sceneX,

      getOceanHeight(
        sceneX,
        sceneZ,
        ambientTime,
        atmosphere,
      ) +
        0.04,

      sceneZ,
    )

    const revealed =
      detectionIsRevealed(
        selectedTimeMs,
        detection
          .sceneBinding
          .sourceLocalTime,
        detection
          .sceneBinding
          .reviewDate,
      )

    detection.root.visible =
      revealed

    if (!revealed) {
      detection.revealStartedAt = null
      detection.pulse.visible = false
      detection.spectralField.visible = false
      detection.pulse.material.uniforms.uIntensity.value = 0
      continue
    }

    detection.revealStartedAt ??= ambientTime
    // A looping visual motif for reviewed records, with a fully faded pause.
    // This clock is ambient animation time, never a new acoustic event.
    const reduced = detection.motionPreference.matches
    const progress = reduced
      ? 1
      : Math.min(1, ((ambientTime - detection.revealStartedAt) % 8.4) / 5.4)
    const attention = detection.selected ? 1 : detection.hovered ? 0.85 : 0.65
    const animating = progress < 1 && !reduced
    detection.pulse.visible = animating
    detection.spectralField.visible = animating

    for (const material of [detection.pulse.material, detection.spectralField.material]) {
      material.uniforms.uProgress.value = progress
      material.uniforms.uIntensity.value = animating ? attention : 0
      material.uniforms.uTime.value = ambientTime
      material.uniforms.uWind.value.set(atmosphere.windX, atmosphere.windZ)
      material.uniforms.uWaterEnergy.value = atmosphere.waterEnergy
    }

    const material =
      detection.platform
        .material as
        THREE.MeshStandardMaterial

    material.emissiveIntensity =
      0.35 +
      attention *
        0.9
  }
}
