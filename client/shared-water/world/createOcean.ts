import * as THREE from 'three'
import { Water } from 'three/addons/objects/Water.js'

export const MAX_VESSELS = 32

const vertexShader = `
  uniform float uTime;
  uniform vec2 uWind;
  uniform float uWeatherEnergy;

  varying vec3 vWorldPosition;
  varying float vElevation;

  void main() {
    vec3 transformed = position;

    float distanceFromCenter =
      length(position.xy);

    float curvature =
      -pow(
        distanceFromCenter / 82.0,
        2.0
      ) *
      9.0;

    float swellA =
      sin(
        position.x * 0.075 +
        uTime * 0.13
      ) *
      0.24;

    float swellB =
      sin(
        position.y * 0.052 -
        uTime * 0.10
      ) *
      0.18;

    float interferenceA =
      sin(
        (position.x + position.y) *
        0.19 +
        uTime * 0.21
      ) *
      0.055;

    float interferenceB =
      sin(
        (position.x - position.y) *
        0.14 -
        uTime * 0.16
      ) *
      0.045;

    vec2 wind =
      normalize(
        uWind +
        vec2(
          0.0001,
          0.0001
        )
      );

    vec2 crossWind =
      vec2(
        -wind.y,
        wind.x
      );

    float windWave =
      sin(
        dot(
          position.xy,
          wind
        ) *
        0.24 +
        uTime *
        (
          0.32 +
          uWeatherEnergy *
          0.32
        )
      ) *
      0.14 *
      uWeatherEnergy;

    float crossWave =
      sin(
        dot(
          position.xy,
          crossWind
        ) *
        0.42 -
        uTime *
        0.34
      ) *
      0.065 *
      uWeatherEnergy;

    float elevation = (1.3 + uWeatherEnergy * 1.2) * (
      swellA +
      swellB +
      interferenceA +
      interferenceB +
      windWave +
      crossWave);

    transformed.z +=
      curvature +
      elevation;

    vElevation = elevation;

    vec4 worldPosition =
      modelMatrix *
      vec4(
        transformed,
        1.0
      );

    vWorldPosition =
      worldPosition.xyz;

    gl_Position =
      projectionMatrix *
      viewMatrix *
      worldPosition;
  }
`

const fragmentShader = `
  #define MAX_VESSELS 32
  #define MAX_DETECTIONS 2

  uniform vec3
    uVesselPositions[MAX_VESSELS];

  uniform vec3
    uVesselDirections[MAX_VESSELS];

  uniform float
    uVesselIntensities[MAX_VESSELS];

  uniform vec3
    uDetectionPositions[MAX_DETECTIONS];

  uniform float
    uDetectionStrengths[MAX_DETECTIONS];

  uniform float uWeatherEnergy;

  uniform float uDayAmount;
  uniform float uTwilightAmount;

  uniform vec3 uSunDirection;
  uniform vec3 uMoonDirection;

  varying vec3 vWorldPosition;
  varying float vElevation;

  float interleavedGradientNoise(
    vec2 pixel
  ) {
    return fract(
      52.9829189 *
      fract(
        0.06711056 * pixel.x +
        0.00583715 * pixel.y
      )
    );
  }

  void main() {
    vec3 dx =
      dFdx(vWorldPosition);

    vec3 dy =
      dFdy(vWorldPosition);

    vec3 normal =
      normalize(
        cross(dx, dy)
      );

    if (normal.y < 0.0) {
      normal *= -1.0;
    }

    vec3 viewDirection =
      normalize(
        cameraPosition -
        vWorldPosition
      );

    float facing =
      max(
        dot(
          normal,
          viewDirection
        ),
        0.0
      );

    float fresnel =
      pow(
        1.0 - facing,
        3.3
      );

    vec3 nightWater =
      vec3(
        0.003,
        0.013,
        0.018
      );

    vec3 dayWater =
      vec3(
        0.018,
        0.075,
        0.095
      );

    vec3 deepWater =
      mix(
        nightWater,
        dayWater,
        uDayAmount
      );

    vec3 reflectedSky =
      vec3(
        0.008,
        0.022,
        0.032
      );

    float waveLight =
      smoothstep(
        -0.30,
        0.35,
        vElevation
      );

    vec3 color =
      mix(
        nightWater,
        deepWater,
        0.32 +
        waveLight * 0.16
      );

    color =
      mix(
        color,
        reflectedSky,
        fresnel * 0.20
      );

    vec3 reflectedSun =
      reflect(
        -uSunDirection,
        normal
      );

    float sunSpecular =
      pow(
        max(
          dot(
            reflectedSun,
            viewDirection
          ),
          0.0
        ),
        140.0
      );

    float sunGlitter =
      pow(
        max(
          dot(
            reflectedSun,
            viewDirection
          ),
          0.0
        ),
        24.0
      );

    color +=
      vec3(
        0.85,
        0.82,
        0.67
      ) *
      sunSpecular *
      uDayAmount *
      0.55;

    color +=
      vec3(
        0.18,
        0.23,
        0.22
      ) *
      sunGlitter *
      uDayAmount *
      0.10;

    // Quiet sky sheen on existing swells: no reflection target or extra mesh.
    // This is ambient night light, not an inferred astronomical moon position.
    vec3 nightHalfVector = normalize(
      viewDirection + uMoonDirection
    );
    float nightSheen = pow(max(dot(normal, nightHalfVector), 0.0), 48.0);
    float nightCrest = smoothstep(-0.08, 0.32, vElevation);
    color += vec3(0.085, 0.14, 0.19)
      * ((nightSheen / (1.0 + nightSheen * 0.35)) * 0.85 + nightCrest * 0.055)
      * (0.8 + uWeatherEnergy * 0.35)
      * (1.0 - uDayAmount);

    float weatherCrest =
      smoothstep(
        0.10,
        0.36,
        vElevation
      ) *
      uWeatherEnergy;

    color +=
      vec3(
        0.006,
        0.014,
        0.018
      ) *
      weatherCrest *
      0.55;

    float daylightCrest =
      smoothstep(
        0.04,
        0.24,
        vElevation
      ) *
      uWeatherEnergy *
      uDayAmount;

    color +=
      vec3(
        0.07,
        0.105,
        0.11
      ) *
      daylightCrest *
      0.30;

    /*
     * Vessel illumination.
     */
    for (
      int i = 0;
      i < MAX_VESSELS;
      i++
    ) {
      vec2 relative =
        vWorldPosition.xz -
        uVesselPositions[i].xz;

      float distanceToVessel =
        length(relative);

      float localGlow =
        exp(
          -distanceToVessel *
          0.72
        ) *
        uVesselIntensities[i];

      vec2 heading =
        normalize(
          uVesselDirections[i].xz +
          vec2(0.00001)
        );

      vec2 relativeDirection =
        normalize(
          relative +
          vec2(0.00001)
        );

      float forwardAmount =
        max(
          dot(
            relativeDirection,
            heading
          ),
          0.0
        );

      float beamShape =
        pow(
          forwardAmount,
          18.0
        );

      float beamDistance =
        smoothstep(
          0.4,
          1.4,
          distanceToVessel
        ) *
        (
          1.0 -
          smoothstep(
            1.5,
            5.0,
            distanceToVessel
          )
        );

      float beam =
        beamShape *
        beamDistance *
        uVesselIntensities[i];

      vec3 orange =
        vec3(
          1.0,
          0.18,
          0.035
        );

      color +=
        orange *
        localGlow *
        0.018;

      color +=
        orange *
        beam *
        0.028;
    }

    /*
     * Acoustic detection illumination.
     *
     * This is deliberately broad and diffuse.
     */
    for (
      int i = 0;
      i < MAX_DETECTIONS;
      i++
    ) {
      float acousticDistance =
        distance(
          vWorldPosition.xz,
          uDetectionPositions[i].xz
        );

      float acousticGlow =
        exp(
          -acousticDistance *
          0.22
        ) *
        uDetectionStrengths[i];

      float wave =
        sin(
          acousticDistance *
          3.2
        ) *
        0.5 +
        0.5;

      wave =
        pow(
          wave,
          5.0
        );

      vec3 acousticColor =
        vec3(
          0.035,
          0.28,
          0.42
        );

      color +=
        acousticColor *
        acousticGlow *
        (
          0.025 +
          wave * 0.025
        );
    }

    float distanceToCamera =
      length(
        cameraPosition -
        vWorldPosition
      );

    float distanceFade =
      smoothstep(
        35.0,
        105.0,
        distanceToCamera
      );

    vec3 horizonColor =
      vec3(
        0.0013,
        0.0050,
        0.0075
      );

    color =
      mix(
        color,
        horizonColor,
        distanceFade * 0.74
      );

    float edgeDistance =
      length(
        vWorldPosition.xz
      );

    float edgeFade =
      1.0 -
      smoothstep(
        42.0,
        82.0,
        edgeDistance
      );

    color *=
      mix(
        0.13,
        1.0,
        edgeFade
      );

    /*
     * Again: dither, not grain.
     */
    float dither =
      interleavedGradientNoise(
        gl_FragCoord.xy
      ) - 0.5;

    color +=
      dither / 650.0;

    gl_FragColor =
      vec4(
        color,
        1.0
      );
  }
`

export function createOcean(reflective = true) {
  const geometry =
    new THREE.PlaneGeometry(
      160,
      160,
      180,
      180,
    )

  const vesselPositions =
    Array.from(
      {
        length: MAX_VESSELS,
      },
      () =>
        new THREE.Vector3(
          999,
          999,
          999,
        ),
    )

  const vesselDirections =
    Array.from(
      {
        length: MAX_VESSELS,
      },
      () =>
        new THREE.Vector3(
          0,
          0,
          -1,
        ),
    )

  const material =
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,

      uniforms: {
        uTime: {
          value: 0,
        },

        uWind: {
          value:
            new THREE.Vector2(
              1,
              0,
            ),
        },

        uWeatherEnergy: {
          value: 0,
        },

        uDayAmount: {
          value: 0,
        },

        uTwilightAmount: {
          value: 0,
        },

        uMoonDirection: { value: new THREE.Vector3(-0.22, 0.32, -0.92).normalize() },

        uSunDirection: {
          value:
            new THREE.Vector3(
              0,
              0.5,
              -1,
            ).normalize(),
        },

        uVesselPositions: {
          value: vesselPositions,
        },

        uVesselDirections: {
          value: vesselDirections,
        },

        uVesselIntensities: {
          value:
            new Float32Array(
              MAX_VESSELS,
            ),
        },

        uDetectionPositions: {
          value: [
            new THREE.Vector3(
              999,
              999,
              999,
            ),

            new THREE.Vector3(
              999,
              999,
              999,
            ),
          ],
        },

        uDetectionStrengths: {
          value:
            new Float32Array(2),
        },
      },
    })

  // The same Water addon and normal map used by the Three.js ocean example.
  // Retain our curved swells and evidence illumination around its reflection setup.
  const waterNormals = reflective ? new THREE.TextureLoader().load('/waternormals.jpg') : null
  if (waterNormals) waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping
  const ocean = reflective
    ? new Water(geometry, {
      textureWidth: 256,
      textureHeight: 256,
      waterNormals: waterNormals!,
      distortionScale: 1.4,
    })
    : new THREE.Mesh(geometry, material)

  if (reflective) {
    const waterMaterial = ocean.material as THREE.ShaderMaterial
    // Share (rather than clone) these objects with Water's mirror-camera closure.
    Object.assign(material.uniforms, waterMaterial.uniforms)
    material.uniforms.time = material.uniforms.uTime
    material.vertexShader = material.vertexShader
      .replace('uniform float uTime;', 'uniform float uTime; uniform mat4 textureMatrix; varying vec4 mirrorCoord;')
      .replace('vWorldPosition =', 'mirrorCoord = textureMatrix * worldPosition; vWorldPosition =')
    material.fragmentShader = material.fragmentShader
      .replace('uniform float uWeatherEnergy;', `
        uniform float uWeatherEnergy;
        uniform float time;
        uniform sampler2D normalSampler;
        uniform sampler2D mirrorSampler;
        varying vec4 mirrorCoord;

        // Water.js four scrolling normal samples, scaled to this small scene.
        vec4 getNoise(vec2 uv) {
          vec2 uv0 = uv / 103.0 + vec2(time / 17.0, time / 29.0);
          vec2 uv1 = uv / 107.0 - vec2(time / -19.0, time / 31.0);
          vec2 uv2 = uv / vec2(8907.0, 9803.0) + vec2(time / 101.0, time / 97.0);
          vec2 uv3 = uv / vec2(1091.0, 1027.0) - vec2(time / 109.0, time / -113.0);
          return (texture2D(normalSampler, uv0) + texture2D(normalSampler, uv1)
            + texture2D(normalSampler, uv2) + texture2D(normalSampler, uv3)) * 0.5 - 1.0;
        }
      `)
      .replace('vec3 viewDirection =', `
        vec4 noise = getNoise(vWorldPosition.xz * 8.0);
        vec3 rippleNormal = normalize(noise.xzy * vec3(0.42, 1.0, 0.42));
        normal = normalize(normal + vec3(rippleNormal.x, 0.0, rippleNormal.z)
          * (0.65 + uWeatherEnergy * 0.65));
        vec3 viewDirection =
      `)
      .replace('float weatherCrest =', `
        // Distorted planar reflection, kept quiet in the existing ink palette.
        float eyeDistance = length(cameraPosition - vWorldPosition);
        vec2 distortion = normal.xz * (0.001 + 1.0 / max(eyeDistance, 1.0)) * 1.4;
        vec3 reflectionSample = texture2D(mirrorSampler,
          mirrorCoord.xy / mirrorCoord.w + distortion).rgb;
        // Compress only bright reflected peaks; preserve the dark-water detail.
        float reflectionPeak = max(reflectionSample.r, max(reflectionSample.g, reflectionSample.b));
        reflectionSample /= 1.0 + reflectionPeak * 0.6;
        float reflectance = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
        color = mix(color, reflectionSample, reflectance * 0.32);
        float weatherCrest =
      `)
    ocean.material = material
    waterMaterial.dispose()

    const reflect = ocean.onBeforeRender.bind(ocean)
    let lastReflection = -Infinity
    ocean.onBeforeRender = (renderer, scene, camera, geometry, drawnMaterial, group) => {
      // At most 20 reflections/sec, independent of the display refresh rate.
      const now = performance.now()
      if (now - lastReflection < 50) return
      lastReflection = now
      // Subpixel star points alias into square blocks in the small mirror target.
      const hidden = scene.children.filter(child => child.visible && child.userData.waterReflection === false)
      for (const child of hidden) child.visible = false
      try {
        reflect(renderer, scene, camera, geometry, drawnMaterial, group)
      } finally {
        for (const child of hidden) child.visible = true
      }
    }
  }

  ocean.rotation.x =
    -Math.PI / 2

  ocean.position.y = -2

  ocean.userData.material =
    material

  return ocean
}
