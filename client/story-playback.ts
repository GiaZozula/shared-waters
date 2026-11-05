/** Timer-driven transport: land on every authored stop and hold it visibly. */
export function createStoryPlayback(stops: number[]) {
  let hold = 29
  return (progress: number) => {
    if (hold > 0) { hold--; return progress }
    if (progress >= 1) return 0
    const next = Math.min(1, progress + 0.002)
    const stop = stops.find(value => value > progress + 1e-10 && value <= next)
    if (stop !== undefined) { hold = 29; return stop }
    return next
  }
}
