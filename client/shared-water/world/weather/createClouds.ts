import * as THREE from 'three'

import type {
  ArtAtmosphereState,
} from './sampleArtAtmosphere'

import type {
  SolarState,
} from '../time/getSolarState'

const vertexShader = `
  varying vec3 vDirection;

  void main() {
    vDirection =
      normalize(position);

    gl_Position =
      projectionMatrix *
      modelViewMatrix *
      vec4(position, 1.0);
  }
`

const fragmentShader = `
  uniform float uTime;
  uniform float uCloudCover;
  uniform float uNightAmount;

  uniform float uDayAmount;
  uniform float uTwilightAmount;
  uniform vec3 uSunDirection;

  uniform vec2 uWind;

  uniform float uScale;
  uniform float uSpeed;
  uniform float uOpacity;

  uniform float uLightning;
  uniform vec3 uLightningDirection;

  varying vec3 vDirection;

  float hash(vec2 p) {
    p =
      fract(
        p *
        vec2(
          123.34,
          456.21
        )
      );

    p +=
      dot(
        p,
        p + 45.32
      );

    return fract(
      p.x * p.y
    );
  }

  float noise(vec2 p) {
    vec2 i =
      floor(p);

    vec2 f =
      fract(p);

    f =
      f *
      f *
      (
        3.0 -
        2.0 * f
      );

    float a =
      hash(i);

    float b =
      hash(
        i +
        vec2(1.0, 0.0)
      );

    float c =
      hash(
        i +
        vec2(0.0, 1.0)
      );

    float d =
      hash(
        i +
        vec2(1.0, 1.0)
      );

    return mix(
      mix(a, b, f.x),
      mix(c, d, f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;

    for (
      int i = 0;
      i < 4;
      i++
    ) {
      value +=
        noise(p) *
        amplitude;

      p =
        p *
        2.04 +
        17.31;

      amplitude *=
        0.5;
    }

    return value;
  }

  void main() {
    vec3 direction =
      normalize(
        vDirection
      );

    float longitude =
      atan(
        direction.z,
        direction.x
      ) /
      6.2831853;

    float latitude =
      asin(
        clamp(
          direction.y,
          -1.0,
          1.0
        )
      ) /
      3.14159265;

    vec2 uv =
      vec2(
        longitude * 2.0,
        latitude * 4.0
      );

    /*
     * Noticeably moving cloud field.
     */
    uv +=
      uWind *
      uTime *
      uSpeed;

    float broad =
      fbm(
        uv *
        uScale
      );

    float medium =
      fbm(
        uv *
        uScale *
        2.7 +
        vec2(
          7.4,
          -3.1
        )
      );

    float fine =
      fbm(
        uv *
        uScale *
        6.2 +
        vec2(
          -2.7,
          5.3
        )
      );

    float density =
      broad * 0.60 +
      medium * 0.29 +
      fine * 0.11;

    /*
     * Significantly more visible cloud masses
     * than the previous pass.
     */
    float threshold =
      mix(
        0.70,
        0.39,
        uCloudCover
      );

    float cloud =
      smoothstep(
        threshold,
        threshold + 0.105,
        density
      );

    float skyMask =
      smoothstep(
        -0.07,
        0.075,
        direction.y
      );

    float lowCloudBias =
      1.0 -
      smoothstep(
        0.12,
        0.72,
        direction.y
      );

    float heightWeight =
      mix(
        0.55,
        1.28,
        lowCloudBias
      );

    float alpha =
      cloud *
      skyMask *
      heightWeight *
      uCloudCover *
      uOpacity;

    vec3 nightCloud =
      vec3(
        0.008,
        0.014,
        0.018
      );

    vec3 dayCloudDark =
      vec3(
        0.14,
        0.17,
        0.175
      );

    vec3 dayCloudLight =
      vec3(
        0.34,
        0.37,
        0.36
      );

    float sunFacing =
      max(
        dot(
          direction,
          uSunDirection
        ),
        0.0
      );

    float cloudLighting =
      0.35 +
      sunFacing *
      0.65;

    vec3 daylightCloud =
      mix(
        dayCloudDark,
        dayCloudLight,
        cloudLighting
      );

    vec3 color =
      mix(
        nightCloud,
        daylightCloud,
        uDayAmount
      );

    /*
     * Internal cloud definition.
     */
    color *=
      0.50 +
      density * 0.85;

    color +=
      vec3(
        0.20,
        0.085,
        0.045
      ) *
      uTwilightAmount *
      sunFacing *
      0.18;

    /*
     * Cloud illumination, not a lightning bolt.
     *
     * A broad region inside the cloud briefly
     * becomes visible.
     */
    float lightningFacing =
      max(
        dot(
          direction,
          uLightningDirection
        ),
        0.0
      );

    float lightningRegion =
      pow(
        lightningFacing,
        7.0
      );

    vec3 lightningColor =
      vec3(
        0.58,
        0.68,
        0.74
      );

    color +=
      lightningColor *
      lightningRegion *
      cloud *
      uLightning *
      1.25;

    /*
     * Lightning also reveals some thinner
     * surrounding vapor.
     */
    alpha +=
      lightningRegion *
      uLightning *
      density *
      0.22;

    gl_FragColor =
      vec4(
        color,
        clamp(
          alpha,
          0.0,
          0.88
        )
      );
  }
`

interface CloudLayer {
  mesh: THREE.Mesh<
    THREE.SphereGeometry,
    THREE.ShaderMaterial
  >
}

function createLayer(
  radius: number,
  scale: number,
  speed: number,
  opacity: number,
): CloudLayer {
  const geometry =
    new THREE.SphereGeometry(
      radius,
      72,
      48,
    )

  const material =
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,

      uniforms: {
        uTime: {
          value: 0,
        },

        uCloudCover: {
          value: 0,
        },

        uNightAmount: {
          value: 1,
        },

        uDayAmount: {
          value: 0,
        },

        uTwilightAmount: {
          value: 0,
        },

        uSunDirection: {
          value:
            new THREE.Vector3(
              0,
              0.5,
              -1,
            ).normalize(),
        },

        uWind: {
          value:
            new THREE.Vector2(
              1,
              0,
            ),
        },

        uScale: {
          value: scale,
        },

        uSpeed: {
          value: speed,
        },

        uOpacity: {
          value: opacity,
        },

        uLightning: {
          value: 0,
        },

        uLightningDirection: {
          value:
            new THREE.Vector3(
              0,
              0.5,
              -1,
            ).normalize(),
        },
      },

      side:
        THREE.BackSide,

      transparent: true,

      depthWrite: false,
      depthTest: false,

      blending:
        THREE.NormalBlending,
    })

  const mesh =
    new THREE.Mesh(
      geometry,
      material,
    )

  /*
   * Clouds must render AFTER stars
   * so they actually obscure them.
   */
  mesh.renderOrder =
    -500

  mesh.frustumCulled =
    false

  return {
    mesh,
  }
}

export function createClouds() {
  const group =
    new THREE.Group()

  /*
   * Lower, chunkier cloud masses.
   */
  const low =
    createLayer(
      198,
      1.85,
      0.012,
      1.0,
    )

  /*
   * Higher, thinner veil travelling
   * at a different speed.
   */
  const high =
    createLayer(
      202,
      4.3,
      -0.006,
      0.22,
    )

  group.add(
    low.mesh,
    high.mesh,
  )

  let nextLightning =
    2.5 +
    Math.random() * 3

  let lightningStart =
    -Infinity

  let lightningDirection =
    new THREE.Vector3(
      0,
      0.5,
      -1,
    ).normalize()

  function triggerLightning(
    ambientTime: number,
  ) {
    lightningStart =
      ambientTime

    lightningDirection =
      new THREE.Vector3(
        (
          Math.random() -
          0.5
        ) *
        1.2,

        0.28 +
        Math.random() *
        0.42,

        -0.65 -
        Math.random() *
        0.65,
      ).normalize()
  }

  function lightningIntensity(
    ambientTime: number,
    storm: number,
  ) {
    const age =
      ambientTime -
      lightningStart

    if (
      age < 0 ||
      age > 0.32
    ) {
      return 0
    }

    /*
     * Two soft flashes inside the cloud,
     * rather than one big electrical snap.
     */
    let intensity = 0

    if (age < 0.09) {
      intensity =
        Math.sin(
          age /
          0.09 *
          Math.PI
        )
    }

    if (
      age > 0.15 &&
      age < 0.26
    ) {
      intensity =
        Math.max(
          intensity,
          Math.sin(
            (
              age -
              0.15
            ) /
            0.11 *
            Math.PI
          ) *
          0.48,
        )
    }

    return (
      intensity *
      storm *
      0.82
    )
  }

  function update(
    ambientTime: number,
    atmosphere:
      ArtAtmosphereState,
    solar: SolarState,
  ) {
    const storm = atmosphere.lightningAllowed === false ? 0 :
      Math.min(
        1,
        atmosphere.cloudCover *
          0.65 +
        atmosphere.rain *
          0.75,
      )

    if (
      storm > 0.40 &&
      ambientTime >=
        nextLightning
    ) {
      triggerLightning(
        ambientTime,
      )

      /*
       * Heavy storms flash often.
       * Milder ones stay sparse.
       */
      const pause =
        THREE.MathUtils.lerp(
          7.5,
          2.1,
          storm,
        )

      const jitter =
        THREE.MathUtils.lerp(
          6.5,
          1.8,
          storm,
        )

      nextLightning =
        ambientTime +
        pause +
        Math.random() *
        jitter
    }

    if (
      storm <= 0.40 &&
      ambientTime >=
        nextLightning
    ) {
      nextLightning =
        ambientTime +
        2
    }

    const lightning =
      lightningIntensity(
        ambientTime,
        storm,
      )

    for (
      const layer of [
        low,
        high,
      ]
    ) {
      const uniforms =
        layer.mesh.material
          .uniforms

      uniforms
        .uTime
        .value =
        ambientTime

      uniforms
        .uCloudCover
        .value =
        atmosphere.cloudCover

      uniforms
        .uDayAmount
        .value =
        solar.dayAmount

      uniforms
        .uNightAmount
        .value =
        solar.nightAmount

      uniforms
        .uTwilightAmount
        .value =
        solar.twilightAmount

      uniforms
        .uSunDirection
        .value
        .copy(
          solar.sunDirection,
        )

      uniforms
        .uWind
        .value
        .set(
          atmosphere.windX,
          atmosphere.windZ,
        )

      uniforms
        .uLightning
        .value =
        lightning

      uniforms
        .uLightningDirection
        .value
        .copy(
          lightningDirection,
        )
    }

    /*
     * Extremely slow shell drift provides
     * another layer of parallax.
     */
    low.mesh.rotation.y =
      ambientTime *
      0.0014

    high.mesh.rotation.y =
      -ambientTime *
      0.0008
  }

  return {
    group,
    update,
  }
}
