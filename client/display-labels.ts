/** User-facing labels. Never print raw API or enum codes. */

export function occurrenceLabel(
  occurrence: string | null | undefined,
): string {
  if (
    typeof occurrence !==
      'string' ||
    occurrence.trim()
      .length === 0
  ) {
    return 'N/A'
  }

  if (
    occurrence ===
    'detected'
  ) {
    return 'detected'
  }

  if (
    occurrence ===
    'possibly_detected'
  ) {
    return 'possibly detected'
  }

  return occurrence
    .trim()
    .replaceAll(
      '_',
      ' ',
    )
}

export function zoneAStateLabel(
  state: string | null | undefined,
): string {
  if (
    state ===
    'restricted_10_knots'
  ) {
    return '10-knot Zone A restriction'
  }

  if (
    state ===
    'no_restriction_stated'
  ) {
    return 'no dynamic Zone A restriction stated'
  }

  if (
    typeof state !==
      'string' ||
    state.trim()
      .length === 0
  ) {
    return 'N/A'
  }

  return 'Zone A statement not recognized'
}

export function appliesToLabel(
  appliesTo: string | null | undefined,
): string {
  if (
    appliesTo ===
    'vessels_over_13_m'
  ) {
    return 'vessels over 13 m'
  }

  if (
    typeof appliesTo !==
      'string' ||
    appliesTo.trim()
      .length === 0
  ) {
    return 'N/A'
  }

  return appliesTo
    .trim()
    .replaceAll(
      '_',
      ' ',
    )
}

export function aisCoverageLabel(
  status: string | null | undefined,
): string {
  if (
    status ===
    'recent_messages'
  ) {
    return 'recent messages'
  }

  if (
    status ===
    'unknown'
  ) {
    return 'unknown'
  }

  if (
    status ===
    'unavailable'
  ) {
    return 'unavailable'
  }

  if (
    status ===
    'checking'
  ) {
    return 'checking'
  }

  if (
    status ===
    'unconfigured'
  ) {
    return 'unconfigured'
  }

  if (
    typeof status !==
      'string' ||
    status.trim()
      .length === 0
  ) {
    return 'N/A'
  }

  return status
    .trim()
    .replaceAll(
      '_',
      ' ',
    )
}

export function feedDataStatusLabel(
  status: string | null | undefined,
): string {
  const labels: Record<string, string> = {
    fresh: 'recent',
    stale: 'older',
    missing: 'missing',
    recent_review: 'recent review',
    stale_review: 'older review',
    latest_published_notice: 'latest published notice',
    unverified: 'unverified',
    pending_effective_time: 'pending effective time',
    never: 'never fetched',
    success: 'success',
    error: 'error',
    checking: 'checking',
    unknown: 'unknown',
    unavailable: 'unavailable',
  }

  if (
    typeof status !==
      'string' ||
    status.trim()
      .length === 0
  ) {
    return 'N/A'
  }

  return labels[status] ??
    status
      .trim()
      .replaceAll(
        '_',
        ' ',
      )
}

export function readinessLevelLabel(
  level: string,
): string {
  if (
    level ===
    'ready'
  ) {
    return 'ready'
  }

  if (
    level ===
    'attention'
  ) {
    return 'needs attention'
  }

  if (
    level ===
    'unavailable'
  ) {
    return 'unavailable'
  }

  if (
    level ===
    'checking'
  ) {
    return 'checking'
  }

  return level
    .replaceAll(
      '_',
      ' ',
    )
}

export function connectionStatusLabel(
  status: string | null | undefined,
): string {
  if (
    typeof status !==
      'string' ||
    status.trim()
      .length === 0
  ) {
    return 'N/A'
  }

  return status
    .trim()
    .replaceAll(
      '_',
      ' ',
    )
}
