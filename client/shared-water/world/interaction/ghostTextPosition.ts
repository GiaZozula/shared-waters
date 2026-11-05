// Keep the whole message above the controls, including wrapped source times.
export function ghostTextPosition(x: number, y: number, width: number, height: number,
  messageWidth: number, messageHeight: number, controlsTop = height, markerTop = height) {
  const compact = width <= 720 || height <= 560
  const padding = 16
  const halfWidth = messageWidth / 2, halfHeight = messageHeight / 2
  const minX = padding + halfWidth
  const maxX = Math.max(minX, width - padding - halfWidth)
  const minY = padding + halfHeight
  const maxY = Math.max(minY, Math.min(height * (compact ? 0.52 : 0.72),
    height - padding - halfHeight, controlsTop - 20 - halfHeight, markerTop - 20 - halfHeight))
  return { x: Math.min(maxX, Math.max(minX, x)), y: Math.min(maxY, Math.max(minY, y)) }
}
