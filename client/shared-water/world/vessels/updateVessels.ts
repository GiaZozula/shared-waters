import * as THREE from 'three'

import type {
  Vessel,
} from './createVessel'

import {
  getOceanHeight,
} from '../oceanHeight'

import type {
  ArtAtmosphereState,
} from '../weather/sampleArtAtmosphere'

import {
  updateVesselWake,
  vesselHeadingYaw,
} from './createVesselWakes'

export function updateVessels(
  vessels: Vessel[],

  ambientTime: number,

  atmosphere:
    ArtAtmosphereState,
) {
  for (
    const vessel of vessels
  ) {
    const {
      id,
      sceneX,
      sceneZ,
      towardX,
      towardZ,
    } =
      vessel.sceneBinding

    vessel.root.position.set(
      sceneX,

      getOceanHeight(
        sceneX,
        sceneZ,
        ambientTime,
        atmosphere,
      ),

      sceneZ,
    )

    /*
     * Purely presentational.
     *
     * Does not change the factual
     * geographic anchor.
     */
    const phase =
      vessel.phase *
      4.7

    vessel.visualRoot.position.y =
      Math.sin(
        ambientTime *
          0.72 +
        phase,
      ) *
      0.025

    vessel.visualRoot.position.x =
      Math.sin(
        ambientTime *
          0.43 +
        phase *
          1.3,
      ) *
      0.018

    vessel.visualRoot.rotation.y =
      vesselHeadingYaw(
        id,
        sceneX,
        sceneZ,
        towardX,
        towardZ,
      )

    vessel.visualRoot.rotation.x =
      Math.sin(
        ambientTime *
          0.56 +
        phase,
      ) *
      0.018

    vessel.visualRoot.rotation.z =
      Math.sin(
        ambientTime *
          0.38 +
        phase *
          0.8,
      ) *
      0.035

    const pulse =
      Math.sin(
        ambientTime *
          1.15 +
        vessel.phase * 4,
      ) *
        0.5 +
      0.5

    let interactionBoost = 1

    if (
      vessel.hovered
    ) {
      interactionBoost =
        1.58
    }

    if (
      vessel.selected
    ) {
      interactionBoost =
        1.78
    }

    vessel.signalIntensity =
      (
        0.78 +
        pulse * 0.34
      ) *
      (
        vessel.selected
          ? 1.15
          : vessel.hovered
            ? 1.08
            : 1
      )

    const coreMaterial =
      vessel.core
        .material as
        THREE.MeshStandardMaterial

    coreMaterial
      .emissiveIntensity =
      (
        5.6 +
        pulse * 2.2
      ) *
      interactionBoost

    const noseMaterial =
      vessel.nose
        .material as
        THREE.MeshStandardMaterial

    noseMaterial
      .emissiveIntensity =
      (
        7 +
        pulse * 2.5
      ) *
      interactionBoost

    vessel.light.intensity =
      (
        0.55 +
        pulse * 0.45
      ) *
      interactionBoost

    vessel.beam.material
      .uniforms
      .uIntensity
      .value =
      (
        0.72 +
        pulse * 0.3
      ) *
      (
        vessel.selected
          ? 1.20
          : vessel.hovered
            ? 1.10
            : 1
      )

    updateVesselWake(
      vessel,
    )
  }
}
