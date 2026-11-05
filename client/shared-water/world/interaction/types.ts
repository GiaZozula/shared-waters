import type * as THREE from 'three'

export type EntityKind =
  | 'vessel'
  | 'detection'
  | 'system'

export interface InteractiveEntity {
  root: THREE.Object3D

  hitArea: THREE.Object3D

  kind: EntityKind

  hovered: boolean
  selected: boolean

  ghostLines: string[]
  ghostMeta: string
}
