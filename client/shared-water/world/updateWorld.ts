import * as THREE from 'three'

const BASE_POSITION =
  new THREE.Vector3(
    0,
    4.5,
    15,
  )

const BASE_TARGET =
  new THREE.Vector3(
    0,
    -1.5,
    -8,
  )

// Selection reveals a record without reframing the water. Keep only the
// original gentle ambient drift so clearing selection cannot strand the view.
export function updateWorld(camera: THREE.PerspectiveCamera, elapsed: number) {
  camera.position.set(
    BASE_POSITION.x + Math.sin(elapsed * 0.07) * 0.14,
    BASE_POSITION.y + Math.sin(elapsed * 0.09) * 0.07,
    BASE_POSITION.z + Math.sin(elapsed * 0.045) * 0.08,
  )
  camera.lookAt(BASE_TARGET)
  camera.rotateZ(Math.sin(elapsed * 0.055) * 0.0035)
}
