import { mountLandingFeedback } from './landing-feedback'
import type { ApiReadiness } from '../api-readiness'

export function renderLanding(root: HTMLElement, _readiness: ApiReadiness) {
  const landing = document.createElement('div')
  landing.className = 'landing'
  landing.innerHTML = `
    <nav class="landing-modes" aria-label="Explore Shared Waters">
      <a class="landing-mode landing-mode--left" aria-label="Story" aria-description="Explore a week in September 2026 when right whales were detected in Zone A of the Gulf of St. Lawrence, alongside vessel activity and protection notices from the same period." href="/?mode=story">
        <span class="landing-mode-name">Story</span>
        <span class="landing-mode-description">Explore a week in September 2026 when right whales were detected in Zone A of the Gulf of St. Lawrence, alongside vessel activity and protection notices from the same period.</span>
        <span class="landing-mode-enter" aria-hidden="true"><span class="landing-mode-symbol"><span>⋆</span><span>˙</span><span>⟡</span></span><span class="landing-mode-arrow">←</span></span>
      </a>
      <a class="landing-mode landing-mode--right" aria-label="Live" aria-description="The latest available vessel positions, whale detections and sea conditions." href="/?mode=live">
        <span class="landing-mode-name">Live</span>
        <span class="landing-mode-description">The latest available vessel positions, whale detections, and sea conditions.</span>
        <span class="landing-mode-enter" aria-hidden="true"><span class="landing-mode-symbol"><span>𖥔</span><span> ݁ </span><span>˖</span></span><span class="landing-mode-arrow">→</span></span>
      </a>
    </nav>
    <header class="landing-intro">
      <h1 class="landing-title">Shared<br>Waters</h1>
      <p class="landing-description">An exploration of public records showing interactions between human and animal systems.</p>
      <p class="landing-description">Shared Waters brings whale detections, shipping activity, and protection notices together in one small part of the Gulf of St. Lawrence.</p>
      <p class="intro-guide">Follow seven days in Story, or see the latest available records in Live.</p>
    </header>
    <footer class="landing-note"><a class="landing-system" href="/system">Behind Shared Waters ↗</a></footer>`
  root.replaceChildren(landing)
  landing.querySelectorAll<HTMLAnchorElement>('.landing-mode').forEach(mountLandingFeedback)
}
