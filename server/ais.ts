import { createHash } from 'node:crypto';
import { ZONE_A_CORNERS } from '../shared/zone-a.js';

export const AIS_SOURCE = 'aisstream';
export const AIS_SOURCE_URL = 'https://aisstream.io/documentation';
// AISStream examples disagree on corner order. Use southwest → northeast,
// matching the provider's full-world Go example; the shared polygon remains authoritative.
export const AIS_BOX = [[49.183333, -65], [49.683333, -64]] as const;
export const ZONE_POLYGON = ZONE_A_CORNERS;
const POSITION_TYPES = ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'] as const;

export type AisPosition = {
  id: string; sourceRecordId: string; mmsi: string; observedAt: string; receivedAt: string;
  latitude: number; longitude: number; speedKnots: number | null; shipName: string | null;
  sourceUrl: string; rawPayload: unknown;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function inZoneA(latitude: number, longitude: number): boolean {
  let inside = false;
  for (let i = 0, j = ZONE_POLYGON.length - 1; i < ZONE_POLYGON.length; j = i++) {
    const [xi, yi] = ZONE_POLYGON[i];
    const [xj, yj] = ZONE_POLYGON[j];
    if ((yi > latitude) !== (yj > latitude) &&
        longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function observedTime(metadata: Record<string, unknown>, report: Record<string, unknown>, receivedAt: Date): string {
  const sourceTime = metadata.time_utc ?? metadata.Time_utc;
  if (typeof sourceTime === 'string') {
    // Live AISStream metadata can use Go's timestamp format, including nanoseconds.
    const goTime = sourceTime.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))? ([+-]\d{2})(\d{2}) UTC$/);
    const normalized = goTime
      ? `${goTime[1]}T${goTime[2]}.${(goTime[3] ?? '').padEnd(3, '0').slice(0, 3)}${goTime[4]}:${goTime[5]}`
      : sourceTime;
    const parsed = new Date(normalized);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  // The AIS Timestamp is only the second within a minute. Choose the nearest minute,
  // keeping repeated frames stable even if a reconnect lands across a minute boundary.
  const second = report.Timestamp;
  if (Number.isInteger(second) && Number(second) >= 0 && Number(second) <= 59) {
    const minute = Math.floor(receivedAt.getTime() / 60_000) * 60_000;
    const candidates = [-60_000, 0, 60_000].map((offset) => minute + offset + Number(second) * 1000);
    const nearest = candidates.reduce((best, candidate) =>
      Math.abs(candidate - receivedAt.getTime()) < Math.abs(best - receivedAt.getTime()) ? candidate : best);
    return new Date(nearest).toISOString();
  }
  return receivedAt.toISOString();
}

export function parseAisPosition(
  raw: unknown, receivedAt = new Date(), inside: (latitude: number, longitude: number) => boolean = inZoneA,
): AisPosition | null {
  const envelope = object(raw);
  if (!envelope || !POSITION_TYPES.includes(envelope.MessageType as typeof POSITION_TYPES[number])) return null;
  const metadata = object(envelope.MetaData);
  const report = object(object(envelope.Message)?.[String(envelope.MessageType)]);
  if (!metadata || !report || report.Valid === false) return null;
  const latitude = report.Latitude ?? metadata.Latitude;
  const longitude = report.Longitude ?? metadata.Longitude;
  const mmsiValue = report.UserID ?? metadata.MMSI;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) || !inside(latitude, longitude) ||
      !Number.isInteger(mmsiValue) || Number(mmsiValue) < 100000000 || Number(mmsiValue) > 999999999) return null;
  const mmsi = String(mmsiValue);
  const speedKnots = typeof report.Sog === 'number' && Number.isFinite(report.Sog) &&
    report.Sog >= 0 && report.Sog < 102.3 ? report.Sog : null;
  const observedAt = observedTime(metadata, report, receivedAt);
  const shipName = typeof metadata.ShipName === 'string' && metadata.ShipName.trim() ? metadata.ShipName.trim() : null;
  const identity = [envelope.MessageType, mmsi, observedAt, latitude, longitude, speedKnots ?? 'unknown'];
  const sourceRecordId = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return {
    id: `ais:${sourceRecordId}`, sourceRecordId, mmsi, observedAt,
    receivedAt: receivedAt.toISOString(), latitude, longitude, speedKnots, shipName,
    sourceUrl: AIS_SOURCE_URL, rawPayload: raw,
  };
}

export function classifyAisFrame(
  raw: unknown, receivedAt = new Date(), inside: (latitude: number, longitude: number) => boolean = inZoneA,
): { kind: 'position'; position: AisPosition } | { kind: 'outside' } | { kind: 'unparsed' } {
  const position = parseAisPosition(raw, receivedAt, () => true);
  if (!position) return { kind: 'unparsed' };
  if (!inside(position.latitude, position.longitude)) return { kind: 'outside' };
  return { kind: 'position', position };
}

export function aisSubscription(apiKey: string) {
  return { APIKey: apiKey, BoundingBoxes: [AIS_BOX], FilterMessageTypes: [...POSITION_TYPES] };
}
