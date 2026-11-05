import type { Vector3 } from 'three'

// Decorative moonlight, not an ephemeris. A gentle daily arc follows the same
// timestamp as daylight, centred near the original night-light composition.
export function updateArtMoonDirection(timestampMs: number, longitude: number, target: Vector3) {
  const localDays = timestampMs / 86_400_000 + longitude / 360
  const phase = (localDays - Math.floor(localDays)) * Math.PI * 2
  return target.set(-0.22 + Math.sin(phase) * 0.35, 0.32 + Math.cos(phase) * 0.06, -0.92).normalize()
}
