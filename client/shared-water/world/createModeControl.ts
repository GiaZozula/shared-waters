import type { SceneTimeMode } from './time/createSceneClock'

export function createModeControl({ mode, onSwitch }: {
  mode: SceneTimeMode | 'intro'; onSwitch?: () => void
}) {
  const nav = document.createElement('nav')
  nav.className = 'mode-control'
  nav.setAttribute('aria-label', 'Explore Shared Waters')
  const links = (['intro', 'story', 'live'] as const).map(destination => {
    const link = document.createElement('a')
    link.setAttribute('aria-label', destination === 'intro' ? 'Intro' : destination === 'story' ? 'Story' : 'Live')
    link.setAttribute('aria-description', destination === 'intro' ? 'Return to the project introduction.' : destination === 'story' ? 'Explore the historical records and timeline.' : 'Explore the latest available records and sea conditions.')
    link.href = destination === 'intro' ? '/' : `/?mode=${destination}`
    const label = document.createElement('span')
    label.textContent = destination.toUpperCase()
    link.append(label)
    link.addEventListener('click', event => {
      if (destination === currentMode) { event.preventDefault(); return }
      if (destination !== 'intro' && currentMode !== 'intro' && onSwitch) {
        event.preventDefault(); onSwitch()
      }
    })
    nav.append(link)
    return link
  })
  let currentMode = mode
  function show(next: typeof mode) {
    currentMode = next
    links.forEach((link, i) => {
      if (['intro', 'story', 'live'][i] === next) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    })
  }
  const systemLink = document.createElement('a')
  systemLink.href = '/system'
  systemLink.setAttribute('aria-label', 'System')
  systemLink.setAttribute('aria-description', 'Explore the services, status and source records.')
  const systemLabel = document.createElement('span')
  systemLabel.textContent = 'SYSTEM'
  systemLink.append(systemLabel)
  nav.append(systemLink)
  show(mode)
  document.body.append(nav)
  return { setMode: show }
}
