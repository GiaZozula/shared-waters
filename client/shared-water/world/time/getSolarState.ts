import * as THREE from 'three'
import * as SunCalc from 'suncalc'

interface SolarStateOptions {
  timestampMs: number

  latitude: number
  longitude: number
}

export interface SolarState {
  altitude: number
  azimuth: number

  sunDirection:
    THREE.Vector3

  dayAmount: number
  nightAmount: number

  /*
   * Narrow band around sunrise / sunset.
   */
  twilightAmount: number

  /*
   * Strongest when sun is relatively high.
   */
  daylightStrength: number
}

function smoothstep(
  value: number,
  min: number,
  max: number,
) {
  const t =
    THREE.MathUtils.clamp(
      (value - min) /
        (max - min),
      0,
      1,
    )

  return (
    t *
    t *
    (3 - 2 * t)
  )
}

export function getSolarState({
  timestampMs,
  latitude,
  longitude,
}: SolarStateOptions): SolarState {
  const date =
    new Date(timestampMs)

  const position =
    SunCalc.getPosition(
      date,
      latitude,
      longitude,
    )

  /*
   * SunCalc 2 returns degrees:
   * altitude 0 at the horizon, 90 at zenith;
   * azimuth clockwise from north.
   */
  const altitudeDegrees =
    position.altitude

  const azimuthDegrees =
    position.azimuth

  const altitude =
    THREE.MathUtils.degToRad(
      altitudeDegrees,
    )

  const azimuth =
    THREE.MathUtils.degToRad(
      azimuthDegrees,
    )

  const dayAmount =
    smoothstep(
      altitudeDegrees,
      -6,
      5,
    )

  const daylightStrength =
    smoothstep(
      altitudeDegrees,
      -1,
      28,
    )

  const nightAmount =
    1 -
    smoothstep(
      altitudeDegrees,
      -9,
      -2,
    )

  /*
   * Peaks around the horizon.
   */
  const twilightAmount =
    (
      1 -
      smoothstep(
        Math.abs(
          altitudeDegrees,
        ),
        1,
        14,
      )
    ) *
    (
      1 -
      nightAmount *
        0.72
    )

  /*
   * Local frame: +X east, +Y up, +Z north.
   * The camera looks toward -Z, so a
   * southern sun sits in front of the view.
   */
  const horizontal =
    Math.cos(
      altitude,
    )

  const sunDirection =
    new THREE.Vector3(
      Math.sin(
        azimuth,
      ) *
        horizontal,

      Math.sin(
        altitude,
      ),

      Math.cos(
        azimuth,
      ) *
        horizontal,
    ).normalize()

  return {
    altitude,
    azimuth,

    sunDirection,

    dayAmount,
    nightAmount,

    twilightAmount,
    daylightStrength,
  }
}
