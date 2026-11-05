import * as THREE from 'three'

import {
  createAcousticPulse,
} from './createAcousticPulse'

import {
  createSpectralField,
} from './createSpectralField'

import type {
  InteractiveEntity,
} from '../interaction/types'

export interface DetectionSceneBinding {
  id: string

  sceneX: number
  sceneZ: number

  sourceLocalTime:
    string

  reviewDate: string

  sourceLabel: string

  limitation: string
}

export interface Detection
  extends InteractiveEntity {
  pulse: THREE.Mesh<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >

  spectralField:
    THREE.Points<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >

  platform: THREE.Mesh

  sceneBinding:
    DetectionSceneBinding

  revealStartedAt: number | null
  motionPreference: MediaQueryList
}

export function createDetection(): Detection {
  const root =
    new THREE.Group()

  const pulse =
    createAcousticPulse()

  pulse.raycast = () => {}

  root.add(pulse)

  const spectralField =
    createSpectralField()

  spectralField.raycast =
    () => {}

  root.add(
    spectralField,
  )

  const platformMaterial =
    new THREE.MeshStandardMaterial({
      color: '#041016',

      emissive: '#536d62',

      emissiveIntensity: 1.4,

      roughness: 0.3,

      metalness: 0.6,
    })

  const platform =
    new THREE.Mesh(
      new THREE.OctahedronGeometry(
        0.10,
        0,
      ),
      platformMaterial,
    )

  platform.position.y =
    0.08

  root.add(platform)

  const hitArea =
    new THREE.Mesh(
      new THREE.SphereGeometry(
        0.45,
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

  hitArea.position.y =
    0.08

  root.add(hitArea)

  const detection: Detection = {
    root,
    hitArea,
    pulse,
    spectralField,
    platform,

    sceneBinding: {
      id: '',

      sceneX: 0,
      sceneZ: 0,

      sourceLocalTime:
        '',

      reviewDate:
        '',

      sourceLabel:
        '',

      limitation:
        '',
    },

    revealStartedAt: null,
    motionPreference: window.matchMedia('(prefers-reduced-motion: reduce)'),

    kind: 'detection',

    hovered: false,
    selected: false,

    ghostLines: [
      'RIGHT WHALE',
      'DETECTED',
    ],

    ghostMeta:
      'acoustic detection',
  }

  hitArea.userData
    .interactionTarget =
    detection

  return detection
}
