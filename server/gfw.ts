export type SpeedBandGroup = 'bands_below_or_up_to_10' | 'bands_from_10_up';

export type HistoricalPresence = {
  id: string;
  sourceRecordId: string;
  eventAt: string;
  latitude: number;
  longitude: number;
  vesselId: string;
  speedBandGroup: SpeedBandGroup;
  rawReference: string;
  rawPayload: Record<string, unknown>;
};

const hourPattern = /^\d{4}-\d{2}-\d{2} \d{2}:00$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rowsFromResponse(value: unknown, label: string, dataset: string): Record<string, unknown>[] {
  if (!isObject(value) || !Array.isArray(value.entries) || value.entries.length !== 1) {
    throw new Error(`${label}: expected one GFW result entry`);
  }
  const entry = value.entries[0];
  if (!isObject(entry) || !Array.isArray(entry[dataset]) || entry[dataset].length === 0) {
    throw new Error(`${label}: missing nonempty ${dataset} rows`);
  }
  if (!entry[dataset].every(isObject)) throw new Error(`${label}: invalid row object`);
  return entry[dataset] as Record<string, unknown>[];
}

function rowKey(row: Record<string, unknown>, label: string): string {
  const { vesselId, date, lat, lon, hours } = row;
  const utcHour = typeof date === 'string' ? `${date.replace(' ', 'T')}:00Z` : '';
  const parsedHour = Date.parse(utcHour);
  if (typeof vesselId !== 'string' || vesselId.length === 0 ||
      typeof date !== 'string' || !hourPattern.test(date) ||
      !Number.isFinite(parsedHour) || new Date(parsedHour).toISOString().replace('.000Z', 'Z') !== utcHour ||
      typeof lat !== 'number' || lat < -90 || lat > 90 ||
      typeof lon !== 'number' || lon < -180 || lon > 180 || hours !== 1) {
    throw new Error(`${label}: invalid vessel, UTC hour, position, or presence-hour count`);
  }
  return `${vesselId}/${utcHour}`;
}

function keyedRows(value: unknown, label: string, dataset: string): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const row of rowsFromResponse(value, label, dataset)) {
    const key = rowKey(row, label);
    if (result.has(key)) throw new Error(`${label}: duplicate vessel-hour ${key}`);
    result.set(key, row);
  }
  return result;
}

export function parseGfwSnapshot(
  presence: unknown,
  lowerCategories: unknown,
  upperCategories: unknown,
  dataset = 'public-global-presence:v4.0',
): HistoricalPresence[] {
  const all = keyedRows(presence, 'presence', dataset);
  const lower = keyedRows(lowerCategories, 'lower speed categories', dataset);
  const upper = keyedRows(upperCategories, 'upper speed categories', dataset);
  if (lower.size + upper.size !== all.size) {
    throw new Error('Speed category queries do not partition the presence rows');
  }
  const records: HistoricalPresence[] = [];
  for (const [key, row] of all) {
    const inLower = lower.has(key);
    const inUpper = upper.has(key);
    if (inLower === inUpper) throw new Error(`Missing or conflicting speed category for ${key}`);
    const categoryRow = (inLower ? lower : upper).get(key);
    records.push({
      id: `gfw:${key}`,
      sourceRecordId: key,
      eventAt: key.slice(key.indexOf('/') + 1),
      latitude: row.lat as number,
      longitude: row.lon as number,
      vesselId: row.vesselId as string,
      speedBandGroup: inLower ? 'bands_below_or_up_to_10' : 'bands_from_10_up',
      rawReference: inLower
        ? 'zone_a_presence_2026-09-13_2026-09-17.json + zone_a_presence_speed_at_or_below_10kn.json'
        : 'zone_a_presence_2026-09-13_2026-09-17.json + zone_a_presence_speed_above_10kn.json',
      rawPayload: { presence: row, categoryQuery: categoryRow },
    });
  }
  return records.sort((a, b) => a.eventAt.localeCompare(b.eventAt) || a.id.localeCompare(b.id));
}
