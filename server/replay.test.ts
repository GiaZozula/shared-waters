import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type pg from 'pg';
import { registerReplayRoute } from './replay.js';

test('replay returns one bounded stored snapshot with separate source time semantics', async () => {
  const sql: string[] = [];
  const db = { query: async (statement: string) => {
    sql.push(statement);
    if (statement.includes('FROM historical_presence')) return { rows: [{ id: 'gfw:one', eventAt: '2026-09-15T12:00:00Z' }] };
    if (statement.includes('FROM navwarn_notices')) return { rows: [{ id: 'navwarn:one', effectiveAt: '2026-09-15T12:30:00Z' }] };
    return { rows: [{ id: 'whoi:one', sourceLocalTime: '2026-09-14 15:23:53' }] };
  } } as unknown as pg.Pool;
  const server = Fastify(); registerReplayRoute(server, db);
  try {
    const response = await server.inject('/api/story/replay');
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, 'incomplete');
    assert.deepEqual(response.json().presence.map((row: { id: string }) => row.id), ['gfw:one']);
    assert.equal(response.json().notices[0].effectiveAt, '2026-09-15T12:30:00Z');
    assert.equal(response.json().detections[0].sourceLocalTime, '2026-09-14 15:23:53');
    assert.match(response.json().note, /not converted to UTC/);
    assert.equal(sql.length, 3);
    assert.ok(sql.every((statement) => /LIMIT (501|101)/.test(statement)));
    assert.match(sql[0], /raw_payload->'presence'->>'shipName'/);
    assert.match(sql[0], /raw_payload->'categoryQuery'->>'shipName'/);
    assert.match(sql[0], /NULLIF\(BTRIM\(raw_payload->'presence'->>'shipName'\), ''\)/);
  } finally { await server.close(); }
});

test('replay refuses a snapshot over the reviewed cap', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({ id: `gfw:${index}` }));
  const server = Fastify();
  registerReplayRoute(server, { query: async (statement: string) => (
    { rows: statement.includes('FROM historical_presence') ? rows : [] }
  ) } as unknown as pg.Pool);
  try {
    const response = await server.inject('/api/story/replay');
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'story_snapshot_exceeds_reviewed_limit' });
  } finally { await server.close(); }
});

test('empty historical import is explicit and database failure is unavailable', async () => {
  const empty = Fastify(); registerReplayRoute(empty, { query: async () => ({ rows: [] }) } as unknown as pg.Pool);
  try {
    const response = await empty.inject('/api/story/replay');
    assert.equal(response.json().status, 'not_imported');
  } finally { await empty.close(); }
  const broken = Fastify(); registerReplayRoute(broken, { query: async () => { throw Error('offline'); } } as unknown as pg.Pool);
  try {
    const response = await broken.inject('/api/story/replay');
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'story_data_unavailable' });
  } finally { await broken.close(); }
});
