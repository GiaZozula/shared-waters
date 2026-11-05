/** CSS reduced-motion rules do not affect Web Animations API lettering. */
export function animateSceneText(element: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions): Animation {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
  const animation = element.animate(frames, preference.matches ? { ...options, duration: 0, delay: 0 } : options)
  const finishWhenReduced = () => { if (preference.matches) animation.finish() }
  preference.addEventListener('change', finishWhenReduced)
  const cleanup = () => preference.removeEventListener('change', finishWhenReduced)
  void animation.finished.then(cleanup, cleanup)
  return animation
}
