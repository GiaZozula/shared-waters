import * as THREE from 'three'
import { waterMarkVertexShader } from '../waterMarkShader'

import {
  getOceanHeight,
} from '../oceanHeight'

import {
  ZONE_A_COORDINATES,
  geoToWorld,
} from '../geo/zoneProjection'

import type {
  ArtAtmosphereState,
} from '../weather/sampleArtAtmosphere'

import type {
  RestrictionFact,
  SceneMode,
} from '../facts/types'

const PULSE_SECONDS =
  4.8

const PULSE_REST_SECONDS = 6

const CENTER_LAT =
  ZONE_A_COORDINATES.reduce(
    (
      total,
      point,
    ) =>
      total +
      point.lat,

    0,
  ) /
  ZONE_A_COORDINATES.length

const CENTER_LON =
  ZONE_A_COORDINATES.reduce(
    (
      total,
      point,
    ) =>
      total +
      point.lon,

    0,
  ) /
  ZONE_A_COORDINATES.length

// Original procedural marks: no glyph atlas, archive code or extra render pass.
// Quantize the wave in its own plane so the register recedes with the water.
const pulseFragmentShader = `
  uniform float uProgress;
  uniform float uIntensity;

  varying vec2 vUv;

  float hash(vec2 cell) {
    return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  }

  float inkBox(vec2 p, vec2 halfSize, vec2 aa) {
    vec2 edge = 1.0 - smoothstep(halfSize - aa, halfSize + aa, abs(p));
    return edge.x * edge.y;
  }

  void main() {
    vec2 grid = vec2(144.0, 144.0);
    vec2 cell = floor(vUv * grid);
    vec2 p = fract(vUv * grid) - 0.5;
    vec2 field = ((cell + 0.5) / grid - 0.5) * 2.0;
    vec2 aa = max(fwidth(vUv * grid), vec2(0.035));
    float seed = hash(cell);

    // Fixed gaps and uneven sectors keep this closer to an imperfect printed
    // impression than a continuous radar circle. Nothing flickers at random.
    float angle = atan(field.y, field.x);
    float sector = floor((angle + 3.14159265) * 10.0);
    float distanceFromCenter = length(field);
    float offset = (hash(vec2(sector, 7.0)) - 0.5) * 0.035;
    float radius = floor((distanceFromCenter + offset) * 38.0) / 38.0;
    float travel = 1.0 - pow(1.0 - uProgress, 1.6);
    float front = floor(travel * 34.0) / 38.0;
    float behind = front - radius;

    float leading = (1.0 - step(0.04, abs(behind))) * 0.90;
    float echo = (1.0 - step(0.022, abs(behind - 0.105))) * 0.34;
    float residue = (1.0 - step(0.022, abs(behind - 0.20))) * 0.12;
    float gaps = step(0.27, seed) * step(0.12, hash(vec2(sector, 19.0)));

    // Predominantly long horizontal strokes make the notice read as stepped
    // outward bands, distinct from the acoustic spiral's fine dots.
    float dotMark = inkBox(p, vec2(0.075), aa);
    float dashMark = inkBox(p, vec2(0.37, 0.04), aa);
    float crossMark = max(
      inkBox(p, vec2(0.20, 0.045), aa),
      inkBox(p, vec2(0.045, 0.20), aa)
    );
    float mark = seed < 0.38 ? dotMark : seed < 0.96 ? dashMark : crossMark;
    float fadeIn = smoothstep(0.0, 0.09, uProgress);
    float fadeOut = 1.0 - smoothstep(0.55, 1.0, uProgress);
    float edge = 1.0 - smoothstep(0.85, 0.98, distanceFromCenter);
    float alpha = mark * (leading + echo + residue) * gaps * edge
      * fadeIn * fadeOut * uIntensity * 0.58;

    if (alpha < 0.008) discard;

    // Tarnished brass ink: subdued and separate from the orange vessel light.
    vec3 ink = mix(vec3(0.60, 0.52, 0.34), vec3(0.83, 0.75, 0.53), seed);
    gl_FragColor = vec4(ink, alpha);
  }
`

export function createZoneA(
  camera:
    THREE.Camera,
) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  const group =
    new THREE.Group()

  const label =
    document.createElement(
      'div',
    )

  label.className =
    'zone-state'

  document.body.appendChild(
    label,
  )

  const center =
    geoToWorld(
      CENTER_LAT,
      CENTER_LON,
    )

  const projected =
    new THREE.Vector3()

  const pulseMaterial =
    new THREE.ShaderMaterial({
      vertexShader:
        waterMarkVertexShader,

      fragmentShader:
        pulseFragmentShader,

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

        uWaterEnergy: {
          value: 0,
        },

        uProgress: {
          value: 0,
        },

        uIntensity: {
          value: 0,
        },
      },

      transparent: true,
      depthWrite: false,

      blending:
        THREE.NormalBlending,

      side:
        THREE.DoubleSide,
    })

  const pulse =
    new THREE.Mesh(
      new THREE.PlaneGeometry(
        1,
        1,
        64,
        64,
      ),
      pulseMaterial,
    )

  pulse.rotation.x =
    -Math.PI / 2

  pulse.scale.setScalar(
    150,
  )

  pulse.position.set(
    center.x,
    0,
    center.z,
  )

  pulse.renderOrder = 4
  pulse.visible = false
  pulse.frustumCulled = false

  group.add(pulse)

  let restriction:
    RestrictionFact = {
      status: 'unknown',

      effectiveAt: null,
      publishedAt: null,

      speedKnots: null,

      minimumLengthMetres:
        null,

      exceptionsApply:
        false,

      cancellationReference:
        null,
    }

  let mode: SceneMode = 'story'

  let pulseArmed =
    false

  let pulseOrigin:
    number | null =
    null

  function renderLabel() {
    if (
      mode !== 'story' ||
      restriction.status !==
      'active'
    ) {
      label.replaceChildren()
      label.hidden = true
      return
    }

    const speedLine =
      restriction.speedKnots === null
        ? 'Zone A speed limit in effect'
        : `${restriction.speedKnots}-knot Zone A limit in effect`
    const scopeLine =
      restriction.minimumLengthMetres === null
        ? 'vessel size threshold not established'
        : `vessels over ${restriction.minimumLengthMetres} m`
    const exceptionLine = restriction.exceptionsApply ? 'exceptions apply' : ''

    label.replaceChildren(
      ...[
        speedLine,
        [scopeLine, exceptionLine].filter(Boolean).join(' · '),
      ].map(
        (
          text,
        ) => {
          const line =
            document.createElement(
              'div',
            )

          line.textContent =
            text

          return line
        },
      ),
    )
  }

  function stopPulse() {
    pulseArmed = false
    pulseOrigin = null
    pulse.visible = false

    pulseMaterial
      .uniforms
      .uIntensity
      .value = 0
  }

  function updatePulse(
    ambientTime: number,
    atmosphere:
      ArtAtmosphereState,
  ) {
    pulseMaterial
      .uniforms
      .uTime
      .value =
      ambientTime

    pulseMaterial
      .uniforms
      .uWind
      .value
      .set(
        atmosphere.windX,
        atmosphere.windZ,
      )

    pulseMaterial
      .uniforms
      .uWaterEnergy
      .value =
      atmosphere.waterEnergy

    if (reducedMotion.matches || mode !== 'story') {
      stopPulse()
      return
    }

    if (pulseArmed) {
      pulseOrigin =
        ambientTime

      pulseArmed = false
    }

    if (
      pulseOrigin === null
    ) {
      pulse.visible = false
      return
    }

    // Repeat the visual motif after a quiet gap while this Story state is
    // selected. Replays do not represent newly published/received notices.
    const cycleTime = (ambientTime - pulseOrigin) % (PULSE_SECONDS + PULSE_REST_SECONDS)
    const progress = cycleTime / PULSE_SECONDS

    if (progress >= 1) {
      pulse.visible = false
      pulseMaterial.uniforms.uIntensity.value = 0
      return
    }

    pulse.visible = true

    pulseMaterial
      .uniforms
      .uProgress
      .value =
      progress

    pulseMaterial
      .uniforms
      .uIntensity
      .value = 1
  }

  function update(
    ambientTime: number,
    atmosphere:
      ArtAtmosphereState,
  ) {
    updatePulse(
      ambientTime,
      atmosphere,
    )

    if (
      restriction.status !==
      'active'
    ) {
      label.hidden = true
      return
    }

    projected.set(
      center.x,
      getOceanHeight(
        center.x,
        center.z,
        ambientTime,
        atmosphere,
      ) +
        0.3,
      center.z,
    )

    projected.project(
      camera,
    )

    const visible =
      projected.z > -1 &&
      projected.z < 1

    label.hidden =
      !visible

    if (!visible) {
      return
    }

    label.style.left = `${
      (
        projected.x *
        0.5 +
        0.5
      ) *
      window.innerWidth
    }px`

    label.style.top = `${
      (
        -projected.y *
        0.5 +
        0.5
      ) *
      window.innerHeight
    }px`
  }

  renderLabel()

  return {
    group,

    setRestriction(
      next:
        RestrictionFact,
    ) {
      const entering =
        restriction.status !==
          'active' &&
        next.status ===
          'active'

      const leaving =
        restriction.status ===
          'active' &&
        next.status !==
          'active'

      restriction = next
      renderLabel()

      // Live loads the latest indexed state when the mode opens. That is a
      // baseline read, not a newly observed notice, so it must not pulse.
      if (entering && mode === 'story') {
        pulseArmed = true
      }

      if (leaving) {
        stopPulse()
      }
    },

    setMode(next: SceneMode) {
      if (next !== mode) {
        stopPulse()
        if (next === 'story' && restriction.status === 'active') pulseArmed = true
      }
      mode = next
      renderLabel()
    },

    update,
  }
}
