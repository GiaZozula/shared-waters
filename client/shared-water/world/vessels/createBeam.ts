import * as THREE from 'three'

const BEAM_LENGTH = 4.0

const vertexShader = `
  varying float vDistance;

  void main() {
    vDistance =
      clamp(
        -position.z / 4.0,
        0.0,
        1.0
      );

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
  uniform float uIntensity;

  varying float vDistance;

  void main() {
    float fadeIn =
      smoothstep(
        0.01,
        0.10,
        vDistance
      );

    float fadeOut =
      1.0 -
      smoothstep(
        0.35,
        1.0,
        vDistance
      );

    float alpha =
      fadeIn *
      fadeOut *
      0.038 *
      uIntensity;

    gl_FragColor =
      vec4(
        uColor,
        alpha
      );
  }
`

export function createBeam() {
  const geometry =
    new THREE.ConeGeometry(
      0.58,
      BEAM_LENGTH,
      28,
      1,
      true,
    )

  /*
   * ConeGeometry points along Y.
   * Transform it so its narrow end begins at the
   * vessel and expands along local -Z.
   */
  geometry.rotateX(
    Math.PI / 2,
  )

  geometry.translate(
    0,
    0,
    -BEAM_LENGTH / 2,
  )

  const material =
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,

      uniforms: {
        uColor: {
          value:
            new THREE.Color(
              '#ff7b32',
            ),
        },

        uIntensity: {
          value: 1,
        },
      },

      transparent: true,

      depthWrite: false,

      side:
        THREE.DoubleSide,

      blending:
        THREE.AdditiveBlending,
    })

  const beam =
    new THREE.Mesh(
      geometry,
      material,
    )

  beam.raycast = () => {}

  beam.renderOrder = 3

  return beam
}
