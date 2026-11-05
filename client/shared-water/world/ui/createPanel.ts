// Non-modal side panels: the scene controls remain usable while reading.
let activePanel: { close: (restoreFocus?: boolean) => void } | null = null

export function createPanel(options: {
  element: HTMLElement
  trigger: HTMLButtonElement
  closeButton: HTMLButtonElement
  title: HTMLElement
  id: string
}) {
  const { element, trigger, closeButton, title, id } = options
  let opened = false
  element.id = id
  title.id = `${id}-title`
  element.setAttribute('role', 'dialog')
  element.setAttribute('aria-labelledby', title.id)
  trigger.setAttribute('aria-controls', id)
  trigger.setAttribute('aria-description', 'Open this side panel. Press Escape or use its close button to return.')
  closeButton.setAttribute('aria-description', 'Close this panel and return focus to its opening button.')

  function setOpen(value: boolean, restoreFocus = true) {
    if (value === opened) {
      if (value) closeButton.focus({ preventScroll: true })
      return
    }
    if (value) activePanel?.close(false)
    const focusWasInside = element.contains(document.activeElement)
    opened = value
    element.inert = !opened
    element.setAttribute('aria-hidden', String(!opened))
    element.classList.toggle('is-open', opened)
    trigger.classList.toggle('is-open', opened)
    trigger.setAttribute('aria-expanded', String(opened))
    if (opened) {
      activePanel = controller
      closeButton.focus({ preventScroll: true })
    } else {
      if (activePanel === controller) activePanel = null
      if (restoreFocus && focusWasInside) trigger.focus({ preventScroll: true })
    }
  }

  const controller = { close: (restoreFocus = true) => setOpen(false, restoreFocus) }
  element.inert = true
  element.setAttribute('aria-hidden', 'true')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.addEventListener('click', () => setOpen(!opened))
  closeButton.addEventListener('click', () => setOpen(false))
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && opened && !event.defaultPrevented) {
      event.preventDefault()
      setOpen(false)
    }
  })
  return { setOpen, get isOpen() { return opened } }
}
