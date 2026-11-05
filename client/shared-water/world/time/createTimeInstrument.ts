import {
  timelineEvents,
} from './timelineEvents'

interface TimeInstrumentOptions {
  initialProgress: number

  visible?: boolean

  getLabel:
    (progress: number) =>
      string

  onChange:
    (progress: number) =>
      void

  onPlayChange?:
    (playing: boolean) =>
      void
}

function pointOnArc(
  progress: number,
) {
  const x =
    4 +
    progress * 92

  const y =
    54 -
    80 *
      progress *
      (1 - progress)

  return {
    x,
    y,
  }
}

export function createTimeInstrument(
  options:
    TimeInstrumentOptions,
) {
  const root =
    document.createElement(
      'div',
    )

  root.className =
    'time-instrument'

  root.hidden =
    options.visible ===
    false

  root.setAttribute('role', 'group')
  root.setAttribute('aria-label', 'Story timeline')
  root.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown Home End PageUp PageDown')
  const slider = document.createElement('div')
  slider.className = 'time-slider'
  slider.tabIndex = 0
  slider.setAttribute('aria-description', 'Left and Right visit chapters. Up or Home goes to the beginning. Down or End goes to the end.')

  slider.setAttribute(
    'role',
    'slider',
  )

  slider.setAttribute(
    'aria-label',
    'Historical time',
  )

  slider.setAttribute(
    'aria-valuemin',
    '0',
  )

  slider.setAttribute(
    'aria-valuemax',
    '100',
  )

  const svg =
    document.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg',
    )

  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.setAttribute(
    'viewBox',
    '0 0 100 66',
  )

  svg.classList.add(
    'time-svg',
  )

  const path =
    document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path',
    )

  path.setAttribute(
    'd',
    'M 4 54 Q 50 14 96 54',
  )

  path.classList.add(
    'time-filament',
  )

  svg.appendChild(path)

  const transport = document.createElement('div')
  transport.className = 'time-transport'
  transport.setAttribute('role', 'group')
  transport.setAttribute('aria-label', 'Story playback controls')

  const makeTransportButton = (
    label: string,
    glyph: string,
    className: string,
    action: () => void,
    onDoubleClick?: () => void,
  ) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `time-transport__button ${className}`
    button.setAttribute('aria-label', label)
    button.textContent = glyph
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      if (onDoubleClick && event.detail > 1) return
      if (button.getAttribute('aria-disabled') === 'true') return
      action()
    })
    if (onDoubleClick) button.addEventListener('dblclick', event => {
      event.stopPropagation()
      onDoubleClick()
    })
    button.addEventListener('pointerdown', (event) => event.stopPropagation())
    return button
  }

  const previousStep = makeTransportButton('Previous Story step', '←', 'time-transport__previous', () => step(-1), () => change(0))
  const playPause = makeTransportButton('Play story', '▶', 'time-transport__play', () => {
    cancelScrub()
    playing = !playing
    renderPlayback()
    options.onPlayChange?.(playing)
  })
  const nextStep = makeTransportButton('Next Story step', '→', 'time-transport__next', () => step(1), () => change(1))
  transport.append(previousStep, playPause, nextStep)

  /*
   * Event marks.
   */
  for (
    const event
    of timelineEvents
  ) {
    const point =
      pointOnArc(
        event.progress,
      )

    const mark =
      document.createElementNS(
        'http://www.w3.org/2000/svg',
        'circle',
      )

    mark.setAttribute(
      'cx',
      String(point.x),
    )

    mark.setAttribute(
      'cy',
      String(point.y),
    )

    mark.setAttribute('r', event.kind === 'detection' ? '0.85' : '0.75')
    const eventMarkProgress = event.progress
    mark.dataset.progress = String(eventMarkProgress)

    mark.classList.add(
      'time-event',
      `time-event--${event.kind}`,
    )

    mark.setAttribute('role', 'button')
    mark.setAttribute('tabindex', '0')
    mark.setAttribute('aria-label', `${event.title} · ${event.timeLabel}`)
    mark.setAttribute('aria-description', 'Scrub to this Story chapter. Press Enter or Space.')
    mark.addEventListener('keydown', key => {
      if (key.key !== 'Enter' && key.key !== ' ') return
      key.preventDefault()
      key.stopPropagation()
      showReadout()
      scrubTo(eventMarkProgress)
      hideReadoutLater()
    })

    const preview = () => {
      if (dragging) return
      previewProgress = eventMarkProgress
      showReadout()
      readout.textContent = options.getLabel(eventMarkProgress)
    }
    const endPreview = () => {
      previewProgress = null
      render()
      hideReadoutLater()
    }
    mark.addEventListener('pointerenter', preview)
    mark.addEventListener('pointerleave', endPreview)
    mark.addEventListener('focus', preview)
    mark.addEventListener('blur', endPreview)

    svg.appendChild(mark)
  }

  const bead =
    document.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle',
    )

  bead.classList.add(
    'time-bead',
  )

  bead.setAttribute('r', '1.05')
  svg.appendChild(bead)

  const readout =
    document.createElement(
      'div',
    )

  readout.className =
    'time-readout'

  root.append(
    slider,
    svg,
    transport,
    readout,
  )

  document.body.appendChild(
    root,
  )

  let progress =
    options.initialProgress

  let previewProgress: number | null = null
  let dragging = false
  let activePointer: number | null = null
  let downX = 0
  let downY = 0
  let pendingMark: number | null = null
  let moved = false
  let frozenTransform = ''
  let frozenTransition = ''

  function finishDrag() {
    const pointer = activePointer
    activePointer = null
    dragging = false
    pendingMark = null
    root.style.transform = frozenTransform
    root.style.transition = frozenTransition
    if (pointer !== null && root.hasPointerCapture(pointer)) root.releasePointerCapture(pointer)
    hideReadoutLater()
  }
  let playing = false
  let scrubFrame: number | null = null
  let scrubTarget: number | null = null
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')

  function cancelScrub() {
    if (scrubFrame !== null) window.cancelAnimationFrame(scrubFrame)
    scrubFrame = null
    scrubTarget = null
  }

  function scrubTo(next: number) {
    const from = progress
    cancelScrub()
    if (motionPreference.matches) {
      change(next)
      return
    }
    change(from) // Pause playback before beginning the scrub.
    scrubTarget = next
    const started = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 650)
      const eased = t * t * (3 - 2 * t)
      applyProgress(t === 1 ? next : from + (next - from) * eased)
      if (t < 1) scrubFrame = window.requestAnimationFrame(tick)
      else { scrubFrame = null; scrubTarget = null }
    }
    scrubFrame = window.requestAnimationFrame(tick)
  }

  motionPreference.addEventListener('change', () => {
    if (!motionPreference.matches || scrubTarget === null) return
    const destination = scrubTarget
    cancelScrub()
    change(destination)
  })

  function renderPlayback() {
    playPause.textContent = playing ? '⏸︎' : '▶'
    playPause.setAttribute('aria-label', playing ? 'Pause story' : 'Play story')
    playPause.setAttribute('aria-description', 'Start or pause automatic Story playback.')
    root.classList.toggle('is-playing', playing)
  }

  renderPlayback()

  let fadeTimer:
    number | null =
    null

  function showReadout() {
    root.classList.add(
      'is-active',
    )

    readout.classList.add(
      'is-visible',
    )

    if (
      fadeTimer !== null
    ) {
      window.clearTimeout(
        fadeTimer,
      )
    }
  }

  function hideReadoutLater() {
    if (
      fadeTimer !== null
    ) {
      window.clearTimeout(
        fadeTimer,
      )
    }

    fadeTimer =
      window.setTimeout(
        () => {
          if (playing || previewProgress !== null || dragging) return
          readout.classList.remove(
            'is-visible',
          )

          if (!dragging) {
            root.classList.remove(
              'is-active',
            )
          }
        },
        1100,
      )
  }

  function adjacentStep(direction: -1 | 1) {
    const anchor = scrubTarget ?? progress
    return direction === -1
      ? [...timelineEvents].reverse().find(item => item.progress < anchor - 0.0001)
      : timelineEvents.find(item => item.progress > anchor + 0.0001)
  }

  function step(direction: -1 | 1) {
    const target = adjacentStep(direction)
    showReadout()
    scrubTo(target?.progress ?? (direction === -1 ? 0 : 1))
    hideReadoutLater()
  }

  function render() {
    const previous = adjacentStep(-1)
    const next = adjacentStep(1)
    previousStep.setAttribute('aria-disabled', String(progress <= 0))
    nextStep.setAttribute('aria-disabled', String(progress >= 1))
    previousStep.setAttribute('aria-description', `${previous ? `Previous step: ${previous.title}` : 'Beginning of Story'} · double-click for beginning`)
    nextStep.setAttribute('aria-description', `${next ? `Next step: ${next.title}` : 'End of Story'} · double-click for end`)

    const point =
      pointOnArc(
        progress,
      )

    bead.setAttribute(
      'cx',
      String(point.x),
    )

    bead.setAttribute(
      'cy',
      String(point.y),
    )

    const label =
      options.getLabel(
        progress,
      )

    readout.textContent = previewProgress !== null && !dragging
      ? options.getLabel(previewProgress)
      : label

    slider.setAttribute(
      'aria-valuenow',
      String(
        Math.round(
          progress * 100,
        ),
      ),
    )

    slider.setAttribute(
      'aria-valuetext',
      label,
    )
  }

  function change(
    next: number,
  ) {
    cancelScrub()
    // Every manual navigation pauses; playback itself uses setProgress.
    if (playing) {
      playing = false
      renderPlayback()
      options.onPlayChange?.(false)
    }
    applyProgress(next)
  }

  function applyProgress(next: number) {
    progress =
      Math.min(
        1,
        Math.max(
          0,
          next,
        ),
      )

    options.onChange(progress)
    render()
  }

  function progressFromPointer(
    event:
      PointerEvent,
  ) {
    const matrix =
      svg.getScreenCTM()

    if (!matrix) {
      return progress
    }

    const point =
      svg.createSVGPoint()

    point.x =
      event.clientX

    point.y =
      event.clientY

    /*
     * Screen position → viewBox.
     * The arc runs x = 4…96.
     */
    const local =
      point.matrixTransform(
        matrix.inverse(),
      )

    return (
      local.x - 4
    ) / 92
  }

  root.addEventListener(
    'pointerenter',
    () => {
      root.classList.add(
        'is-active',
      )
    },
  )

  root.addEventListener(
    'pointerleave',
    () => {
      if (!dragging) {
        hideReadoutLater()
      }
    },
  )

  root.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || activePointer !== null) return
    event.preventDefault()
    slider.focus({ preventScroll: true })
    // Freeze the current visual size, even halfway through the hover tween.
    // This keeps screen-to-time mapping stable for the whole gesture.
    const transform = getComputedStyle(root).transform
    frozenTransform = root.style.transform
    frozenTransition = root.style.transition
    root.style.transition = 'none'
    root.style.transform = transform
    activePointer = event.pointerId
    dragging = true
    downX = event.clientX
    downY = event.clientY
    moved = false
    const mark = event.target instanceof Element ? event.target.closest('.time-event') : null
    pendingMark = mark ? Number(mark.getAttribute('data-progress')) : null
    root.setPointerCapture(event.pointerId)
    showReadout()
    change(pendingMark === null ? progressFromPointer(event) : progress)
  })

  root.addEventListener('pointermove', event => {
    if (event.pointerId !== activePointer) return
    if (!moved && Math.hypot(event.clientX - downX, event.clientY - downY) < 4) return
    moved = true
    change(progressFromPointer(event))
  })

  root.addEventListener('pointerup', event => {
    if (event.pointerId !== activePointer) return
    const chapter = pendingMark
    const click = !moved && chapter !== null
    if (!click) change(progressFromPointer(event))
    finishDrag()
    if (click) scrubTo(chapter)
  })

  root.addEventListener('pointercancel', event => {
    if (event.pointerId === activePointer) finishDrag()
  })
  root.addEventListener('lostpointercapture', event => {
    if (event.pointerId === activePointer) finishDrag()
  })

  root.addEventListener(
    'keydown',
    (event) => {
      if (root.hidden || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]')) return
      let delta = 0

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        step(event.key === 'ArrowLeft' ? -1 : 1)
        return
      }

      if (['ArrowUp', 'Home', 'ArrowDown', 'End'].includes(event.key)) {
        event.preventDefault()
        showReadout()
        change(event.key === 'ArrowUp' || event.key === 'Home' ? 0 : 1)
        hideReadoutLater()
        return
      }

      if (
        event.key ===
        'PageDown'
      ) {
        delta = -0.04
      }

      if (
        event.key ===
        'PageUp'
      ) {
        delta = 0.04
      }

      if (delta === 0) {
        return
      }

      event.preventDefault()

      showReadout()

      change(
        progress +
        delta,
      )

      hideReadoutLater()
    },
  )

  render()

  return {
    setProgress(
      next: number,
    ) {
      cancelScrub()
      progress = next
      render()
    },

    setPlaying(next: boolean) {
      cancelScrub()
      playing = next
      renderPlayback()
    },

    setVisible(
      visible: boolean,
    ) {
      root.hidden =
        !visible

      if (!visible) {
        if (activePointer !== null) finishDrag()
        cancelScrub()
        root.classList.remove(
          'is-active',
        )

        readout.classList.remove(
          'is-visible',
        )
      }
    },
  }
}
