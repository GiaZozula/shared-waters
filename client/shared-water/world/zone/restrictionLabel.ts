import type {
  RestrictionFact,
  RestrictionStatus,
} from '../facts/types'

function speakEffectiveAt(
  value: string | null,
) {
  if (!value) {
    return 'N/A'
  }

  const parsed =
    Date.parse(
      value,
    )

  if (
    !Number.isFinite(
      parsed,
    )
  ) {
    return value
  }

  return (
    new Date(parsed)
      .toISOString()
      .slice(
        0,
        16,
      )
      .replace(
        'T',
        ' ',
      ) +
    ' UTC'
  )
}

export function restrictionValue(
  status: RestrictionStatus,
): string {
  if (status === 'unverified') {
    return 'a notice exists but is unverified'
  }

  if (status === 'pending') {
    return 'a notice exists but has not taken effect'
  }

  if (status === 'record-shows-none') {
    return 'this record shows no dynamic restriction'
  }

  if (status === 'active') {
    return 'a 10-knot Zone A limit is in effect'
  }

  return 'restriction state unknown'
}

export function restrictionSentence(
  restriction: RestrictionFact,
): string {
  if (
    restriction.status ===
    'active'
  ) {
    const speed =
      restriction.speedKnots === null
        ? 'speed limit not established'
        : `${restriction.speedKnots}-knot limit`
    const vesselLength =
      restriction.minimumLengthMetres === null
        ? 'vessel length threshold not established'
        : `vessels over ${restriction.minimumLengthMetres} m`
    const exceptions =
      restriction.exceptionsApply
        ? 'The notice lists exceptions.'
        : ''
    const effectiveAt =
      restriction.effectiveAt
        ? `Effective ${speakEffectiveAt(restriction.effectiveAt)}.`
        : 'Effective time not established.'

    return `The notice lists a ${speed} for ${vesselLength}. ${exceptions ? `${exceptions} ` : ''}${effectiveAt} This is not a clearance to navigate.`
  }

  if (
    restriction.status ===
    'unverified'
  ) {
    return 'A notice is stored, but the latest search did not confirm it as current. Zone A state is unverified.'
  }

  if (
    restriction.status ===
    'pending'
  ) {
    return 'The latest search confirmed a notice, but it has not taken effect. It does not establish Zone A state.'
  }

  if (
    restriction.status ===
    'record-shows-none'
  ) {
    return 'The notice shows no special Zone A restriction. This does not mean there are no other rules.'
  }

  return 'No current vessel notice is available for Zone A.'
}
