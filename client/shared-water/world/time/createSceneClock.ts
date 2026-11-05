export type SceneTimeMode =
  | 'story'
  | 'live'

interface SceneClockOptions {
  mode?: SceneTimeMode

  getStoryTimeMs:
    () => number
}

export function createSceneClock({
  mode = 'story',
  getStoryTimeMs,
}: SceneClockOptions) {
  let currentMode =
    mode

  return {
    get mode() {
      return currentMode
    },

    setMode(
      next:
        SceneTimeMode,
    ) {
      currentMode =
        next
    },

    get timestampMs() {
      if (
        currentMode ===
        'live'
      ) {
        return Date.now()
      }

      return getStoryTimeMs()
    },
  }
}
