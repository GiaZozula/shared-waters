import * as THREE from 'three'

interface WorldTimeOptions {
  start: string
  end: string
  initialProgress?: number
}

export function createWorldTime({
  start,
  end,
  initialProgress = 0.68,
}: WorldTimeOptions) {
  const startMs =
    new Date(start).getTime()

  const endMs =
    new Date(end).getTime()

  let progress =
    THREE.MathUtils.clamp(
      initialProgress,
      0,
      1,
    )

  function setProgress(
    next: number,
  ) {
    progress =
      THREE.MathUtils.clamp(
        next,
        0,
        1,
      )
  }

  function timeAtProgress(next: number) {
    // Epoch interpolation can land a fraction of a millisecond before an exact
    // chapter boundary. Keep the display and hourly evidence on the same clock.
    // Replay end is exclusive; End keeps the last instant inside the archive.
    return Math.min(endMs - 1,
      Math.round(startMs + (endMs - startMs) * THREE.MathUtils.clamp(next, 0, 1)))
  }

  return {
    get progress() {
      return progress
    },

    get selectedTimeMs() {
      return timeAtProgress(progress)
    },

    /*
     * Temporary deterministic visual time.
     *
     * Later vessel positions will come directly
     * from actual timestamped observations.
     */
    get motionTime() {
      return progress * 180
    },

    timeAtProgress,

    setProgress,
  }
}
