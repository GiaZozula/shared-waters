import { STORY_START, STORY_END } from '../shared/story-scope.js';
export const REPLAY_START = Date.parse(STORY_START);
export const REPLAY_END = Date.parse(STORY_END);
export const REPLAY_LAST_MINUTE = (REPLAY_END - REPLAY_START) / 60_000 - 1;

export type Presence = { id: string; eventAt: string; latitude: number; longitude: number;
  vesselId: string | null; speedBandGroup: 'bands_below_or_up_to_10' | 'bands_from_10_up'; sourceUrl: string;
  shipName: string | null; vesselType: string | null };
export type Notice = { id: string; sourceRecordId: string; publishedAt: string; effectiveAt: string;
  zoneAState: string; appliesTo: string; cancels: string | null; sourceUrl: string; rawText?: string };
export type Detection = { id: string; reviewDate: string; sourceLocalTime: string;
  occurrence: string; platformLatitude: number; platformLongitude: number; sourceUrl: string };
export type ReplayData = { zoneId: string; start: string; end: string; status: 'ready' | 'not_imported' | 'incomplete';
  presence: Presence[]; notices: Notice[]; detections: Detection[]; note: string };

export function clampMinute(minute: number): number {
  return Math.max(0, Math.min(REPLAY_LAST_MINUTE, Math.floor(minute)));
}
export function minuteForInstant(instant: string): number {
  return clampMinute((Date.parse(instant) - REPLAY_START) / 60_000);
}
export function instantForMinute(minute: number): string {
  return new Date(REPLAY_START + clampMinute(minute) * 60_000).toISOString();
}
export function frameAt(data: ReplayData, minute: number) {
  const at = REPLAY_START + clampMinute(minute) * 60_000;
  const hourStart = Math.floor(at / 3_600_000) * 3_600_000;
  const presence = data.presence.filter((row) => Date.parse(row.eventAt) === hourStart);
  const applicable = data.notices.filter((row) => Date.parse(row.publishedAt) <= at && Date.parse(row.effectiveAt) <= at)
    .sort((a, b) => Date.parse(b.effectiveAt) - Date.parse(a.effectiveAt) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const notice = applicable[0] ?? null;
  return { at: new Date(at).toISOString(), hour: new Date(hourStart).toISOString(),
    presence, lowerCategory: presence.filter((row) => row.speedBandGroup === 'bands_below_or_up_to_10').length,
    upperCategory: presence.filter((row) => row.speedBandGroup === 'bands_from_10_up').length,
    notice };
}
