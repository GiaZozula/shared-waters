import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { refreshWhoi } from './whoi-store.js';
import { refreshNavwarn } from './navwarn-store.js';
import { createFeedScheduler } from './feed-scheduler.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Set TEST_DATABASE_URL to a local test database.');

const mission = `<h2>Daily analyst review</h2><a href="dal2606_sable_html/dal2606_sable_manual_analysis_table_20260924.html">09/24/2026</a>
<a href="dal2606_sable_html/dal2606_sable_manual_analysis_table_20260914.html">09/14/2026</a>`;
const emptyReview = '<h3>Right whale:</h3><table><tr><th>Date/time (local)</th><th>Occurrence</th><th>Latitude</th><th>Longitude</th></tr></table>';
const detectionReview = `<h3>Right whale:</h3><table><tr><th>Date/time (local)</th><th>Occurrence</th><th>Latitude</th><th>Longitude</th></tr>
<tr><td>09/14/26 15:23:53</td><td>Detected</td><td>49.3576</td><td>-64.6864</td></tr></table>`;
const navwarn = `<h1>Search for NAVWARNs</h1><p>Navigational Warnings</p><table><tr>
<td><a href="/public/rest/messages/en/message/185999">NW-C-4078-26</a></td><td>2026-09-23 11:30 UTC</td>
<td>Routeing Change - North Atlantic Right Whale</td><td>Effective 231230 UTC Sep 2026, the following North Atlantic Right Whale restriction Zones are in effect for all vessels greater than 13 meters in length overall: Dynamic Shipping Zones A, B, and D: Vessels must not exceed 10 knots over ground. Dynamic Shipping Zones C and E: No restriction in effect.</td></tr></table>`;

const whoiFetch = (async (url: string | URL) => new Response(
  String(url).endsWith('.shtml') ? mission : String(url).includes('20260914.html') ? detectionReview : emptyReview,
)) as typeof fetch;
// The public search form uses q (not searchTerms); unsupported fields return unrelated notices.
const navwarnFetch = (async (input) => {
  const url = new URL(String(input));
  if (url.searchParams.get('q') !== 'North Atlantic Right Whale' ||
      url.searchParams.has('searchTerms') || url.searchParams.get('status') !== 'PUBLISHED' ||
      !['10', '20', '40'].includes(url.searchParams.get('maxHits') ?? '')) {
    return new Response('<h1>Search for NAVWARNs</h1><p>Navigational Warnings</p><table><tr><td>Unrelated published notice</td></tr></table>');
  }
  return new Response(navwarn);
}) as typeof fetch;
const correctedReview = '<h3>Right whale:</h3><table><tr><th>Date/time (local)</th><th>Occurrence</th><th>Latitude</th><th>Longitude</th></tr></table>';
const correctedWhoiFetch = (async (url: string | URL) => new Response(
  String(url).endsWith('.shtml') ? mission : String(url).includes('20260914.html') ? correctedReview : emptyReview,
)) as typeof fetch;
const olderNavwarn = navwarn.replace('NW-C-4078-26', 'NW-C-3975-26')
  .replace('2026-09-23 11:30', '2026-09-15 10:40').replace('231230 UTC Sep', '151230 UTC Sep');
const olderNavwarnFetch = (async () => new Response(olderNavwarn)) as typeof fetch;

test('feed refreshes reconcile source corrections and preserve records after failure', async () => {
  // Each run owns a disposable schema so repeated tests cannot count or alter preview records.
  const schema = `feed_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  let db: pg.Pool | null = null;
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    db = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    assert.deepEqual(await refreshWhoi(db, whoiFetch), { reviews: 2, detections: 1 });
    assert.deepEqual(await refreshNavwarn(db, navwarnFetch), { notices: 1 });
    await refreshWhoi(db, whoiFetch);
    await refreshNavwarn(db, navwarnFetch);
    const reviews = await db.query('SELECT COUNT(*)::int AS count FROM whoi_reviews');
    const detections = await db.query('SELECT COUNT(*)::int AS count FROM whoi_detections');
    const notices = await db.query('SELECT COUNT(*)::int AS count FROM navwarn_notices');
    assert.equal(reviews.rows[0].count, 2);
    assert.equal(detections.rows[0].count, 1);
    assert.equal(notices.rows[0].count, 1);
    const partialWhoiFetch = (async (url: string | URL) => new Response(
      String(url).endsWith('.shtml') ? mission : '<h3>Fin whale:</h3><table><tr><th>Date/time (local)</th></tr></table>',
    )) as typeof fetch;
    await assert.rejects(refreshWhoi(db, partialWhoiFetch), /right-whale section missing/);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM whoi_detections')).rows[0].count, 1);
    assert.equal((await db.query("SELECT detection_count FROM whoi_reviews WHERE review_date = '2026-09-14'")).rows[0].detection_count, 1);
    await refreshWhoi(db, correctedWhoiFetch);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM whoi_detections')).rows[0].count, 0);
    assert.equal((await db.query("SELECT detection_count FROM whoi_reviews WHERE review_date = '2026-09-14'")).rows[0].detection_count, 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await refreshNavwarn(db, olderNavwarnFetch);
    const currentNotice = await db.query(`SELECT source_record_id FROM navwarn_notices
      ORDER BY CASE WHEN last_fetched_at =
        (SELECT last_success_at FROM feed_status WHERE source = 'canadian_coast_guard_navwarn')
        THEN 0 ELSE 1 END, published_at DESC LIMIT 1`);
    assert.equal(currentNotice.rows[0].source_record_id, 'NW-C-3975-26');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM navwarn_notices')).rows[0].count, 2);
    const brokenFetch = (async () => { throw new Error('source unavailable'); }) as typeof fetch;
    await assert.rejects(refreshWhoi(db, brokenFetch));
    await assert.rejects(refreshNavwarn(db, brokenFetch));
    const states = await db.query(`SELECT source, last_attempt_status, last_success_at FROM feed_status
      WHERE source IN ('whoi_robots4whales', 'canadian_coast_guard_navwarn') ORDER BY source`);
    assert.equal(states.rows.length, 2);
    assert.ok(states.rows.every((row) => row.last_attempt_status === 'error' && row.last_success_at));
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM navwarn_notices')).rows[0].count, 2);
    // Recreate the process scheduler against the real durable failure rows.
    // Freshly failed sources must not immediately recontact an upstream on wake.
    let requests = 0;
    for (const source of states.rows.map(row => String(row.source))) {
      let delay = 0;
      const scheduler = createFeedScheduler({ db, source, intervalMs: 60_000,
        refresh: async () => { requests++; }, onError: error => { throw error; },
        schedule: (_callback, ms) => { delay = ms; return () => {}; },
      });
      await scheduler.check(); await scheduler.close();
      assert.ok(delay > 50_000 && delay <= 60_000);
    }
    assert.equal(requests, 0);
  } finally {
    if (db) await db.end();
    try {
      if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  }
});
