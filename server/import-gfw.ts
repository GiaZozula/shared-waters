import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { databasePoolOptions } from './database.js';
import { parseGfwSnapshot } from './gfw.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL before importing.');
const fixtureDirectory = resolve(process.argv[2] ?? 'data/gfw');
const names = [
  'zone_a_presence_2026-09-13_2026-09-17.json',
  'zone_a_presence_speed_at_or_below_10kn.json',
  'zone_a_presence_speed_above_10kn.json',
] as const;
const inputs = await Promise.all(names.map(async (name) => JSON.parse(await readFile(resolve(fixtureDirectory, name), 'utf8')) as unknown));
const records = parseGfwSnapshot(inputs[0], inputs[1], inputs[2]);
const queryMeta = JSON.parse(await readFile(resolve(fixtureDirectory, 'request_meta.json'), 'utf8')) as Record<string, unknown>;
if (typeof queryMeta.url_without_token !== 'string' || !queryMeta.url_without_token.startsWith('https://gateway.api.globalfishingwatch.org/')) {
  throw new Error('Missing or invalid source query URL');
}
const db = new pg.Pool(databasePoolOptions(databaseUrl));
const client = await db.connect();
try {
  await client.query('BEGIN');
  let inserted = 0;
  for (const record of records) {
    const result = await client.query(
      `INSERT INTO historical_presence
       (id, source, source_record_id, kind, zone_id, event_at, latitude, longitude,
        vessel_id, speed_band_group, source_url, raw_reference, raw_payload)
       VALUES ($1, 'global_fishing_watch', $2, 'gfw_vessel_presence_hour', 'zone_a', $3, $4, $5,
               $6, $7, $8, $9, $10)
       ON CONFLICT (source, source_record_id) DO NOTHING`,
      [record.id, record.sourceRecordId, record.eventAt, record.latitude, record.longitude,
       record.vesselId, record.speedBandGroup,
       queryMeta.url_without_token, record.rawReference,
       record.rawPayload],
    );
    inserted += result.rowCount ?? 0;
  }
  const count = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM historical_presence WHERE source = 'global_fishing_watch' AND zone_id = 'zone_a'`,
  );
  await client.query('COMMIT');
  console.log(JSON.stringify({ parsed: records.length, inserted, stored: Number(count.rows[0].total) }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await db.end();
}
