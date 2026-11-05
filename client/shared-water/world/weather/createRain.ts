import * as THREE from 'three'

import type {
  ArtAtmosphereState,
} from './sampleArtAtmosphere'

import type {
  SolarState,
} from '../time/getSolarState'

// Keep the heaviest storm bounded on lower-end GPUs while retaining visible
// rain at full intensity.
const DROP_COUNT = 1200

interface RainDrop {
  x: number
  z: number

  phase: number
  speed: number

  length: number

  brightness: number
  depth: number
}

const vertexShader = `
  attribute float aAlpha;

  varying float vAlpha;

  void main() {
    vAlpha =
      aAlpha;

    gl_Position =
      projectionMatrix *
      modelViewMatrix *
      vec4(
        position,
        1.0
      );
  }
`

const fragmentShader = `
  uniform vec3 uColor;

  varying float vAlpha;

  void main() {
    gl_FragColor =
      vec4(
        uColor,
        vAlpha
      );
  }
`

export function createRain() {
  const geometry =
    new THREE.BufferGeometry()

  const positions =
    new Float32Array(
      DROP_COUNT * 6,
    )

  const alpha =
    new Float32Array(
      DROP_COUNT * 2,
    )

  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      positions,
      3,
    ),
  )

  geometry.setAttribute(
    'aAlpha',
    new THREE.BufferAttribute(
      alpha,
      1,
    ),
  )

  const dayColor =
    new THREE.Color(
      '#8c9fa5',
    )

  /*
   * Dimmer than the day silver,
   * still light enough to separate
   * from the night sea.
   */
  const nightColor =
    new THREE.Color(
      '#394b54',
    )

  const color =
    new THREE.Color()

  const material =
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,

      uniforms: {
        uColor: {
          value:
            new THREE.Color(
              '#9fb3ba',
            ),
        },
      },

      transparent: true,
      depthWrite: false,
      depthTest: true,

      blending:
        THREE.NormalBlending,
    })

  const rain =
    new THREE.LineSegments(
      geometry,
      material,
    )

  rain.renderOrder = 6
  rain.frustumCulled = false

  const drops:
    RainDrop[] =
    []

  for (
    let i = 0;
    i < DROP_COUNT;
    i++
  ) {
    const depth =
      Math.random()

    drops.push({
      depth,

      /*
       * Wider field in the distance.
       */
      x:
        (
          Math.random() -
          0.5
        ) *
        (
          12 +
          depth * 28
        ),

      z:
        -2 -
        depth * 31,

      phase:
        Math.random(),

      speed:
        0.75 +
        Math.random() *
        0.60,

      /*
       * Much shorter than before.
       */
      length:
        THREE.MathUtils.lerp(
          0.10,
          0.035,
          depth,
        ) *
        (
          0.7 +
          Math.random() *
          0.6
        ),

      brightness:
        0.38 +
        Math.random() *
        0.62,
    })
  }

  function update(
    camera:
      THREE.Camera,

    ambientTime:
      number,

    atmosphere:
      ArtAtmosphereState,

    solar:
      SolarState,
  ) {
    const amount =
      atmosphere.rain

    const night =
      solar.nightAmount

    color
      .copy(dayColor)
      .lerp(
        nightColor,
        night,
      )

    material
      .uniforms
      .uColor
      .value
      .copy(color)

    rain.visible =
      amount > 0.01

    if (!rain.visible) {
      return
    }

    /*
     * Rain volume follows the viewer.
     */
    rain.position.x =
      camera.position.x

    rain.position.z =
      camera.position.z

    const activeDrops =
      Math.min(DROP_COUNT, Math.max(
        1,
        Math.floor(
          DROP_COUNT *
          (
            0.14 +
            amount * 0.86
          ) *
          THREE.MathUtils.lerp(
            1.35,
            1,
            night,
          ),
        ),
      ))

    geometry.setDrawRange(
      0,
      activeDrops * 2,
    )

    for (
      let i = 0;
      i < activeDrops;
      i++
    ) {
      const drop =
        drops[i]

      const fall =
        (
          drop.phase +
          ambientTime *
          drop.speed *
          (
            0.20 +
            amount * 0.18
          )
        ) %
        1

      const y =
        THREE.MathUtils.lerp(
          8,
          -3,
          fall,
        )

      const windTravel =
        fall *
        atmosphere.windStrength *
        2.2

      const x =
        drop.x +
        atmosphere.windX *
        windTravel

      const z =
        drop.z +
        atmosphere.windZ *
        windTravel

      // A streak is the recent trail of this same trajectory: 11 units
      // downward per fall cycle, with windTravel units of horizontal drift.
      const trailFraction = drop.length / 11
      const streakX = atmosphere.windX * atmosphere.windStrength * 2.2 * trailFraction
      const streakZ = atmosphere.windZ * atmosphere.windStrength * 2.2 * trailFraction

      const index =
        i * 6

      positions[index] =
        x

      positions[index + 1] =
        y

      positions[index + 2] =
        z

      positions[index + 3] =
        x -
        streakX

      positions[index + 4] =
        y +
        drop.length

      positions[index + 5] =
        z -
        streakZ

      /*
       * Nearby rain is more visible.
       * Distant rain turns into atmosphere.
       */
      const depthVisibility =
        THREE.MathUtils.lerp(
          1,
          0.16,
          drop.depth,
        )

      /*
       * Preset rain drives the read.
       * Restrained alpha also keeps daylight rain quiet against dark water.
       * Night fades further rather than drawing bright silver lines.
       */
      const opacity =
        amount *
        drop.brightness *
        depthVisibility *
        THREE.MathUtils.lerp(
          0.18,
          0.46,
          amount,
        ) *
        THREE.MathUtils.lerp(
          0.85,
          0.32,
          night,
        )

      alpha[i * 2] =
        opacity

      alpha[
        i * 2 + 1
      ] =
        opacity * 0.72
    }

    ;(
      geometry.getAttribute(
        'position',
      ) as
        THREE.BufferAttribute
    ).needsUpdate =
      true

    ;(
      geometry.getAttribute(
        'aAlpha',
      ) as
        THREE.BufferAttribute
    ).needsUpdate =
      true
  }

  return {
    rain,
    update,
  }
}
