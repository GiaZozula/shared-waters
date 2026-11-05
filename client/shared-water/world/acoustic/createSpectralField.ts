import * as THREE from 'three'
import { waterHeightGLSL } from '../waterMarkShader'

const PARTICLE_COUNT = 96

const vertexShader = `
  ${waterHeightGLSL}
  uniform float uProgress;
  uniform float uIntensity;
  attribute float aPhase;
  attribute float aRadius;
  varying float vAlpha;
  varying float vMark;

  void main() {
    float life = clamp(uProgress, 0.0, 1.0);
    float angle = aPhase * 6.2831853 + life * 5.5;
    float radius = aRadius * (1.0 - sin(life * 3.14159265) * 0.78);
    vec3 transformed = position;
    transformed.x += cos(angle) * radius;
    transformed.z += sin(angle) * radius;
    vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
    worldPosition.y = waterHeight(worldPosition.xz) + 0.16 + sin(life * 3.14159265) * 0.22;
    vec4 viewPosition = viewMatrix * worldPosition;
    vAlpha = sin(life * 3.14159265) * uIntensity;
    vMark = aPhase;
    gl_PointSize = clamp(95.0 / max(1.0, -viewPosition.z), 1.5, 5.0);
    gl_Position = projectionMatrix * viewPosition;
  }
`

const fragmentShader = `
  varying float vAlpha;
  varying float vMark;
  void main() {
    vec2 p = abs(gl_PointCoord - 0.5);
    float dash = step(p.y, 0.12) * step(p.x, 0.42);
    float cross = max(dash, step(p.x, 0.12) * step(p.y, 0.42));
    float mark = vMark > 0.97 ? cross : vMark > 0.86 ? dash : step(max(p.x, p.y), 0.16);
    float alpha = mark * vAlpha * 0.48;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(0.62, 0.80, 0.73, alpha);
  }
`

export function createSpectralField() {
  const geometry = new THREE.BufferGeometry()
  const phases = new Float32Array(PARTICLE_COUNT)
  const radii = new Float32Array(PARTICLE_COUNT)
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    phases[i] = (i * 0.61803398875) % 1
    radii[i] = 1.2 + Math.sqrt((i + 0.5) / PARTICLE_COUNT) * 7.5
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLE_COUNT * 3), 3))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
  geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1))
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uIntensity: { value: 0 },
      uWind: { value: new THREE.Vector2(1, 0) },
      uWaterEnergy: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  })
  const field = new THREE.Points(geometry, material)
  // Shader-displaced points begin at the origin in the CPU geometry.
  field.frustumCulled = false
  return field
}
