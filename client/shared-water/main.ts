import './style.css'
import { renderSceneStartup } from './scene-startup'
import { loadSceneWithDeadline } from '../scene-load'
import { createApiReadiness } from '../api-readiness'
import { mountWarmup } from '../warmup-view'
import { createAisPreview } from '../ais-preview'
import { renderLanding } from './landing'
import type { SceneTimeMode } from './world/time/createSceneClock'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('Missing app element')

function readMode(): SceneTimeMode | null {
  const value = new URLSearchParams(location.search).get('mode')
  if (value === 'story' || value === 'live') return value
  return null
}

const mode = readMode()
const readiness = createApiReadiness()
// Loading or failed graphics are not a usable Story/Live reader.
const aisPreview = createAisPreview({ readiness, mode: 'intro', sitewide: true })
let sceneUnavailable = false
let pageEnded = false
// Wait for a visible, non-prerendered page and a painted frame. No keepalive.
function startWhenVisible() {
  if (sceneUnavailable || pageEnded || document.visibilityState !== 'visible' || ('prerendering' in document && document.prerendering)) return
  document.removeEventListener('visibilitychange', startWhenVisible)
  document.removeEventListener('prerenderingchange', startWhenVisible)
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (sceneUnavailable || pageEnded) return
    if (document.visibilityState === 'visible') void readiness.start()
    else document.addEventListener('visibilitychange', startWhenVisible)
  }))
}
document.addEventListener('visibilitychange', startWhenVisible)
document.addEventListener('prerenderingchange', startWhenVisible)
startWhenVisible()
document.addEventListener('visibilitychange', () => aisPreview.setVisible(!document.hidden))
aisPreview.setVisible(!document.hidden)
for (const name of ['pointerdown', 'keydown', 'scroll', 'touchstart']) document.addEventListener(name, () => aisPreview.activity(), { passive: true, capture: true })
window.addEventListener('pagehide', () => { pageEnded = true; aisPreview.close(); readiness.close() })
window.addEventListener('pageshow', event => { if (event.persisted) location.reload() })

let stopWarmup = () => {}
if (!mode) stopWarmup = mountWarmup(document.body, readiness, aisPreview)

if (mode) {
  const removeLoading = renderSceneStartup(root)
  try {
    const { createWorld } = await loadSceneWithDeadline(() => import('./world/createWorld'))
    if (!pageEnded) {
      removeLoading()
      createWorld(root, {
        mode,
        readiness,
        aisPreview,
        onModeChange(next) {
          aisPreview.setMode(next)
          const url = new URL(location.href)
          url.searchParams.set('mode', next)
          history.replaceState(null, '', url)
        },
      })
      stopWarmup = mountWarmup(document.body, readiness, aisPreview)
      aisPreview.setMode(mode)
    }
  } catch {
    if (!pageEnded) {
      sceneUnavailable = true
      aisPreview.close()
      readiness.close()
      stopWarmup()
      document.removeEventListener('visibilitychange', startWhenVisible)
      document.removeEventListener('prerenderingchange', startWhenVisible)
      renderSceneStartup(root, true)
    }
  }
} else {
  renderLanding(root, readiness)
}
