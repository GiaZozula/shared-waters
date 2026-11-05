// Original stepped ripple trail; bounded, pointer-driven and idle when empty.
export function mountLandingFeedback(panel: HTMLAnchorElement) {
  const canvas = document.createElement('canvas')
  canvas.className = 'landing-contour'
  canvas.setAttribute('aria-hidden', 'true')
  panel.prepend(canvas)
  const context = canvas.getContext('2d')
  if (!context) return
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const lifetime = 760
  const rings: { x: number; y: number; born: number }[] = []
  let frame = 0, active = false, lastStamp = -Infinity
  function draw(time: number) {
    frame = 0
    const rect = panel.getBoundingClientRect()
    const dpr = Math.min(devicePixelRatio || 1, 2)
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr)
    }
    context!.setTransform(dpr, 0, 0, dpr, 0, 0)
    context!.clearRect(0, 0, rect.width, rect.height)
    while (rings.length && time - rings[0].born >= lifetime) rings.shift()
    for (const ring of rings) {
      const age = Math.max(0, (time - ring.born) / lifetime)
      const expansion = 1 - Math.pow(1 - age, 3)
      const radiusX = 28 + 66 * expansion
      const radiusY = 6 + 12 * expansion
      context!.strokeStyle = `rgba(217,220,209,${.48 * Math.pow(1 - age, 1.5)})`
      context!.lineWidth = 1
      context!.beginPath()
      let previousY = 0
      // Orthogonal, quantized joins retain the register's pixel-like linework.
      for (let i = 0; i <= 32; i++) {
        const angle = i / 32 * Math.PI * 2
        const px = Math.round((ring.x + Math.cos(angle) * radiusX) / 4) * 4
        const py = Math.round((ring.y + Math.sin(angle) * radiusY) / 4) * 4
        if (!i) context!.moveTo(px, py)
        else { context!.lineTo(px, previousY); context!.lineTo(px, py) }
        previousY = py
      }
      context!.closePath(); context!.stroke()
    }
    if (rings.length) frame = requestAnimationFrame(draw)
  }
  function stamp(event: PointerEvent) {
    if (!active || reduced.matches || document.hidden) return
    const rect = panel.getBoundingClientRect()
    const x = event.clientX - rect.left, y = event.clientY - rect.top, now = performance.now()
    if (now - lastStamp < 180) return
    // Shape-aware spacing avoids stacks of almost-identical horizontal traces.
    if (rings.some(ring => now - ring.born < lifetime && Math.hypot((x - ring.x) / 120, (y - ring.y) / 34) < 1)) return
    rings.push({ x, y, born: now })
    if (rings.length > 5) rings.shift()
    lastStamp = now
    if (!frame) frame = requestAnimationFrame(draw)
  }
  function clear() {
    active = false; rings.length = 0; cancelAnimationFrame(frame); frame = 0
    context!.clearRect(0, 0, canvas.width, canvas.height)
  }
  panel.addEventListener('pointerenter', event => { active = event.pointerType === 'mouse'; lastStamp = -Infinity; stamp(event) })
  panel.addEventListener('pointermove', stamp)
  panel.addEventListener('pointerleave', () => { active = false })
  reduced.addEventListener('change', clear)
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear() })
  window.addEventListener('pagehide', clear)
}
