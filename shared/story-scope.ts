export const STORY_FIRST_DATE = '2026-09-13';
export const STORY_LAST_DATE = '2026-09-19';
export const STORY_START = '2026-09-13T00:00:00Z';
export const STORY_END = '2026-09-20T00:00:00Z';
export const STORY_PRESENCE_COUNT = 358;

// The reviewed scope is deliberate. Additional or corrected evidence requires review,
// rather than silently calling a different set of records the same saved Story.
export function matchesReviewedStory(value: Record<string, unknown>): boolean {
  const { presence, notices, detections } = value;
  if (value.start !== STORY_START || value.end !== STORY_END ||
      !Array.isArray(presence) || presence.length !== STORY_PRESENCE_COUNT ||
      !Array.isArray(notices) || notices.length !== 2 ||
      !Array.isArray(detections) || detections.length !== 2) return false;
  const noticeAt = (at: string, state: string) => notices.some(row =>
    row && Date.parse(row.effectiveAt) === Date.parse(at) && row.zoneAState === state);
  return noticeAt('2026-09-15T12:30:00Z', 'restricted_10_knots') &&
    noticeAt('2026-09-18T17:00:00Z', 'no_restriction_stated') &&
    ['2026-09-14 15:23:53', '2026-09-14 15:38:53'].every(time =>
      detections.some(row => row && row.reviewDate === '2026-09-14' &&
        row.sourceLocalTime === time && row.occurrence === 'detected'));
}
