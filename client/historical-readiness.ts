import { matchesReviewedStory } from '../shared/story-scope.js';
// The historical endpoint counts all imported Zone A rows; only replay declares
// the reviewed Story window. Extra historical imports do not invalidate Story.
export function historicalReadiness(historical: Record<string, unknown> | null, replay: Record<string, unknown> | null) {
  const total = historical?.total;
  const hasTotal = typeof total === 'number' && Number.isSafeInteger(total) && total >= 0;
  const allHistory = hasTotal ? `${total} vessel-hour records stored across all imported history.` : 'The all-history record count could not be loaded.';
  const reviewed = replay?.status === 'ready' && matchesReviewedStory(replay);
  const story = !replay ? 'The stored Story could not be checked.' : reviewed
    ? 'The reviewed 13–19 September 2026 Story is ready with 358 vessel-hour records.'
    : 'The reviewed 13–19 September 2026 Story is not ready; its reviewed scope requires 358 vessel-hours, two timed notices and two acoustic records.';
  const level: 'ready' | 'attention' | 'unavailable' = reviewed && hasTotal && total >= 358 ? 'ready' : !replay && !hasTotal ? 'unavailable' : 'attention';
  return { level, detail: `${allHistory} ${story} Historical vessel-hours are not live AIS.` };
}
