import * as THREE from 'three'
import { ghostTextPosition } from './ghostTextPosition'
import { animateSceneText } from '../ui/animateSceneText'

import type {
  InteractiveEntity,
} from './types'

const worldPosition =
  new THREE.Vector3()

const projected =
  new THREE.Vector3()

function animateIn(
  character: HTMLElement,
  delay: number,
  settleX: number,
  settleY: number,
  settleRotation: number,
  settleScale: number,
) {
  animateSceneText(character,
    [
      {
        opacity: 0,
        filter: 'blur(22px)',
        transform:
          'translate(0px, 14px) rotate(0deg) scale(1.08)',
      },

      {
        opacity: 1,
        filter: 'blur(0px)',
        transform: `
          translate(
            ${settleX}px,
            ${settleY}px
          )
          rotate(
            ${settleRotation}deg
          )
          scale(
            ${settleScale}
          )
        `,
      },
    ],
    {
      duration:
        1000 +
        Math.random() * 120,

      delay,

      easing:
        'cubic-bezier(0.16, 1, 0.3, 1)',

      fill: 'forwards',
    },
  )
}

function animateOut(
  character: HTMLElement,
) {
  const settleX =
    Number(
      character.dataset.settleX ??
      0,
    )

  const settleY =
    Number(
      character.dataset.settleY ??
      0,
    )

  const settleRotation =
    Number(
      character.dataset.settleRotation ??
      0,
    )

  const settleScale =
    Number(
      character.dataset.settleScale ??
      1,
    )

  const x =
    (Math.random() - 0.5) *
    40

  const y =
    -10 -
    Math.random() * 34

  const rotation =
    (Math.random() - 0.5) *
    20

  const delay =
    Math.random() * 300

  animateSceneText(character,
    [
      {
        opacity: 1,
        filter: 'blur(0px)',
        transform: `
          translate(
            ${settleX}px,
            ${settleY}px
          )
          rotate(
            ${settleRotation}deg
          )
          scale(
            ${settleScale}
          )
        `,
      },

      {
        opacity: 0,
        filter: 'blur(9px)',
        transform: `
          translate(
            ${settleX + x}px,
            ${settleY + y}px
          )
          rotate(
            ${settleRotation + rotation}deg
          )
          scale(
            ${settleScale}
          )
        `,
      },
    ],
    {
      duration: 1400,
      delay,
      easing:
        'cubic-bezier(0.4, 0, 0.2, 1)',
      fill: 'forwards',
    },
  )
}

export function createGhostText() {
  const layer =
    document.createElement('div')

  layer.className =
    'ghost-layer'

  const message =
    document.createElement('div')

  message.className =
    'ghost-message'

  message.setAttribute(
    'aria-live',
    'polite',
  )

  layer.appendChild(message)
  document.body.appendChild(layer)

  const freeAnchor =
    new THREE.Object3D()

  let entity:
    InteractiveEntity | null =
    null

  let eventId = 0

  let dissolveTimeout:
    number | null =
    null

  let finishTimeout:
    number | null =
    null

  function clearTimers() {
    if (dissolveTimeout !== null) {
      window.clearTimeout(
        dissolveTimeout,
      )
    }

    if (finishTimeout !== null) {
      window.clearTimeout(
        finishTimeout,
      )
    }

    dissolveTimeout = null
    finishTimeout = null
  }

  function createCharacters(
    text: string,
    className: string,
    lineIndex: number,
    prose = false,
  ) {
    const line =
      document.createElement('div')

    line.className =
      className
    line.setAttribute('aria-hidden', 'true')

    if (prose) {
      const block =
        document.createElement('span')

      block.className =
        'ghost-character'

      block.textContent =
        text

      animateIn(
        block,
        40,
        0,
        0,
        0,
        1,
      )

      line.appendChild(block)

      return line
    }

    for (
      let i = 0;
      i < text.length;
      i++
    ) {
      const character =
        document.createElement('span')

      character.className =
        'ghost-character'

      character.textContent =
        text[i] === ' '
          ? '\u00a0'
          : text[i]

      const isMeta =
        className === 'ghost-meta'

      const settleX =
        isMeta
          ? 0
          : (Math.random() - 0.5) * 0.8

      const settleY =
        isMeta
          ? (Math.random() - 0.5) * 0.8
          : (Math.random() - 0.5) * 1.8

      const settleRotation =
        isMeta
          ? 0
          : (Math.random() - 0.5) * 0.35

      const settleScale =
        isMeta
          ? 1
          : 0.997 +
            Math.random() * 0.006

      character.dataset.settleX =
        String(settleX)

      character.dataset.settleY =
        String(settleY)

      character.dataset.settleRotation =
        String(settleRotation)

      character.dataset.settleScale =
        String(settleScale)

      const timingJitter =
        isMeta
          ? Math.random() * 35
          : Math.random() * 55

      const characterDelay =
        lineIndex * 70 +
        i * 18 +
        timingJitter

      animateIn(
        character,
        characterDelay,
        settleX,
        settleY,
        settleRotation,
        settleScale,
      )

      line.appendChild(
        character,
      )
    }

    return line
  }

  function destroy() {
    clearTimers()

    entity = null

    message.className =
      'ghost-message'

    message.replaceChildren()
  }

  function show(
    nextEntity:
      InteractiveEntity,
    prose = false,
  ) {
    destroy()

    entity = nextEntity
    const reading = document.createElement('p')
    reading.className = 'sr-only'
    reading.textContent = [...nextEntity.ghostLines, nextEntity.ghostMeta].filter(Boolean).join('. ')
    message.append(reading)

    if (prose) {
      message.classList.add(
        'is-answer',
      )
    }

    const currentEvent =
      ++eventId

    for (
      let i = 0;
      i <
      nextEntity.ghostLines.length;
      i++
    ) {
      message.appendChild(
        createCharacters(
          nextEntity.ghostLines[i],
          'ghost-line',
          i,
          prose,
        ),
      )
    }

    if (nextEntity.ghostMeta) {
      message.appendChild(
        createCharacters(
          nextEntity.ghostMeta,
          'ghost-meta',
          nextEntity.ghostLines.length,
        ),
      )
    }

    requestAnimationFrame(() => {
      if (
        currentEvent !== eventId
      ) {
        return
      }

      message.classList.add(
        'is-visible',
      )
    })

    dissolveTimeout =
      window.setTimeout(
        () => {
          if (
            currentEvent !== eventId
          ) {
            return
          }

          const characters =
            message.querySelectorAll<HTMLElement>(
              '.ghost-character',
            )

          for (
            const character of Array.from(
              characters,
            )
          ) {
            animateOut(character)
          }

          finishTimeout =
            window.setTimeout(
              () => {
                if (
                  currentEvent !==
                  eventId
                ) {
                  return
                }

                destroy()
              },
              1700,
            )
        },
        prose
          ? 12000
          : 4200,
      )
  }

  function hide() {
    eventId++
    destroy()
  }

  function showFree(
    lines: string[],
    meta: string,
  ) {
    freeAnchor.position.set(
      0,
      1.2,
      -8,
    )

    const freeEntity:
      InteractiveEntity = {
      root:
        freeAnchor,

      hitArea:
        freeAnchor,

      kind:
        'system',

      hovered:
        false,

      selected:
        false,

      ghostLines:
        lines,

      ghostMeta:
        meta,
    }

    show(freeEntity)
  }

  function showAnswer(
    text: string,
  ) {
    freeAnchor.position.set(
      0,
      1.2,
      -8,
    )

    show(
      {
        root:
          freeAnchor,

        hitArea:
          freeAnchor,

        kind:
          'system',

        hovered:
          false,

        selected:
          false,

        ghostLines:
          [text],

        ghostMeta:
          '',
      },
      true,
    )
  }

  function showAt(
    anchor: THREE.Object3D,
    lines: string[],
    meta: string,
  ) {
    show({
      root: anchor,
      hitArea: anchor,
      kind: 'detection',
      hovered: false,
      selected: false,
      ghostLines: lines,
      ghostMeta: meta,
    })
  }

  function update(
    camera:
      THREE.PerspectiveCamera,
  ) {
    if (!entity) {
      return
    }

    entity.root.getWorldPosition(
      worldPosition,
    )

    worldPosition.y += 0.8

    projected
      .copy(worldPosition)
      .project(camera)

    if (
      projected.z < -1 ||
      projected.z > 1
    ) {
      message.style.visibility =
        'hidden'

      return
    }

    message.style.visibility =
      'visible'

    const x =
      (
        projected.x * 0.5 +
        0.5
      ) *
      window.innerWidth

    const y =
      (
        -projected.y * 0.5 +
        0.5
      ) *
      window.innerHeight

    const controlsTop = Math.min(window.innerHeight, ...
      Array.from(document.querySelectorAll<HTMLElement>('.time-instrument, .question-orb'))
        .filter(element => !element.hidden)
        .map(element => element.getBoundingClientRect().top))
    const markerTop = entity.kind === 'detection'
      ? Math.min(window.innerHeight, ...Array.from(document.querySelectorAll<HTMLElement>('.detection-label:not([hidden])'))
          .map(element => element.getBoundingClientRect().top))
      : window.innerHeight
    const { x: safeX, y: safeY } = ghostTextPosition(x, y,
      window.innerWidth, window.innerHeight, message.offsetWidth, message.offsetHeight, controlsTop, markerTop)

    message.style.left =
      `${safeX}px`

    message.style.top =
      `${safeY}px`
  }

  return {
    show,
    showFree,
    showAnswer,
    showAt,
    hide,
    update,

    get entity() {
      return entity
    },
  }
}
