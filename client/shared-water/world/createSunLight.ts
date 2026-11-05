import * as THREE from 'three'

export function createSunLight() {
  const light =
    new THREE.DirectionalLight(
      '#d8e1dc',
      0,
    )

  light.position.set(
    0,
    40,
    -20,
  )

  light.target.position.set(
    0,
    -2,
    -10,
  )

  const ambient =
    new THREE.HemisphereLight(
      '#8aa2a8',
      '#071014',
      0,
    )

  return {
    light,
    ambient,
  }
}
