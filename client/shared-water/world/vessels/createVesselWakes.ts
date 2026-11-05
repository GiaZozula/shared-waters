import * as THREE from 'three'

import type {
  Vessel,
} from './createVessel'

import {
  updateFadingLine,
} from './createTrail'

/*
 * Short artistic wake. Longer than the hull, shorter than the
 * forward light beam, and never the distance to a previous hour.
 */
export const WAKE_LENGTH = 1.5

const STEPS = 10

export interface VesselWakeCourse {
  dirX: number
  dirZ: number
  length: number
  bend: number
}

export interface VesselWakeInput {
  id: string
  sceneX: number
  sceneZ: number
  towardX: number | null
  towardZ: number | null
}

function hashId(id: string): number {
  let hash = 2166136261

  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function unit(hash: number, shift: number): number {
  return ((hash >>> shift) % 1000) / 1000
}

/*
 * Per-vessel artistic bend. Some wakes stay almost straight; others
 * sweep more visibly behind the hull.
 */
function wakeBend(
  hash: number,
  sign: number,
  decorative: boolean,
): number {
  const tier = (hash >>> 20) % 5
  const curve = unit(hash, 8)

  if (tier === 0) {
    return sign * (0.04 + curve * 0.08)
  }

  if (tier === 1) {
    return sign * (0.14 + curve * 0.18)
  }

  if (tier === 2 || tier === 3) {
    return sign * (0.28 + curve * 0.34)
  }

  const sweep =
    decorative
      ? 0.46 + curve * 0.62
      : 0.38 + curve * 0.52

  return sign * sweep
}

export function wakeCourse(
  id: string,
  fromX: number,
  fromZ: number,
  towardX: number | null,
  towardZ: number | null,
): VesselWakeCourse {
  const hash = hashId(id)
  const sign = (hash >>> 16) & 1 ? 1 : -1

  if (towardX !== null && towardZ !== null) {
    const dx = towardX - fromX
    const dz = towardZ - fromZ
    const distance = Math.hypot(dx, dz)

    if (distance > 1e-4) {
      return {
        dirX: dx / distance,
        dirZ: dz / distance,
        length: Math.min(WAKE_LENGTH, distance),
        bend: wakeBend(hash, sign, false),
      }
    }
  }

  /*
   * Nose points to local -Z, and the hull has no stored heading.
   * A wake with no previous hour stays behind that nose, with a
   * stable spread and curve so the field is not one repeated line.
   */
  const spread = (unit(hash, 0) - 0.5) * 1.15
  const wide = (hash >>> 4) % 5 === 0 ? 1.8 : 1
  const angle = spread * wide

  return {
    dirX: Math.sin(angle),
    dirZ: Math.cos(angle),
    length: 0.9 + unit(hash, 12) * 0.55,
    bend: wakeBend(hash, sign, true),
  }
}

/*
 * Local hull nose is -Z. The wake leaves along local +Z, so the bow
 * faces the opposite of the wake course in world space.
 */
export function vesselHeadingYaw(
  id: string,
  sceneX: number,
  sceneZ: number,
  towardX: number | null,
  towardZ: number | null,
): number {
  const course =
    wakeCourse(
      id,
      sceneX,
      sceneZ,
      towardX,
      towardZ,
    )

  return Math.atan2(
    -course.dirX,
    course.dirZ,
  )
}

export function updateVesselWake(
  vessel: Vessel,
) {
  const {
    id,
    sceneX,
    sceneZ,
    towardX,
    towardZ,
  } =
    vessel.sceneBinding

  const course =
    wakeCourse(
      id,
      sceneX,
      sceneZ,
      towardX,
      towardZ,
    )

  const points: THREE.Vector3[] = []

  for (let step = 0; step <= STEPS; step++) {
    const fromTip = 1 - step / STEPS
    const along = fromTip * course.length
    const lateral =
      Math.pow(fromTip, 1.45) *
      course.bend *
      course.length

    /*
     * Stern is local +Z. The trail leaves the back of the hull and
     * bends sideways in local X so it stays attached after rotation.
     */
    points.push(
      new THREE.Vector3(
        lateral,
        0.02,
        along,
      ),
    )
  }

  updateFadingLine(
    vessel.wake,
    points,
    0.78,
    1.35,
  )
}
