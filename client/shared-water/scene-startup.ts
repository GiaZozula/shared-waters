import './scene-startup.css'

export function renderSceneStartup(root: HTMLElement, failed = false) {
  const panel = document.createElement('section')
  panel.className = 'scene-startup'
  panel.setAttribute('aria-labelledby', 'scene-startup-title')
  const title = document.createElement('h1')
  title.id = 'scene-startup-title'
  title.tabIndex = -1
  title.textContent = failed ? 'The water view couldn’t open' : 'Opening the water view…'
  const message = document.createElement('p')
  message.textContent = failed
    ? 'Your browser may not support the graphics, or part of the page could not be loaded. You can try again or explore the records without the water view.'
    : 'The scene is loading. You can return to Intro or read the records while you wait.'
  if (!failed) { message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite') }
  const actions = document.createElement('nav')
  actions.setAttribute('aria-label', 'Water view recovery')
  if (failed) {
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.textContent = 'Retry water view'
    retry.addEventListener('click', () => location.reload())
    actions.append(retry)
  }
  const intro = document.createElement('a')
  intro.href = '/'
  intro.textContent = 'Back to Intro'
  const records = document.createElement('a')
  records.href = '/system#records'
  records.textContent = 'Read source records'
  actions.append(intro, records)
  panel.append(title, message, actions)
  root.replaceChildren(panel)
  if (failed) title.focus({ preventScroll: true })
  return () => panel.remove()
}
