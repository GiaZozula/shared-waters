import { animateSceneText } from '../ui/animateSceneText'

interface QuestionOrbOptions<TContext = undefined> {
  onSubmit:
    (
      question: string,
      context: TContext,
    ) => Promise<boolean | void> | boolean | void

  getSubmitContext?: () => TContext

  examples?: string[]

  getExamples?: () => string[]

  onOpen?: () => void
  onAbsorb?: () => void
  onComplete?: () => void
}

function animateExampleIn(
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

function animateExampleOut(
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

export function createQuestionOrb<TContext = undefined>(
  options: QuestionOrbOptions<TContext>,
) {
  const root =
    document.createElement(
      'div',
    )

  root.className =
    'question-orb'

  const form =
    document.createElement(
      'form',
    )

  form.className =
    'question-orb__form'

  const membrane =
    document.createElement(
      'div',
    )

  membrane.className =
    'question-orb__membrane'

  const textEcho =
    document.createElement(
      'div',
    )

  textEcho.className =
    'question-orb__echo'

  const input =
    document.createElement(
      'input',
    )

  input.className =
    'question-orb__input'

  input.type = 'text'
  input.maxLength = 2000

  input.autocomplete = 'off'
  input.spellcheck = false

  input.placeholder =
    'ask the water'

  input.setAttribute(
    'aria-label',
    'Ask about the scene',
  )

  const availability = document.createElement('p')
  availability.className = 'question-orb__availability'
  availability.id = 'question-availability'
  availability.textContent = 'Model questions need online services. Free explanations work locally.'
  const instructions = document.createElement('span')
  instructions.id = 'question-instructions'
  instructions.hidden = true
  instructions.textContent = 'Ask the water. Focus to open the question form. Type a question and press Enter to send, or Escape to close.'
  root.append(instructions)
  form.setAttribute('aria-label', 'Ask the water')
  input.setAttribute('aria-describedby', `${instructions.id} ${availability.id}`)

  form.append(
    membrane,
    textEcho,
    input,
  )

  const examples =
    document.createElement(
      'div',
    )

  examples.className =
    'question-orb__examples'

  const help = document.createElement('div')
  help.className = 'question-orb__help'
  help.append(examples, availability)
  root.append(form, help)

  document.body.appendChild(
    root,
  )

  let expanded = false
  let working = false
  let submissionGeneration = 0
  let closingTimer: number | undefined
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  function clearClosingMotion() {
    window.clearTimeout(closingTimer)
    closingTimer = undefined
    root.classList.remove('is-closing')
  }
  function startClosingMotion() {
    clearClosingMotion()
    if (reducedMotion.matches) return
    root.classList.add('is-closing')
    closingTimer = window.setTimeout(clearClosingMotion, 740)
  }
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) clearClosingMotion()
  })

  let exampleSession = 0

  let exampleOpenTimer:
    number | null =
    null

  let exampleDissolveTimer:
    number | null =
    null

  let exampleRemoveTimer:
    number | null =
    null

  function clearExampleTimers() {
    if (
      exampleOpenTimer !==
      null
    ) {
      window.clearTimeout(
        exampleOpenTimer,
      )
    }

    if (
      exampleDissolveTimer !==
      null
    ) {
      window.clearTimeout(
        exampleDissolveTimer,
      )
    }

    if (
      exampleRemoveTimer !==
      null
    ) {
      window.clearTimeout(
        exampleRemoveTimer,
      )
    }

    exampleOpenTimer = null

    exampleDissolveTimer =
      null

    exampleRemoveTimer =
      null
  }

  function dismissExamples() {
    exampleSession++

    clearExampleTimers()

    root.classList.remove(
      'is-opening',
    )

    examples.classList.remove(
      'is-leaving',
    )

    examples.replaceChildren()
  }

  function showExamples() {
    examples.inert = false
    const phrases =
      options.getExamples?.() ??
      options.examples ?? []

    if (
      phrases.length === 0
    ) {
      return
    }

    const session =
      exampleSession

    examples.classList.remove(
      'is-leaving',
    )

    examples.replaceChildren()

    const characters:
      HTMLElement[] = []

    for (
      let lineIndex = 0;
      lineIndex < phrases.length;
      lineIndex++
    ) {
      const example =
        phrases[lineIndex]

      const button =
        document.createElement(
          'button',
        )

      button.type = 'button'
      button.setAttribute('aria-label', example)
      button.setAttribute('aria-description', 'Use this suggested question in the question form.')

      button.className =
        'question-orb__example'

      button.dataset.slot =
        String(lineIndex)

      button.addEventListener(
        'click',
        () => {
          input.value =
            example

          textEcho.textContent =
            example

          input.focus()
        },
      )

      for (
        let i = 0;
        i < example.length;
        i++
      ) {
        const character =
          document.createElement(
            'span',
          )

        character.className =
          'question-orb__example-character'

        character.textContent =
          example[i] === ' '
            ? '\u00a0'
            : example[i]

        const settleX =
          (Math.random() - 0.5) *
          0.8

        const settleY =
          (Math.random() - 0.5) *
          1.8

        const settleRotation =
          (Math.random() - 0.5) *
          0.35

        const settleScale =
          0.997 +
          Math.random() * 0.006

        character.dataset.settleX =
          String(settleX)

        character.dataset.settleY =
          String(settleY)

        character.dataset.settleRotation =
          String(settleRotation)

        character.dataset.settleScale =
          String(settleScale)

        animateExampleIn(
          character,
          lineIndex * 70 +
            i * 12 +
            Math.random() * 28,
          settleX,
          settleY,
          settleRotation,
          settleScale,
        )

        button.appendChild(
          character,
        )

        characters.push(
          character,
        )
      }

      examples.appendChild(
        button,
      )
    }

    exampleDissolveTimer =
      window.setTimeout(
        () => {
          if (
            session !==
            exampleSession
          ) {
            return
          }

          if (examples.contains(document.activeElement)) return
          examples.inert = true
          examples.classList.add(
            'is-leaving',
          )

          for (
            const character of characters
          ) {
            animateExampleOut(
              character,
            )
          }

          exampleRemoveTimer =
            window.setTimeout(
              () => {
                if (
                  session !==
                  exampleSession
                ) {
                  return
                }

                examples.classList.remove(
                  'is-leaving',
                )

                examples.replaceChildren()
              },
              1700,
            )
        },
        4200,
      )
  }

  function open() {
    if (working) {
      return
    }

    const focusAtOpen = document.activeElement
    clearClosingMotion()
    expanded = true

    dismissExamples()

    const session =
      exampleSession

    root.classList.add(
      'is-opening',
    )

    requestAnimationFrame(
      () => {
        root.classList.add(
          'is-open',
        )
      },
    )

    exampleOpenTimer =
      window.setTimeout(
        () => {
          exampleOpenTimer =
            null

          root.classList.remove(
            'is-opening',
          )

          if (
            !expanded ||
            session !==
              exampleSession
          ) {
            return
          }

          showExamples()
        },
        720,
      )

    window.setTimeout(
      () => {
        if (!expanded || session !== exampleSession || document.activeElement !== focusAtOpen) {
          return
        }

        input.focus()
      },
      360,
    )

    options.onOpen?.()
  }

  function close() {
    if (working || !expanded) {
      return
    }

    expanded = false

    dismissExamples()

    root.classList.remove(
      'is-open',
    )

    startClosingMotion()
    input.blur()
  }

  function setWorking(
    value: boolean,
  ) {
    working = value

    root.classList.toggle(
      'is-working',
      value,
    )

    input.disabled =
      value
  }

  async function absorbQuestion(
    question: string,
    generation: number,
  ) {
    const layer =
      document.createElement(
        'div',
      )

    layer.className =
      'question-orb__submission'

    for (
      let i = 0;
      i < question.length;
      i++
    ) {
      const character =
        document.createElement(
          'span',
        )

      character.textContent =
        question[i] === ' '
          ? '\u00a0'
          : question[i]

      layer.appendChild(
        character,
      )
    }

    form.appendChild(layer)

    const characters =
      Array.from(
        layer.querySelectorAll<HTMLElement>(
          'span',
        ),
      )

    input.style.visibility =
      'hidden'

    textEcho.style.visibility =
      'hidden'

    const animations =
      characters.map(
        (
          character,
          index,
        ) => {
          const distanceFromCenter =
            index -
            characters.length / 2

          return animateSceneText(character,
            [
              {
                opacity: 0.72,
                filter:
                  'blur(0.2px)',

                transform:
                  'translate(0, 0) scale(1)',
              },

              {
                opacity: 0.42,
                filter:
                  'blur(2px)',

                offset: 0.45,
              },

              {
                opacity: 0,
                filter:
                  'blur(11px)',

                transform: `
                translate(
                  ${-distanceFromCenter * 3.2}px,
                  2px
                )
                scale(
                  0.18,
                  0.72
                )
              `,
              },
            ],
            {
              duration:
                520 +
                Math.random() *
                  160,

              delay:
                Math.abs(
                  distanceFromCenter,
                ) *
                7,

              easing:
                'cubic-bezier(0.32, 0, 0.18, 1)',

              fill:
                'forwards',
            },
          )
        },
      )

    root.classList.add(
      'is-absorbing',
    )

    options.onAbsorb?.()

    await Promise.all(
      animations.map(
        animation =>
          animation.finished,
      ),
    )

    layer.remove()
    if (generation !== submissionGeneration) return

    input.value = ''
    textEcho.textContent =
      ''

    input.style.visibility =
      ''

    textEcho.style.visibility =
      ''

    root.classList.remove(
      'is-absorbing',
    )
  }

  root.addEventListener(
    'pointerdown',
    (event) => {
      if (
        expanded ||
        working
      ) {
        return
      }

      event.preventDefault()
      open()
    },
  )

  input.addEventListener('focus', open)

  input.addEventListener(
    'input',
    () => {
      textEcho.textContent =
        input.value
    },
  )

  input.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key ===
        'Escape'
      ) {
        event.preventDefault()
        close()
      }
    },
  )

  form.addEventListener(
    'submit',
    async (
      event,
    ) => {
      event.preventDefault()

      const question =
        input.value.trim()

      if (
        !question ||
        working
      ) {
        return
      }

      const context =
        options.getSubmitContext?.() as TContext
      const submissionId =
        ++submissionGeneration

      setWorking(true)

      dismissExamples()

      root.classList.add(
        'is-sending',
      )

      try {
        await absorbQuestion(
          question,
          submissionId,
        )

        if (submissionId !== submissionGeneration) {
          return
        }

        const completed = await options.onSubmit(
          question,
          context,
        )

        if (submissionId !== submissionGeneration) return
        if (completed === false) {
          expanded = false
          root.classList.remove('is-open')
          startClosingMotion()
          return
        }

        root.classList.add(
          'is-complete',
        )

        options.onComplete?.()

        await new Promise<void>(
          (resolve) => {
            window.setTimeout(
              resolve,
              520,
            )
          },
        )

        if (submissionId !== submissionGeneration) return
        expanded = false

        root.classList.remove(
          'is-open',
        )
        startClosingMotion()
      } finally {
        if (submissionId === submissionGeneration) {
          root.classList.remove('is-sending', 'is-complete')
          setWorking(false)
        }
      }
    },
  )

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (
        !expanded ||
        working
      ) {
        return
      }

      if (
        root.contains(
          event.target as Node,
        )
      ) {
        return
      }

      close()
    },
  )

  return {
    open,
    close,
    setAvailability(message: string) { availability.textContent = message },

    cancelPending() {
      if (!working) {
        return
      }

      submissionGeneration++
      expanded = false
      dismissExamples()
      root.classList.remove('is-open', 'is-sending', 'is-complete', 'is-absorbing')
      startClosingMotion()
      form.querySelectorAll('.question-orb__submission').forEach(layer => layer.remove())
      input.style.visibility = ''
      textEcho.style.visibility = ''
      input.value = ''
      textEcho.textContent = ''
      setWorking(false)
    },

    refreshExamples() {
      if (!expanded || working) {
        return
      }

      dismissExamples()
      showExamples()
    },
  }
}
