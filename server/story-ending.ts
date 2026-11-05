import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import { parseGfwSnapshot } from './gfw.js';

// Explicit offline import of reviewed source files. Never runs on startup.
export async function importStoryEnding(db: Pick<pg.Pool, 'query'>) {
  const directory = new URL('../data/gfw/ending/', import.meta.url);
  const inputs = await Promise.all(['all', 'lower', 'upper'].map(async name =>
    JSON.parse(await readFile(new URL(`${name}.json`, directory), 'utf8'))));
  const meta = JSON.parse(await readFile(new URL('request_meta.json', directory), 'utf8'));
  const records = parseGfwSnapshot(inputs[0], inputs[1], inputs[2], 'public-global-presence:v5.0');
  if (records.length !== 108 || records.some(row => row.eventAt < '2026-09-18' || row.eventAt >= '2026-09-20')) {
    throw new Error('Unexpected Story ending scope');
  }
  for (const row of records) await db.query(`INSERT INTO historical_presence
    (id, source, source_record_id, kind, zone_id, event_at, latitude, longitude,
      vessel_id, speed_band_group, source_url, raw_reference, raw_payload)
    VALUES ($1, 'global_fishing_watch', $2, 'gfw_vessel_presence_hour', 'zone_a',
      $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (source, source_record_id) DO NOTHING`, [row.id, row.sourceRecordId,
    row.eventAt, row.latitude, row.longitude, row.vesselId, row.speedBandGroup,
    meta.url_without_token, 'data/gfw/ending/all.json + lower.json / upper.json', row.rawPayload]);
  const notice = JSON.parse(await readFile(new URL('../data/story/ending-notice.json', import.meta.url), 'utf8'));
  await db.query(`INSERT INTO navwarn_notices
    (id, source, source_record_id, zone_id, published_at, effective_at,
      zone_a_state, applies_to, cancels, source_url, raw_text, last_fetched_at)
    VALUES ($1, 'canadian_coast_guard_navwarn', $2, 'zone_a', $3, $4, $5, $6, $7, $8, $9, now())
    ON CONFLICT (source, source_record_id) DO NOTHING`, [notice.id, notice.sourceRecordId,
    notice.publishedAt, notice.effectiveAt, notice.zoneAState, notice.appliesTo, notice.cancels,
    notice.sourceUrl, 'NW-C-4025-26. Effective 181700 UTC Sep 2026. Dynamic Shipping Zones A, B, C, D, and E: No restriction in effect. Cancels NW-C-3975-26.']);
}
