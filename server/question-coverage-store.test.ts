import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import pg from 'pg';
import { parseGfwSnapshot } from './gfw.js';
import { registerDomainRoutes } from './domain-routes.js';
import { registerAisRoute } from './ais-routes.js';
import { registerQuestionRoutes } from './question-routes.js';
import { registerAgentRoutes } from './test-admission.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Set TEST_DATABASE_URL to a disposable local PostgreSQL database.');

test('six milestone questions use stored rows and bounded tools', async () => {
  const schema = `question_test_${randomUUID().replaceAll('-', '')}`;
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
    const input = await Promise.all(names.map(async (name) => JSON.parse(await readFile(new URL(name, directory), 'utf8'))));
    const records = parseGfwSnapshot(input[0], input[1], input[2]);
    for (const row of records) await db.query(`INSERT INTO historical_presence
      (id, source, source_record_id, kind, zone_id, event_at, latitude, longitude, vessel_id,
       speed_band_group, source_url, raw_reference, raw_payload)
      VALUES ($1, 'global_fishing_watch', $2, 'gfw_vessel_presence_hour', 'zone_a', $3, $4, $5,
       $6, $7, 'https://example.test/gfw', 'fixture', '{}')`,
    [row.id, row.sourceRecordId, row.eventAt, row.latitude, row.longitude, row.vesselId, row.speedBandGroup]);
    const now = new Date();
    await db.query(`INSERT INTO whoi_detections (id, source, source_record_id, zone_id, review_date,
      source_local_time, occurrence, platform_latitude, platform_longitude, source_url, raw_text, last_fetched_at)
      VALUES ('whoi:fixture', 'whoi_robots4whales', 'fixture', 'zone_a', '2026-09-14',
      '2026-09-14 15:38:53', 'detected', 49.358, -64.687, 'https://example.test/review', 'fixture', $1)`, [now]);
    await db.query(`INSERT INTO navwarn_notices (id, source, source_record_id, zone_id, published_at,
      effective_at, zone_a_state, applies_to, source_url, raw_text, last_fetched_at)
      VALUES ('navwarn:fixture', 'canadian_coast_guard_navwarn', 'fixture', 'zone_a',
      '2026-09-15T11:00:00Z', '2026-09-15T12:30:00Z', 'restricted_10_knots',
      'vessels_over_13_m', 'https://example.test/notice', 'fixture', $1)`, [now]);
    await db.query(`INSERT INTO feed_status (source, last_attempt_at, last_success_at, last_attempt_status)
      VALUES ('canadian_coast_guard_navwarn', $1, $1, 'success')`, [now]);
    await db.query(`INSERT INTO ais_connection_status (source, state, checked_at, connected_at)
      VALUES ('aisstream', 'connected', $1, $1)`, [now]);
    await db.query(`INSERT INTO ais_positions (id, source, source_record_id, zone_id, mmsi,
      observed_at, received_at, latitude, longitude, speed_knots, source_url, raw_payload)
      VALUES ('ais:fixture', 'aisstream', 'fixture', 'zone_a', '316123456', $1, $1,
      49.35, -64.7, 8.2, 'https://example.test/ais', '{}')`, [now]);
    const windows = { beforeStart: '2026-09-15T00:00:00Z', beforeEnd: '2026-09-15T12:00:00Z',
      afterStart: '2026-09-15T13:00:00Z', afterEnd: '2026-09-16T00:00:00Z' };
    const server = Fastify();
    registerDomainRoutes(server, db);
    registerAisRoute(server, db);
    registerQuestionRoutes(server, db);
    registerAgentRoutes(server, db, async (body) => {
      const inputText = String(body.input);
      const name = inputText.includes('speed categories') ? 'compare_presence_bands' :
        inputText.includes('latest detection') ? 'get_latest_detection' :
        inputText.includes('this evidence') ? 'get_evidence_by_id' :
        inputText.includes('break the law') ? null : 'get_current_state';
      const evidenceId = inputText.match(/this evidence: ([A-Za-z0-9:_./-]+)/)?.[1];
      return { id: 'one', status: 'completed', output: name ? [{ type: 'function_call', name,
        arguments: JSON.stringify(name === 'compare_presence_bands' ? windows :
          name === 'get_evidence_by_id' ? { id: evidenceId } : {}), call_id: 'one' }] : [] };
    });
    const ask = async (question: string, previousEvidenceIds: string[] = []) => {
      const response = await server.inject({ method: 'POST', url: '/api/ask',
        payload: { question, previousEvidenceIds } });
      assert.equal(response.statusCode, 200, `${question}: ${response.body}`);
      return response.json();
    };
    try {
      const comparison = await ask('How did speed categories change before and after the notice?');
      assert.equal(comparison.facts.compare_presence_bands.before.vesselPresenceHours, 21);
      assert.equal(comparison.facts.compare_presence_bands.before.from10UpCategoryHours, 19);
      assert.equal(comparison.facts.compare_presence_bands.after.vesselPresenceHours, 31);
      assert.equal(comparison.facts.compare_presence_bands.after.from10UpCategoryHours, 0);
      assert.equal(comparison.evidenceIds.length, 52);
      const restriction = await ask('Is Zone A restricted now?');
      assert.equal(restriction.facts.get_current_state.restriction.status, 'current_notice_verified');
      assert.equal(restriction.facts.get_current_state.restriction.statement, 'restricted_10_knots');
      const detection = await ask('When was the latest detection?');
      assert.deepEqual(detection.evidenceIds, ['whoi:fixture']);
      const followUp = await ask('Tell me about this evidence: whoi:fixture', detection.evidenceIds);
      assert.equal(followUp.facts.get_evidence_by_id.sourceLocalTime, '2026-09-14 15:38:53');
      const gfwId = comparison.evidenceIds.find((id: string) => id.includes('/'));
      assert.equal(typeof gfwId, 'string');
      const gfwFollowUp = await ask(`Tell me about this evidence: ${gfwId}`, [gfwId]);
      assert.equal(gfwFollowUp.facts.get_evidence_by_id.id, gfwId);
      assert.match(gfwFollowUp.answer, /speed categor/);
      assert.match(gfwFollowUp.answer, /not an exact speed or compliance finding/);
      const legal = await ask('Did the vessel break the law?');
      assert.deepEqual(legal.warnings, ['unsupported_question']);
      const freshness = await ask('How fresh are current AIS positions?');
      assert.equal(freshness.facts.get_current_state.ais.status, 'recent_messages');
      assert.equal(freshness.facts.get_current_state.ais.recentPositionCount, 1);
      assert.deepEqual(freshness.evidenceIds, ['navwarn:fixture', 'ais:fixture']);
    } finally { await server.close(); }
  } finally {
    if (db) await db.end();
    try { if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await admin.end(); }
  }
});
