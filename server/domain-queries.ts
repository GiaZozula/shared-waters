import { STORY_START, STORY_END } from '../shared/story-scope.js';
export const ZONE_ID = 'zone_a' as const;
export const PRESENCE_START = STORY_START;
export const PRESENCE_END = STORY_END;
export const RESTRICTION_PARTIAL_HOUR_START = '2026-09-15T12:00:00Z';
export const RESTRICTION_PARTIAL_HOUR_END = '2026-09-15T13:00:00Z';

export type NoticeRecord = {
  id: string;
  sourceRecordId: string;
  publishedAt: string | Date;
  effectiveAt: string | Date;
  zoneAState: 'restricted_10_knots' | 'no_restriction_stated';
  appliesTo: 'vessels_over_13_m';
  cancels: string | null;
  sourceUrl: string;
  lastFetchedAt: string | Date;
};

export type FetchState = {
  status: 'never' | 'success' | 'error';
  lastSuccessAt: string | Date | null;
};

export type DetectionRecord = {
  id: string;
  reviewDate: string;
  sourceLocalTime: string;
  occurrence: 'detected' | 'possibly_detected';
  platformLatitude: number;
  platformLongitude: number;
  sourceUrl: string;
};

export type PresenceRecord = {
  id: string;
  eventAt: string | Date;
  speedBandGroup: 'bands_below_or_up_to_10' | 'bands_from_10_up';
};

export type HourWindow = { start: string; end: string };

function milliseconds(value: string | Date): number {
  return new Date(value).getTime();
}

export function parseInstant(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().replace('.000Z', 'Z') === value ? value : null;
}

export function parsePresenceWindow(start: unknown, end: unknown): HourWindow | null {
  const first = parseInstant(start);
  const last = parseInstant(end);
  if (!first || !last || !first.endsWith(':00:00Z') || !last.endsWith(':00:00Z')) return null;
  const duration = milliseconds(last) - milliseconds(first);
  if (first < PRESENCE_START || last > PRESENCE_END || duration < 3_600_000 || duration > 48 * 3_600_000) return null;
  if (first < RESTRICTION_PARTIAL_HOUR_END && last > RESTRICTION_PARTIAL_HOUR_START) return null;
  return { start: first, end: last };
}

export function getRestrictionAt(at: string, notices: NoticeRecord[], fetch: FetchState, now: Date) {
  const when = milliseconds(at);
  const success = fetch.lastSuccessAt ? milliseconds(fetch.lastSuccessAt) : NaN;
  const current = when <= milliseconds(now) && milliseconds(now) - when <= 5 * 60_000;
  // The current route receives the same preferred notice as /api/current/navwarn.
  // Historical queries instead select the latest notice effective at the requested time.
  const applicable = notices.filter((notice) => milliseconds(notice.publishedAt) <= when && milliseconds(notice.effectiveAt) <= when)
    .sort((a, b) => milliseconds(b.effectiveAt) - milliseconds(a.effectiveAt) ||
      milliseconds(b.publishedAt) - milliseconds(a.publishedAt));
  const preferred = notices[0] ?? null;
  const notice = current ? preferred && milliseconds(preferred.publishedAt) <= when ? preferred : null :
    applicable[0] ?? null;
  const pending = Boolean(current && notice && milliseconds(notice.effectiveAt) > when);
  const verifiedCurrent = Boolean(notice && current && fetch.status === 'success' &&
    success <= milliseconds(now) && milliseconds(now) - success <= 6 * 3_600_000 &&
    milliseconds(notice.lastFetchedAt) === success);
  // The current notice selector also carries raw source text; return only the reviewed notice fields.
  const publicNotice: NoticeRecord | null = notice ? {
    id: notice.id, sourceRecordId: notice.sourceRecordId, publishedAt: notice.publishedAt,
    effectiveAt: notice.effectiveAt, zoneAState: notice.zoneAState, appliesTo: notice.appliesTo,
    cancels: notice.cancels, sourceUrl: notice.sourceUrl, lastFetchedAt: notice.lastFetchedAt,
  } : null;
  return {
    zoneId: ZONE_ID,
    at,
    status: !notice ? 'unknown' : !verifiedCurrent ? 'documented_notice_unverified' :
      pending ? 'pending_effective_time' : 'current_notice_verified',
    statement: pending ? null : notice?.zoneAState ?? null,
    notice: publicNotice,
    fetch,
    evidenceIds: notice ? [notice.id] : [],
    warning: !notice ? 'No indexed notice establishes Zone A state at this time.' :
      pending ? 'The selected notice has not taken effect; this response does not establish the current restriction.' :
      verifiedCurrent ? 'The published notice is current in the latest successful search; this is not a navigation or compliance determination.' :
        'This stored notice is historical or current search verification is unavailable; later or missing notices may change the state.',
  };
}

export function getLatestDetection(detections: DetectionRecord[]) {
  const latest = [...detections].sort((a, b) => b.sourceLocalTime.localeCompare(a.sourceLocalTime))[0] ?? null;
  return {
    zoneId: ZONE_ID,
    status: latest ? 'latest_indexed_detection' : 'unknown',
    detection: latest,
    evidenceIds: latest ? [latest.id] : [],
    warning: 'Only indexed WHOI review pages are searched. Times are source-local with unresolved timezone; coordinates locate the glider, not the whale. No indexed row does not prove whale absence.',
  };
}

function summarizePresence(records: PresenceRecord[], window: HourWindow) {
  const within = records.filter((record) => milliseconds(record.eventAt) >= milliseconds(window.start) &&
    milliseconds(record.eventAt) < milliseconds(window.end));
  const lower = within.filter((record) => record.speedBandGroup === 'bands_below_or_up_to_10').length;
  const upper = within.filter((record) => record.speedBandGroup === 'bands_from_10_up').length;
  const total = lower + upper;
  return {
    window, status: total ? 'observed_presence' : 'no_indexed_presence',
    vesselPresenceHours: total,
    atOrBelow10CategoryHours: lower,
    from10UpCategoryHours: upper,
    from10UpCategoryShare: total ? upper / total : null,
    evidenceIds: within.map((record) => record.id),
  };
}

export function comparePresenceBands(beforeRecords: PresenceRecord[], afterRecords: PresenceRecord[], before: HourWindow, after: HourWindow) {
  const first = summarizePresence(beforeRecords, before);
  const second = summarizePresence(afterRecords, after);
  return {
    zoneId: ZONE_ID,
    status: first.vesselPresenceHours && second.vesselPresenceHours ? 'descriptive_comparison' : 'insufficient_indexed_presence',
    before: first,
    after: second,
    warning: 'Counts are AIS-derived vessel-hours, not unique vessels or continuous tracks. The 10–15 knot category crosses the 10-knot boundary and cannot prove a speed above 10 knots. Unequal windows and incomplete AIS coverage prevent a causal or compliance conclusion.',
  };
}
