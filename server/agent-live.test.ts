import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import pg from 'pg';
import { registerAgentRoutes } from './agent.js';
import { registerDomainRoutes } from './domain-routes.js';
import { parseGfwSnapshot } from './gfw.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !process.env.DEEPSEEK_API_KEY) {
  throw new Error('Set TEST_DATABASE_URL to a local test database and DEEPSEEK_API_KEY for the live check.');
}

test('live DeepSeek question uses the checked GFW rows stored in PostgreSQL', async () => {
  const schema = `agent_live_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  let db: pg.Pool | null = null;
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    db = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    const directory = new URL('../data/gfw/', import.meta.url);
    const names = ['zone_a_presence_2026-09-13_2026-09-17.json',
      'zone_a_presence_speed_at_or_below_10kn.json', 'zone_a_presence_speed_above_10kn.json'];
    const inputs = await Promise.all(names.map(async (name) => JSON.parse(await readFile(new URL(name, directory), 'utf8'))));
    const records = parseGfwSnapshot(inputs[0], inputs[1], inputs[2]);
    const meta = JSON.parse(await readFile(new URL('request_meta.json', directory), 'utf8')) as { url_without_token: string };
    for (const record of records) {
      await db.query(`INSERT INTO historical_presence (id, source, source_record_id, kind, zone_id,
        event_at, latitude, longitude, vessel_id, speed_band_group, source_url, raw_reference, raw_payload)
        VALUES ($1, 'global_fishing_watch', $2, 'gfw_vessel_presence_hour', 'zone_a', $3, $4, $5,
          $6, $7, $8, $9, $10)`, [record.id, record.sourceRecordId, record.eventAt, record.latitude,
        record.longitude, record.vesselId, record.speedBandGroup, meta.url_without_token,
        record.rawReference, record.rawPayload]);
    }
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM historical_presence')).rows[0].count, 250);
    const server = Fastify();
    registerDomainRoutes(server, db);
    registerAgentRoutes(server, db);
    try {
      const response = await server.inject({ method: 'POST', url: '/api/ask', payload: {
        question: 'How did GFW speed categories change before and after the 15 September Zone A notice?',
      } });
      assert.equal(response.statusCode, 200, response.body);
      const result = response.json();
      assert.equal(result.viewAction, 'compare_presence_bands');
      assert.equal(result.facts.compare_presence_bands.before.vesselPresenceHours, 21);
      assert.equal(result.facts.compare_presence_bands.before.from10UpCategoryHours, 19);
      assert.equal(result.facts.compare_presence_bands.after.vesselPresenceHours, 31);
      assert.equal(result.facts.compare_presence_bands.after.from10UpCategoryHours, 0);
      assert.equal(result.evidenceIds.length, 52);
      assert.match(result.answer, /19 of 21 vessel-presence hours/);
      assert.match(result.answer, /0 of 31/);
    } finally { await server.close(); }
  } finally {
    if (db) await db.end();
    try { if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await admin.end(); }
  }
});
