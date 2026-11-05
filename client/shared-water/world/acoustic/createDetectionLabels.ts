import * as THREE from 'three'

import type {
  Detection,
} from './createDetection'

interface DetectionLabel {
  detectionId:
    string

  element:
    HTMLDivElement

  button:
    HTMLButtonElement

  times: string[]
}

const SAME_SENSOR_DISTANCE = 2

function sharesSensor(
  a: Detection,
  b: Detection,
) {
  const dx =
    a.sceneBinding.sceneX -
    b.sceneBinding.sceneX

  const dz =
    a.sceneBinding.sceneZ -
    b.sceneBinding.sceneZ

  return (
    dx * dx +
    dz * dz
  ) <
    SAME_SENSOR_DISTANCE *
    SAME_SENSOR_DISTANCE
}

function uniqueSorted(
  values: string[],
) {
  return [
    ...new Set(values),
  ].sort()
}

export function createDetectionLabels(
  camera:
    THREE.Camera,
  onOpen: (anchor: THREE.Object3D, times: string[]) => void,
) {
  const labels =
    new Map<
      string,
      DetectionLabel
    >()

  const position =
    new THREE.Vector3()

  function sync(
    detections:
      Detection[],
  ) {
    const nextIds =
      new Set(
        detections.map(
          detection =>
            detection
              .sceneBinding
              .id,
        ),
      )

    for (
      const [
        id,
        label,
      ] of labels
    ) {
      if (
        nextIds.has(id)
      ) {
        continue
      }

      label.element.remove()
      labels.delete(id)
    }

    for (
      const detection
      of detections
    ) {
      const id =
        detection
          .sceneBinding
          .id

      if (
        labels.has(id)
      ) {
        continue
      }

      const element =
        document.createElement(
          'div',
        )

      element.className =
        'detection-label'

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'detection-label__button'
      const mark = document.createElement('span')
      mark.className = 'detection-label__mark'
      mark.textContent = '!'
      mark.setAttribute('aria-hidden', 'true')
      button.append(mark)
      button.setAttribute('aria-description', 'Open reviewed acoustic records and their source-local detection times.')
      button.setAttribute('aria-label', 'Show whale detections')

      button.addEventListener('click', () => {
        const current = detectionsById.get(id)
        if (current) onOpen(current.root, labels.get(id)?.times ?? [])
      })
      element.append(button)

      document.body.appendChild(
        element,
      )

      labels.set(
        id,
        {
          detectionId:
            id,
          element,
          button,
          times: [],
        },
      )
    }
  }

  let detectionsById = new Map<string, Detection>()

  function update(
    detections:
      Detection[],
  ) {
    detectionsById = new Map(detections.map(detection => [detection.sceneBinding.id, detection]))
    const byId =
      new Map(
        detections.map(
          detection => [
            detection
              .sceneBinding
              .id,
            detection,
          ],
        ),
      )

    const visible =
      detections.filter(
        detection =>
          detection.root.visible,
      )

    const leaderId =
      new Map<
        string,
        string
      >()

    for (
      const detection
      of visible
    ) {
      let leader =
        detection
          .sceneBinding
          .id

      for (
        const other
        of visible
      ) {
        if (
          !sharesSensor(
            detection,
            other,
          )
        ) {
          continue
        }

        if (
          other
            .sceneBinding
            .id <
          leader
        ) {
          leader =
            other
              .sceneBinding
              .id
        }
      }

      leaderId.set(
        detection
          .sceneBinding
          .id,
        leader,
      )
    }

    for (
      const [
        id,
        label,
      ] of labels
    ) {
      const detection =
        byId.get(id)

      if (!detection) {
        label.element.hidden =
          true

        continue
      }

      if (
        !detection.root.visible ||
        leaderId.get(id) !==
          id
      ) {
        label.element.hidden =
          true

        continue
      }

      const group =
        visible.filter(
          other =>
            leaderId.get(
              other
                .sceneBinding
                .id,
            ) ===
            id,
        )

      const times =
        uniqueSorted(
          group.map(
            other =>
              other
                .sceneBinding
                .sourceLocalTime,
          ),
        )

      label.times = times

      detection.root
        .getWorldPosition(
          position,
        )

      position.y +=
        0.42

      position.project(
        camera,
      )

      const onScreen =
        position.z > -1 &&
        position.z < 1

      label.element.hidden =
        !onScreen

      if (!onScreen) {
        continue
      }

      label.element.style.left =
        `${
          (
            position.x *
            0.5 +
            0.5
          ) *
          window.innerWidth
        }px`

      label.element.style.top =
        `${
          (
            -position.y *
            0.5 +
            0.5
          ) *
          window.innerHeight
        }px`

      label.button.classList.toggle(
        'is-selected',
        group.some(
          other =>
            other.selected,
        ),
      )
    }
  }

  return {
    sync,
    update,
  }
}
