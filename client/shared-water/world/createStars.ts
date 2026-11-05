import * as THREE from 'three'

function createLayer(
  count: number,
  radiusMin: number,
  radiusMax: number,
  size: number,
  opacity: number,
): THREE.Points {
  const positions =
    new Float32Array(
      count * 3,
    )

  for (
    let i = 0;
    i < count;
    i += 1
  ) {
    const radius =
      THREE.MathUtils.lerp(
        radiusMin,
        radiusMax,
        Math.random(),
      )

    const theta =
      Math.random() *
      Math.PI *
      2

    const y =
      THREE.MathUtils.lerp(
        0.06,
        1,
        Math.random(),
      )

    const horizontal =
      Math.sqrt(
        1 - y * y,
      )

    const index = i * 3

    positions[index] =
      radius *
      horizontal *
      Math.cos(theta)

    positions[index + 1] =
      radius * y

    positions[index + 2] =
      radius *
      horizontal *
      Math.sin(theta)
  }

  const geometry =
    new THREE.BufferGeometry()

  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      positions,
      3,
    ),
  )

  const points =
    new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: '#9bb1bd',
        size,
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: false,
        sizeAttenuation: true,
        fog: false,
      }),
    )

  points.renderOrder = -700

  points.userData.baseOpacity =
    opacity

  return points
}

export function createStars(): THREE.Group {
  const stars =
    new THREE.Group()

  stars.add(
    createLayer(
      2800,
      85,
      150,
      0.14,
      0.24,
    ),

    createLayer(
      900,
      70,
      120,
      0.20,
      0.34,
    ),

    createLayer(
      140,
      55,
      95,
      0.26,
      0.48,
    ),
  )

  return stars
}

export function updateStars(
  group: THREE.Group,
  visibility: number,
) {
  group.traverse(
    (object) => {
      if (
        !(
          object instanceof
          THREE.Points
        )
      ) {
        return
      }

      const material =
        object.material as
        THREE.PointsMaterial

      material.opacity =
        object.userData
          .baseOpacity *
        visibility
    },
  )
}
