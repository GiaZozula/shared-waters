import * as THREE from 'three'

const vertexShader = `
  varying vec3 vDirection;

  void main() {
    vDirection = normalize(position);

    gl_Position =
      projectionMatrix *
      modelViewMatrix *
      vec4(position, 1.0);
  }
`

const fragmentShader = `
  uniform float uDayAmount;
  uniform float uTwilightAmount;
  uniform float uNightAmount;
  uniform float uWeatherHaze;

  uniform vec3 uSunDirection;

  varying vec3 vDirection;

  float interleavedGradientNoise(vec2 pixel) {
    return fract(
      52.9829189 *
      fract(
        0.06711056 * pixel.x +
        0.00583715 * pixel.y
      )
    );
  }

  void main() {
    vec3 direction =
      normalize(vDirection);

    float vertical =
      clamp(
        direction.y *
        0.5 +
        0.5,
        0.0,
        1.0
      );

    /*
     * --------------------------
     * Night palette
     * --------------------------
     */

    vec3 nightZenith =
      vec3(
        0.0015,
        0.0042,
        0.0065
      );

    vec3 nightHorizon =
      vec3(
        0.0040,
        0.0100,
        0.0145
      );

    vec3 nightSky =
      mix(
        nightHorizon,
        nightZenith,
        pow(
          vertical,
          0.72
        )
      );

    /*
     * --------------------------
     * Day palette
     * --------------------------
     *
     * Still muted and cinematic.
     * We don't want Microsoft
     * Flight Simulator blue.
     */

    vec3 dayZenith =
      vec3(
        0.055,
        0.125,
        0.165
      );

    vec3 dayHorizon =
      vec3(
        0.20,
        0.275,
        0.295
      );

    vec3 daySky =
      mix(
        dayHorizon,
        dayZenith,
        pow(
          vertical,
          0.64
        )
      );

    /*
     * --------------------------
     * Base sky
     * --------------------------
     */

    vec3 color =
      mix(
        nightSky,
        daySky,
        uDayAmount
      );

    /*
     * --------------------------
     * Twilight
     * --------------------------
     */

    float horizonBand =
      exp(
        -pow(
          abs(
            direction.y
          ) *
          3.7,
          2.0
        )
      );

    vec3 twilightColor =
      vec3(
        0.24,
        0.115,
        0.065
      );

    color +=
      twilightColor *
      horizonBand *
      uTwilightAmount *
      0.42;

    /*
     * --------------------------
     * Sun glow
     * --------------------------
     */

    float sunFacing =
      max(
        dot(
          direction,
          uSunDirection
        ),
        0.0
      );

    float broadSun =
      pow(
        sunFacing,
        14.0
      );

    float sunCore =
      pow(
        sunFacing,
        700.0
      );

    color +=
      vec3(
        0.38,
        0.33,
        0.25
      ) *
      broadSun *
      uDayAmount *
      0.18;

    color +=
      vec3(
        1.0,
        0.88,
        0.69
      ) *
      sunCore *
      uDayAmount *
      0.72;

    float weatherHaze =
      exp(
        -pow(
          abs(
            direction.y +
            0.035
          ) *
          3.8,
          2.0
        )
      );

    color +=
      vec3(
        0.0035,
        0.0065,
        0.0080
      ) *
      weatherHaze *
      uWeatherHaze *
      0.65;

    /*
     * Dither only.
     * This should NOT look like film grain.
     */
    float dither =
      interleavedGradientNoise(
        gl_FragCoord.xy
      ) - 0.5;

    color +=
      dither / 510.0;

    gl_FragColor =
      vec4(
        color,
        1.0
      );
  }
`

export function createAtmosphere() {
  const geometry =
    new THREE.SphereGeometry(
      220,
      48,
      32,
    )

  const material =
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uDayAmount: {
          value: 0,
        },

        uNightAmount: {
          value: 1,
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

        uWeatherHaze: {
          value: 0,
        },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    })

  const atmosphere =
    new THREE.Mesh(
      geometry,
      material,
    )

  atmosphere.renderOrder = -1000
  atmosphere.frustumCulled = false

  atmosphere.userData.material =
    material

  return atmosphere
}
