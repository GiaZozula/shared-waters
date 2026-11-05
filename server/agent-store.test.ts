import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import pg from 'pg';
import { registerAgentRoutes } from './test-admission.js';
import { registerDomainRoutes } from './domain-routes.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Set TEST_DATABASE_URL to a local test database.');

test('question evidence IDs resolve against a disposable PostgreSQL schema', async () => {
  const schema = `agent_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  let db: pg.Pool | null = null;
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    db = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await db.query(`INSERT INTO whoi_detections (id, source, source_record_id, zone_id, review_date,
      source_local_time, occurrence, platform_latitude, platform_longitude, source_url, raw_text, last_fetched_at)
      VALUES ('whoi:fixture', 'whoi_robots4whales', 'fixture', 'zone_a', '2026-09-14',
        '2026-09-14 15:38:53', 'detected', 49.358, -64.687, 'https://example.test/review', 'fixture', now())`);
    const modelResponse = { id: 'first', status: 'completed', output: [{ type: 'function_call', name: 'get_latest_detection',
      arguments: '{}', call_id: 'call-1' }] };
    const server = Fastify();
    registerDomainRoutes(server, db);
    registerAgentRoutes(server, db, async () => modelResponse);
    try {
      const response = await server.inject({ method: 'POST', url: '/api/ask',
        payload: { question: 'When was the latest indexed right-whale detection?' } });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json().evidenceIds, ['whoi:fixture']);
      assert.equal(response.json().viewAction, 'get_latest_detection');
      assert.equal(response.json().facts.get_latest_detection.sourceLocalTime, '2026-09-14 15:38:53');
    } finally { await server.close(); }
  } finally {
    if (db) await db.end();
    try { if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await admin.end(); }
  }
});
