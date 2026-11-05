import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import pg from 'pg';
import { parseGfwSnapshot } from './gfw.js';
import { importStoryEnding } from './story-ending.js';
import { exportStory } from './story-export.js';
import { registerReplayRoute } from './replay.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Set TEST_DATABASE_URL to a local test database.');

test('replay route reads 358 in-window vessel-hours and timed source events from PostgreSQL', async () => {
  const schema = `replay_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  let db: pg.Pool | null = null;
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`); created = true;
    db = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    const directory = new URL('../data/gfw/', import.meta.url);
    const names = ['zone_a_presence_2026-09-13_2026-09-17.json',
      'zone_a_presence_speed_at_or_below_10kn.json', 'zone_a_presence_speed_above_10kn.json'];
    const inputs = await Promise.all(names.map(async (name) => JSON.parse(await readFile(new URL(name, directory), 'utf8'))));
    const rows = parseGfwSnapshot(inputs[0], inputs[1], inputs[2]);
    for (const row of rows) await db.query(`INSERT INTO historical_presence
      (id, source, source_record_id, kind, zone_id, event_at, latitude, longitude,
        vessel_id, speed_band_group, source_url, raw_reference, raw_payload)
      VALUES ($1, 'global_fishing_watch', $2, 'gfw_vessel_presence_hour', 'zone_a',
        $3, $4, $5, $6, $7, 'https://example.test/gfw', $8, $9)`, [row.id, row.sourceRecordId,
      row.eventAt, row.latitude, row.longitude, row.vesselId, row.speedBandGroup, row.rawReference, row.rawPayload]);
    await db.query(`INSERT INTO navwarn_notices (id, source, source_record_id, zone_id,
      published_at, effective_at, zone_a_state, applies_to, source_url, raw_text, last_fetched_at)
      VALUES ('navwarn:story', 'canadian_coast_guard_navwarn', 'story', 'zone_a',
      '2026-09-15T11:00:00.123456Z', '2026-09-15T12:30:00Z', 'restricted_10_knots',
      'vessels_over_13_m', 'https://example.test/notice', 'fixture', now())`);
    await db.query(`INSERT INTO whoi_detections (id, source, source_record_id, zone_id,
      review_date, source_local_time, occurrence, platform_latitude, platform_longitude,
      source_url, raw_text, last_fetched_at) VALUES ('whoi:story', 'whoi_robots4whales',
      'story', 'zone_a', '2026-09-14', '2026-09-14 15:23:53', 'detected', 49.358, -64.687,
      'https://example.test/whoi', 'fixture', now())`);
    await db.query(`INSERT INTO whoi_detections SELECT 'whoi:story-two', source, 'story-two',
      zone_id, review_date, '2026-09-14 15:38:53', occurrence, platform_latitude,
      platform_longitude, source_url, raw_text, first_ingested_at, last_fetched_at
      FROM whoi_detections WHERE id = 'whoi:story'`);
    await importStoryEnding(db);
    const server = Fastify(); registerReplayRoute(server, db);
    try {
      const response = await server.inject('/api/story/replay');
      assert.equal(response.statusCode, 200, response.body);
      const snapshot = response.json();
      const exported = await exportStory(db, 'a'.repeat(40), '2026-10-22T00:00:00Z');
      assert.deepEqual(exported.data, snapshot);
      const regenerated = await exportStory(db, 'b'.repeat(40), '2026-10-23T00:00:00Z');
      assert.equal(exported.contentFingerprint, regenerated.contentFingerprint);
      assert.notEqual(exported.generatedAt, regenerated.generatedAt);
      assert.equal(snapshot.status, 'ready');
      assert.equal(snapshot.presence.length, 358);
      const paul = snapshot.presence.find((row: { id: string }) => row.id === 'gfw:cdee72f3c-c80a-1d36-2f5a-cd763e99d716/2026-09-15T14:00:00Z');
      assert.equal(paul.shipName, 'PAUL  A. DESGAGNES');
      assert.equal(paul.vesselType, 'OTHER_NON_FISHING');
      const cic = snapshot.presence.find((row: { id: string }) => row.id === 'gfw:ead2e3e16-6fd0-9b75-6bac-1fc47899f10a/2026-09-15T17:00:00Z');
      assert.equal(cic.shipName, 'CIC OSLO');
      assert.equal(cic.vesselType, 'INSUFFICIENT_DATA');
      assert.equal(snapshot.notices[0].publishedAt, '2026-09-15T11:00:00.123456Z');
      assert.equal(snapshot.notices[0].effectiveAt, '2026-09-15T12:30:00.000Z');
      assert.equal(snapshot.detections[0].sourceLocalTime, '2026-09-14 15:23:53');
    } finally { await server.close(); }
  } finally {
    if (db) await db.end();
    try { if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await admin.end(); }
  }
});
