const UNPARSED_REVEAL_MS = Date.parse('2026-09-16T18:00:00Z')

function wallClockMs(value: string): number {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return NaN
  }

  const withT = trimmed.includes('T')
    ? trimmed
    : trimmed.replace(' ', 'T')

  const stamped = /[zZ]|[+-]\d{2}:\d{2}$/.test(withT)
    ? withT
    : `${withT}Z`

  return Date.parse(stamped)
}

/*
 * Source-local wall clock, used only as the moment
 * the story may show this detection.
 */
export function detectionRevealMs(
  sourceLocalTime: string,
  reviewDate = '',
): number {
  if (/\d{4}-\d{2}-\d{2}/.test(sourceLocalTime)) {
    const direct = wallClockMs(sourceLocalTime)

    if (Number.isFinite(direct)) {
      return direct
    }
  }

  const clock = sourceLocalTime.trim().match(/^(\d{2}:\d{2}:\d{2})$/)
  const day = reviewDate.trim().match(/^(\d{4}-\d{2}-\d{2})/)

  if (clock && day) {
    const combined = Date.parse(`${day[1]}T${clock[1]}Z`)

    if (Number.isFinite(combined)) {
      return combined
    }
  }

  return UNPARSED_REVEAL_MS
}

export function detectionIsRevealed(
  selectedTimeMs: number | undefined,
  sourceLocalTime: string,
  reviewDate = '',
): boolean {
  if (
    selectedTimeMs === undefined ||
    !Number.isFinite(selectedTimeMs)
  ) {
    return true
  }

  return selectedTimeMs >= detectionRevealMs(
    sourceLocalTime,
    reviewDate,
  )
}
