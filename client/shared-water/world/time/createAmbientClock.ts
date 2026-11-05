/** Decorative time is separate from selected evidence time and explicit playback. */
export function createAmbientClock() {
  let previous = 0
  let elapsed = 0
  let wasReduced = false
  return {
    sample(now: number, reduced: boolean): number {
      // Discard paused time, including the first frame after resuming, so a
      // preference change cannot jump the camera, water or weather forward.
      if (!reduced && !wasReduced) elapsed += Math.max(0, now - previous)
      previous = now
      wasReduced = reduced
      return elapsed
    },
  }
}
