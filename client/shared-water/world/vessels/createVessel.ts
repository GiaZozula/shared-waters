import * as THREE from 'three'

import {
  createBeam,
} from './createBeam'

import {
  createFadingLine,
  type FadingLine,
} from './createTrail'

import type {
  InteractiveEntity,
} from '../interaction/types'

export interface VesselSceneBinding {
  id: string

  sceneX: number
  sceneZ: number

  source:
    'gfw' | 'ais'

  towardX:
    number | null

  towardZ:
    number | null
}

export interface Vessel
  extends InteractiveEntity {
  visualRoot: THREE.Group

  core: THREE.Mesh
  nose: THREE.Mesh

  beam: THREE.Mesh<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >

  light: THREE.PointLight

  wake: FadingLine

  sceneBinding:
    VesselSceneBinding

  phase: number

  signalIntensity: number
}

export function createVessel(): Vessel {
  const root =
    new THREE.Group()

  const visualRoot =
    new THREE.Group()

  root.add(visualRoot)

  const coreMaterial =
    new THREE.MeshStandardMaterial({
      color: '#ff6a20',

      emissive: '#ff4e0b',

      emissiveIntensity: 6.5,

      roughness: 0.18,

      metalness: 0.05,
    })

  const core =
    new THREE.Mesh(
      new THREE.BoxGeometry(
        0.055,
        0.055,
        0.76,
      ),
      coreMaterial,
    )

  core.position.z =
    -0.10

  core.position.y =
    0.035

  visualRoot.add(core)

  const noseMaterial =
    new THREE.MeshStandardMaterial({
      color: '#ff9253',

      emissive: '#ff5b16',

      emissiveIntensity: 8,

      roughness: 0.12,

      metalness: 0.05,
    })

  const nose =
    new THREE.Mesh(
      new THREE.OctahedronGeometry(
        0.075,
        0,
      ),
      noseMaterial,
    )

  nose.position.set(
    0,
    0.025,
    -0.66,
  )

  visualRoot.add(nose)

  const beam =
    createBeam()

  beam.position.set(
    0,
    0.025,
    -0.63,
  )

  visualRoot.add(beam)

  const light =
    new THREE.PointLight(
      '#ff5316',
      0.75,
      2.2,
      2,
    )

  light.position.set(
    0,
    0.08,
    -0.15,
  )

  visualRoot.add(light)

  const wake =
    createFadingLine(
      '#ff6a20',
    )

  visualRoot.add(wake)

  const hitArea =
    new THREE.Mesh(
      new THREE.SphereGeometry(
        0.62,
        8,
        8,
      ),

      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      }),
    )

  root.add(hitArea)

  const phase =
    Math.random() *
    Math.PI *
    2

  const vessel: Vessel = {
    root,
    visualRoot,
    hitArea,
    core,
    nose,
    beam,
    light,
    wake,

    sceneBinding: {
      id: '',

      sceneX: 0,
      sceneZ: 0,

      source: 'gfw',

      towardX: null,
      towardZ: null,
    },

    phase,

    signalIntensity:
      1,

    kind: 'vessel',

    hovered: false,
    selected: false,

    ghostLines: [
      'unknown ship',
    ],

    ghostMeta:
      'the speed was not in the record',
  }

  hitArea.userData
    .interactionTarget =
    vessel

  return vessel
}
