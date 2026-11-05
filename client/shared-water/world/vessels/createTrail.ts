import * as THREE from 'three'

export type FadingLine =
  THREE.Line<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >

const vertexShader = `
  attribute float aAlpha;

  varying float vAlpha;

  void main() {
    vAlpha = aAlpha;

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

export function createFadingLine(
  color: string,
): FadingLine {
  const geometry =
    new THREE.BufferGeometry()

  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [],
      3,
    ),
  )

  geometry.setAttribute(
    'aAlpha',
    new THREE.Float32BufferAttribute(
      [],
      1,
    ),
  )

  const material =
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,

      uniforms: {
        uColor: {
          value:
            new THREE.Color(
              color,
            ),
        },
      },

      transparent: true,
      depthWrite: false,

      blending:
        THREE.AdditiveBlending,
    })

  const line =
    new THREE.Line(
      geometry,
      material,
    )

  line.frustumCulled =
    false

  line.renderOrder =
    4

  line.raycast =
    () => {}

  return line
}

export function updateFadingLine(
  line: FadingLine,
  points: THREE.Vector3[],
  maxOpacity: number,
  exponent = 1.8,
) {
  if (points.length < 2) {
    return
  }

  const positions =
    new Float32Array(
      points.length * 3,
    )

  const alpha =
    new Float32Array(
      points.length,
    )

  for (
    let i = 0;
    i < points.length;
    i++
  ) {
    const point =
      points[i]

    const index =
      i * 3

    positions[index] =
      point.x

    positions[index + 1] =
      point.y

    positions[index + 2] =
      point.z

    const progress =
      i /
      (points.length - 1)

    alpha[i] =
      (
        0.14 +
        Math.pow(
          progress,
          exponent,
        ) *
          0.86
      ) *
      maxOpacity
  }

  line.geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      positions,
      3,
    ),
  )

  line.geometry.setAttribute(
    'aAlpha',
    new THREE.BufferAttribute(
      alpha,
      1,
    ),
  )

  line.geometry.computeBoundingSphere()
}
