import * as THREE from 'three'

import type {
  InteractiveEntity,
} from './types'

interface InteractionOptions {
  canvas:
    HTMLCanvasElement

  camera:
    THREE.PerspectiveCamera

  targets:
    THREE.Object3D[]

  onSelect:
    (
      entity:
        InteractiveEntity,
    ) => void

  onClear:
    () => void
}

const pointer =
  new THREE.Vector2()

const raycaster =
  new THREE.Raycaster()

export function createInteraction(
  options:
    InteractionOptions,
) {
  let hovered:
    InteractiveEntity |
    null =
    null

  let selected:
    InteractiveEntity |
    null =
    null

  let targets =
    options.targets

  // Mirror canvas vessels with native keyboard buttons at their screen positions.
  // Acoustic records already have their own native detection-label buttons.
  const keyboardLayer = document.createElement('div')
  keyboardLayer.className = 'scene-keyboard-targets'
  keyboardLayer.setAttribute('role', 'group')
  keyboardLayer.setAttribute('aria-label', 'Vessels in the current view')
  document.body.append(keyboardLayer)
  const keyboardTargets = new Map<InteractiveEntity, HTMLButtonElement>()
  const projectedPosition = new THREE.Vector3()

  function syncKeyboardTargets() {
    const entities = new Set(targets.map(target => target.userData.interactionTarget as InteractiveEntity)
      .filter(entity => entity?.kind === 'vessel'))
    for (const [entity, button] of keyboardTargets) {
      if (!entities.has(entity)) { button.remove(); keyboardTargets.delete(entity) }
    }
    for (const entity of entities) {
      if (keyboardTargets.has(entity)) continue
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'scene-keyboard-target'
      button.setAttribute('aria-label', `Inspect vessel: ${entity.ghostLines[0] ?? 'Vessel record'}`)
      button.setAttribute('aria-description', 'Press Enter or Space to read this vessel record. Escape dismisses the reading.')
      button.addEventListener('pointerenter', () => setHovered(entity))
      button.addEventListener('pointerleave', () => setHovered(null))
      button.addEventListener('focus', () => setHovered(entity))
      button.addEventListener('blur', () => setHovered(null))
      button.addEventListener('click', () => setSelected(entity))
      keyboardLayer.append(button)
      keyboardTargets.set(entity, button)
    }
  }

  function updateKeyboardTargets() {
    const rect = options.canvas.getBoundingClientRect()
    for (const [entity, button] of keyboardTargets) {
      let visible = true
      entity.root.traverseAncestors(parent => { if (!parent.visible) visible = false })
      entity.root.getWorldPosition(projectedPosition).project(options.camera)
      button.hidden = !visible || !entity.root.visible || Math.abs(projectedPosition.x) > 1 || Math.abs(projectedPosition.y) > 1 || Math.abs(projectedPosition.z) > 1
      button.style.left = `${rect.left + (projectedPosition.x + 1) * rect.width / 2}px`
      button.style.top = `${rect.top + (1 - projectedPosition.y) * rect.height / 2}px`
    }
  }

  function getEntityAt(
    event:
      PointerEvent,
  ) {
    const rect =
      options.canvas
        .getBoundingClientRect()

    pointer.x =
      (
        (
          event.clientX -
          rect.left
        ) /
          rect.width
      ) *
        2 -
      1

    pointer.y =
      -(
        (
          event.clientY -
          rect.top
        ) /
          rect.height
      ) *
        2 +
      1

    raycaster.setFromCamera(
      pointer,
      options.camera,
    )

    const intersections =
      raycaster.intersectObjects(
        targets,
        false,
      )

    for (
      const intersection
      of intersections
    ) {
      const entity =
        intersection.object
          .userData
          .interactionTarget as
          InteractiveEntity |
          undefined

      if (entity) {
        return entity
      }
    }

    return null
  }

  function setHovered(
    entity:
      InteractiveEntity |
      null,
  ) {
    if (
      hovered === entity
    ) {
      return
    }

    if (hovered) {
      hovered.hovered =
        false
    }

    hovered = entity

    if (hovered) {
      hovered.hovered =
        true
    }

    options.canvas.style.cursor =
      hovered
        ? 'crosshair'
        : 'default'
  }

  function setSelected(
    entity:
      InteractiveEntity |
      null,
  ) {
    if (
      selected === entity
    ) {
      if (selected) {
        options.onSelect(selected)
      }

      return
    }

    if (selected) {
      selected.selected =
        false
    }

    selected = entity

    if (selected) {
      selected.selected =
        true

      options.onSelect(
        selected,
      )
    } else {
      options.onClear()
    }
  }

  function onPointerMove(
    event:
      PointerEvent,
  ) {
    setHovered(
      getEntityAt(event),
    )
  }

  function onPointerLeave() {
    setHovered(null)
  }

  function onPointerDown(
    event:
      PointerEvent,
  ) {
    setSelected(
      getEntityAt(event),
    )
  }

  function onKeyDown(
    event:
      KeyboardEvent,
  ) {
    if (
      event.key ===
      'Escape'
    ) {
      setSelected(null)
    }
  }

  options.canvas
    .addEventListener(
      'pointermove',
      onPointerMove,
    )

  options.canvas
    .addEventListener(
      'pointerleave',
      onPointerLeave,
    )

  options.canvas
    .addEventListener(
      'pointerdown',
      onPointerDown,
    )

  window.addEventListener(
    'keydown',
    onKeyDown,
  )

  return {
    updateKeyboardTargets,
    get selected() {
      return selected
    },

    select(
      entity:
        InteractiveEntity,
    ) {
      setSelected(entity)
    },

    clear() {
      setSelected(null)
    },

    setTargets(
      next:
        THREE.Object3D[],
    ) {
      targets = next
      syncKeyboardTargets()
      updateKeyboardTargets()
    },
  }
}
