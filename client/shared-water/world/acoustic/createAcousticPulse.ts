import * as THREE from 'three'
import { waterMarkVertexShader } from '../waterMarkShader'

const fragmentShader = `
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
    vec2 grid = vec2(64.0);
    vec2 cell = floor(vUv * grid);
    vec2 field = ((cell + 0.5) / grid - 0.5) * 2.0;
    vec2 p = fract(vUv * grid) - 0.5;
    vec2 aa = max(fwidth(vUv * grid), vec2(0.035));
    float seed = hash(cell);
    float radius = length(field);
    float angle = atan(field.y, field.x);

    // Two broken arms gather inward, turn once, then disperse and fade
    // completely. This is a visual reveal, never a whale trajectory.
    float turn = uProgress * 5.5;
    float spiral = sin(angle * 2.0 + radius * (15.0 + uProgress * 5.0) - turn);
    float trace = smoothstep(0.77, 0.96, spiral);
    float breath = sin(uProgress * 3.14159265);
    float gather = mix(0.95, 0.30, breath);
    float arrival = 1.0 - smoothstep(0.08, 0.22, abs(radius - gather));
    float resting = 1.0 - smoothstep(0.30, 0.65, radius);
    float envelope = sin(min(uProgress, 1.0) * 3.14159265);
    float fieldMask = trace * (arrival + resting * 0.18) * envelope;
    float edge = 1.0 - smoothstep(0.78, 0.98, radius);

    float dotMark = inkBox(p, vec2(0.09), aa);
    float dashMark = inkBox(p, vec2(0.28, 0.055), aa);
    float crossMark = max(
      inkBox(p, vec2(0.22, 0.05), aa),
      inkBox(p, vec2(0.05, 0.22), aa)
    );
    float mark = seed < 0.88 ? dotMark : seed < 0.98 ? dashMark : crossMark;
    float alpha = mark * fieldMask * edge * step(0.24, seed) * uIntensity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(mix(vec3(0.45, 0.65, 0.61), vec3(0.66, 0.82, 0.75), seed), alpha);
  }
`

export function createAcousticPulse() {
  const material = new THREE.ShaderMaterial({
    vertexShader: waterMarkVertexShader,
    fragmentShader,
    uniforms: {
      uProgress: { value: 0 },
      uIntensity: { value: 0 },
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(1, 0) },
      uWaterEnergy: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  })
  const pulse = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 48, 48), material)
  pulse.rotation.x = -Math.PI / 2
  pulse.scale.setScalar(20)
  pulse.renderOrder = 4
  return pulse
}
