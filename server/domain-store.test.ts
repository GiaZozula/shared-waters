import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import pg from 'pg';
import { getRestrictionAt, type NoticeRecord } from './domain-queries.js';
import { registerDomainRoutes } from './domain-routes.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Set TEST_DATABASE_URL to a local test database.');

test('historical restriction SQL selects the same notice as getRestrictionAt', async () => {
  const schema = `domain_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  let db: pg.Pool | null = null;
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    db = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    const at = '2026-09-15T13:00:00Z';
    const notices: NoticeRecord[] = [
      { id: 'navwarn:early', sourceRecordId: 'early', publishedAt: '2026-09-15T10:00:00Z',
        effectiveAt: '2026-09-15T12:30:00Z', zoneAState: 'restricted_10_knots',
        appliesTo: 'vessels_over_13_m', cancels: null, sourceUrl: 'https://example.test/early',
        lastFetchedAt: '2026-09-15T11:00:00Z' },
      { id: 'navwarn:future-effective', sourceRecordId: 'future-effective',
        publishedAt: '2026-09-15T11:00:00Z', effectiveAt: '2026-09-15T14:00:00Z',
        zoneAState: 'no_restriction_stated', appliesTo: 'vessels_over_13_m', cancels: null,
        sourceUrl: 'https://example.test/future', lastFetchedAt: '2026-09-15T11:00:00Z' },
      { id: 'navwarn:later-publication', sourceRecordId: 'later-publication',
        publishedAt: '2026-09-15T11:30:00Z', effectiveAt: '2026-09-15T12:30:00Z',
        zoneAState: 'restricted_10_knots', appliesTo: 'vessels_over_13_m', cancels: null,
        sourceUrl: 'https://example.test/later', lastFetchedAt: '2026-09-15T11:00:00Z' },
      { id: 'navwarn:published-after-query', sourceRecordId: 'published-after-query',
        publishedAt: '2026-09-15T13:30:00Z', effectiveAt: '2026-09-15T12:00:00Z',
        zoneAState: 'no_restriction_stated', appliesTo: 'vessels_over_13_m', cancels: null,
        sourceUrl: 'https://example.test/after', lastFetchedAt: '2026-09-15T14:00:00Z' },
    ];
    for (const notice of notices) {
      await db.query(`INSERT INTO navwarn_notices (id, source, source_record_id, zone_id,
        published_at, effective_at, zone_a_state, applies_to, cancels, source_url, raw_text, last_fetched_at)
        VALUES ($1, 'canadian_coast_guard_navwarn', $2, 'zone_a', $3, $4, $5, $6, $7, $8, 'fixture', $9)`,
      [notice.id, notice.sourceRecordId, notice.publishedAt, notice.effectiveAt,
        notice.zoneAState, notice.appliesTo, notice.cancels, notice.sourceUrl, notice.lastFetchedAt]);
    }
    const expected = getRestrictionAt(at, notices, { status: 'never', lastSuccessAt: null },
      new Date('2026-09-24T00:00:00Z'));
    assert.equal(expected.notice?.id, 'navwarn:later-publication');
    const server = Fastify();
    registerDomainRoutes(server, db);
    try {
      const response = await server.inject(`/api/query/restriction?at=${at}`);
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().notice.id, expected.notice?.id);
      assert.equal(response.json().statement, expected.statement);
      assert.deepEqual(response.json().evidenceIds, expected.evidenceIds);
      const before = await server.inject('/api/query/restriction?at=2026-09-15T09:00:00Z');
      assert.equal(before.statusCode, 200);
      assert.equal(before.json().status, 'unknown');
    } finally {
      await server.close();
    }
  } finally {
    if (db) await db.end();
    try {
      if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  }
});

test('detection SQL separates a source-local review day, Story date bounds and the global latest row', async () => {
  const schema = `detection_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  let db: pg.Pool | null = null;
  const server = Fastify();
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    db = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    for (const [id, date, time] of [['one', '2026-09-14', '2026-09-14 15:23:53'],
      ['two', '2026-09-14', '2026-09-14 15:38:53'], ['later', '2026-09-22', '2026-09-22 12:00:00']]) {
      await db.query(`INSERT INTO whoi_detections
        (id, source, source_record_id, zone_id, review_date, source_local_time, occurrence,
         platform_latitude, platform_longitude, source_url, raw_text, last_fetched_at)
        VALUES ($1, 'whoi_robots4whales', $1, 'zone_a', $2, $3, 'detected', 49.358, -64.687,
          'https://example.test/review', 'test fixture', now())`, [id, date, time]);
    }
    registerDomainRoutes(server, db);
    const dated = await server.inject('/api/query/detections?date=2026-09-14');
    assert.equal(dated.statusCode, 200, dated.body);
    assert.deepEqual(dated.json().evidenceIds, ['one', 'two']);
    assert.equal(dated.json().detections[0].sourceLocalTime, '2026-09-14 15:23:53');
    assert.deepEqual((await server.inject('/api/query/latest-detection?scope=story&throughDate=2026-09-15')).json().evidenceIds, ['two']);
    assert.deepEqual((await server.inject('/api/query/latest-detection?scope=story&throughDate=2026-09-13')).json().evidenceIds, []);
    assert.deepEqual((await server.inject('/api/query/latest-detection')).json().evidenceIds, ['later']);
    const empty = (await server.inject('/api/query/detections?date=2026-09-15')).json();
    assert.deepEqual(empty.evidenceIds, []);
    assert.match(empty.warning, /does not establish whale absence or a reviewed zero/);
  } finally {
    await server.close();
    if (db) await db.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await admin.end(); }
  }
});
