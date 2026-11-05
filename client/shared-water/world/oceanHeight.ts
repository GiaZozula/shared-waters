interface OceanConditions {
  windX: number
  windZ: number
  waterEnergy: number
}

const CALM: OceanConditions = {
  windX: 1,
  windZ: 0,
  waterEnergy: 0,
}

export function getOceanHeight(
  x: number,
  z: number,
  time: number,
  conditions:
    OceanConditions =
      CALM,
) {
  const localY = -z

  const distance =
    Math.hypot(
      x,
      localY,
    )

  const curvature =
    -Math.pow(
      distance / 82,
      2,
    ) *
    9

  const swellA =
    Math.sin(
      x * 0.075 +
      time * 0.13,
    ) *
    0.24

  const swellB =
    Math.sin(
      localY * 0.052 -
      time * 0.10,
    ) *
    0.18

  const interferenceA =
    Math.sin(
      (x + localY) *
        0.19 +
        time * 0.21,
    ) *
    0.055

  const interferenceB =
    Math.sin(
      (x - localY) *
        0.14 -
        time * 0.16,
    ) *
    0.045

  const windLength =
    Math.hypot(
      conditions.windX,
      conditions.windZ,
    ) ||
    1

  const windX =
    conditions.windX /
    windLength

  const windY =
    -conditions.windZ /
    windLength

  const crossX =
    -windY

  const crossY =
    windX

  const windWave =
    Math.sin(
      (
        x * windX +
        localY * windY
      ) *
        0.24 +
      time *
        (
          0.32 +
          conditions.waterEnergy *
            0.32
        ),
    ) *
    0.14 *
    conditions.waterEnergy

  const crossWave =
    Math.sin(
      (
        x * crossX +
        localY * crossY
      ) *
        0.42 -
      time * 0.34,
    ) *
    0.065 *
    conditions.waterEnergy

  return (
    -2 +
    curvature +
    (1.3 + conditions.waterEnergy * 1.2) * (
      swellA + swellB + interferenceA + interferenceB + windWave + crossWave
    )
  )
}
