import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type pg from 'pg';
import { registerDomainRoutes } from './domain-routes.js';

test('query routes reject invalid or overlapping windows before reading storage', async () => {
  let reads = 0;
  const db = { query: async () => { reads += 1; return { rows: [] }; } } as unknown as pg.Pool;
  const server = Fastify();
  registerDomainRoutes(server, db);
  try {
    const invalidTime = await server.inject('/api/query/restriction?at=2026-02-30T00:00:00Z');
    assert.equal(invalidTime.statusCode, 400);
    const overlap = await server.inject('/api/query/presence-comparison?beforeStart=2026-09-15T00:00:00Z&beforeEnd=2026-09-15T14:00:00Z&afterStart=2026-09-15T13:00:00Z&afterEnd=2026-09-16T00:00:00Z');
    assert.equal(overlap.statusCode, 400);
    const partial = await server.inject('/api/query/presence-comparison?beforeStart=2026-09-15T12:00:00Z&beforeEnd=2026-09-15T13:00:00Z&afterStart=2026-09-15T13:00:00Z&afterEnd=2026-09-16T00:00:00Z');
    assert.equal(partial.statusCode, 400);
    assert.equal(reads, 0);
  } finally {
    await server.close();
  }
});

test('restriction route returns unknown before an effective notice and 503 on database failure', async () => {
  const db = { query: async () => ({ rows: [] }) } as unknown as pg.Pool;
  const server = Fastify();
  registerDomainRoutes(server, db);
  try {
    const before = await server.inject('/api/query/restriction?at=2026-09-15T12:00:00Z');
    assert.equal(before.statusCode, 200);
    assert.equal(before.json().status, 'unknown');
    assert.equal(before.json().statement, null);
    assert.deepEqual(before.json().evidenceIds, []);
  } finally {
    await server.close();
  }

  const failedDb = { query: async () => { throw new Error('database offline'); } } as unknown as pg.Pool;
  const failedServer = Fastify();
  registerDomainRoutes(failedServer, failedDb);
  try {
    const failed = await failedServer.inject('/api/query/restriction?at=2026-09-15T13:00:00Z');
    assert.equal(failed.statusCode, 503);
    assert.equal(failed.json().error, 'domain_data_unavailable');
  } finally {
    await failedServer.close();
  }
});

test('current restriction uses the feed-preferred notice selection', async () => {
  const now = new Date();
  const at = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const olderSeen = { id: 'navwarn:older-seen', sourceRecordId: 'older-seen',
    publishedAt: '2026-09-23T10:00:00Z', effectiveAt: '2026-09-23T12:00:00Z',
    zoneAState: 'restricted_10_knots', appliesTo: 'vessels_over_13_m', cancels: null,
    sourceUrl: 'https://example.test/older', lastFetchedAt: now };
  const queries: string[] = [];
  const db = { query: async (sql: string) => {
    queries.push(sql);
    if (sql.includes('FROM navwarn_notices')) return { rows: [olderSeen] };
    return { rows: [{ last_attempt_status: 'success', last_success_at: now }] };
  } } as unknown as pg.Pool;
  const server = Fastify();
  registerDomainRoutes(server, db);
  try {
    const response = await server.inject(`/api/query/restriction?at=${at}`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().notice.id, olderSeen.id);
    assert.equal(response.json().status, 'current_notice_verified');
    assert.ok(queries.some((sql) => sql.includes('ORDER BY CASE WHEN last_fetched_at =')));
    assert.ok(!queries.some((sql) => sql.includes('ORDER BY effective_at DESC')));
  } finally {
    await server.close();
  }
});

test('presence route reads only the two bounded windows and returns evidence IDs', async () => {
  const calls: unknown[][] = [];
  const db = { query: async (_sql: string, params: unknown[]) => {
    calls.push(params);
    return { rows: [{ id: `gfw:${String(params[0])}`, eventAt: params[0],
      speedBandGroup: params[0] === '2026-09-15T00:00:00Z' ? 'bands_from_10_up' : 'bands_below_or_up_to_10' }] };
  } } as unknown as pg.Pool;
  const server = Fastify();
  registerDomainRoutes(server, db);
  try {
    const response = await server.inject('/api/query/presence-comparison?beforeStart=2026-09-15T00:00:00Z&beforeEnd=2026-09-15T12:00:00Z&afterStart=2026-09-15T13:00:00Z&afterEnd=2026-09-16T00:00:00Z');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls, [
      ['2026-09-15T00:00:00Z', '2026-09-15T12:00:00Z'],
      ['2026-09-15T13:00:00Z', '2026-09-16T00:00:00Z'],
    ]);
    assert.equal(response.json().status, 'descriptive_comparison');
    assert.deepEqual(response.json().before.evidenceIds, ['gfw:2026-09-15T00:00:00Z']);
  } finally {
    await server.close();
  }
});

test('presence route refuses a truncated comparison', async () => {
  const rows = Array.from({ length: 251 }, (_, index) => ({
    id: `gfw:${index}`, eventAt: '2026-09-15T00:00:00Z', speedBandGroup: 'bands_from_10_up',
  }));
  const db = { query: async () => ({ rows }) } as unknown as pg.Pool;
  const server = Fastify();
  registerDomainRoutes(server, db);
  try {
    const response = await server.inject('/api/query/presence-comparison?beforeStart=2026-09-15T00:00:00Z&beforeEnd=2026-09-15T12:00:00Z&afterStart=2026-09-15T13:00:00Z&afterEnd=2026-09-16T00:00:00Z');
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, 'presence_window_exceeds_checked_snapshot_limit');
  } finally {
    await server.close();
  }
});

test('detection-date routes reject invalid dates and refuse truncation', async () => {
  let reads = 0;
  const db = { query: async () => { reads++; return { rows: Array.from({ length: 101 }, (_, i) => ({ id: `whoi:${i}` })) }; } } as unknown as pg.Pool;
  const server = Fastify(); registerDomainRoutes(server, db);
  try {
    for (const path of ['/api/query/detections?date=2026-02-30', '/api/query/detections?date=2026-09-14%27',
      '/api/query/latest-detection?throughDate=2026-09-14', '/api/query/latest-detection?scope=story&throughDate=2026-09-22',
      '/api/query/latest-detection?scope=story&throughDate=']) {
      assert.equal((await server.inject(path)).statusCode, 400, path);
    }
    assert.equal(reads, 0);
    const oversized = await server.inject('/api/query/detections?date=2026-09-14');
    assert.equal(oversized.statusCode, 409);
    assert.equal(oversized.json().error, 'detection_date_exceeds_reviewed_limit');
  } finally { await server.close(); }
});
