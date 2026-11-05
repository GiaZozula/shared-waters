import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { migrateSchema } from './schema-contract.js';
import { createCollectionOwner, OWNER_LOCK } from './collection-owner.js';
import { createCollectionRuntime } from './collection-runtime.js';
import { touchCollectionDemand, readCollectionState } from './collection-state.js';

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
const log = { info() {}, warn() {}, error() {} };
const waitFor = async (predicate: () => boolean | Promise<boolean>) => {
  const end = Date.now() + 5000;
  while (!(await predicate())) {
    if (Date.now() >= end) throw new Error('Timed out waiting for shared collection state');
    await new Promise(resolve => setTimeout(resolve, 15));
  }
};
async function isolated(run: (pool: pg.Pool, second: pg.Pool, url: string) => Promise<void>) {
  const schema = `collection_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.toString() });
  const second = new pg.Pool({ connectionString: url.toString() });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const client = await pool.connect();
    try { await migrateSchema(client); } finally { client.release(); }
    await run(pool, second, url.toString());
  } finally {
    await Promise.all([pool.end(), second.end()]);
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

test('either API can activate the owner, demand stays bounded, and reader expiry stops AIS', async () => {
  await isolated(async (db, apiB, url) => {
    let starts = 0, stops = 0, feedRequests = 0;
    const owner = createCollectionOwner({ url, intervalMs: 20, onState() {},
      start: (signal, failed, session) => createCollectionRuntime({ db, session, signal, failed, log,
        pollMs: 20, maxActiveMs: 10_000,
        feeds: [{ source: 'fixture-feed', intervalMs: 60_000, async refresh() { feedRequests++; } }],
        startAis() { starts++; return async () => { stops++; }; },
      }),
    });
    try {
      await waitFor(() => owner.owned && feedRequests === 1);
      assert.equal(starts, 0, 'readiness and ownership alone must not start on-demand AIS');
      await touchCollectionDemand(db);
      await waitFor(() => starts === 1);
      await Promise.all([touchCollectionDemand(apiB), touchCollectionDemand(db)]);
      assert.equal((await db.query('SELECT count(*) FROM collection_control')).rows[0].count, '1');
      assert.equal((await readCollectionState(apiB)).state, 'active');
      await db.query("UPDATE collection_control SET demand_until = clock_timestamp() - interval '1 second'");
      await waitFor(() => stops === 1);
      await waitFor(async () => (await readCollectionState(db)).state === 'idle');
      assert.equal(starts, 1);
    } finally { await owner.close(); }
  });
});

test('ownership handover preserves the shared session cooldown and avoids an early reconnect', async () => {
  await isolated(async (db, apiB, url) => {
    let starts = 0, active = 0, peak = 0;
    const make = () => createCollectionOwner({ url, intervalMs: 20, onState() {},
      start: (signal, failed, session) => createCollectionRuntime({ db, session, signal, failed, log,
        feeds: [], pollMs: 20, maxActiveMs: 100, cooldownMs: 5000,
        startAis() {
          starts++; active++; peak = Math.max(peak, active);
          return async () => { active--; };
        },
      }),
    });
    await touchCollectionDemand(apiB);
    const a = make(), b = make();
    try {
      await waitFor(() => starts === 1);
      await waitFor(async () => (await readCollectionState(db)).state === 'cooldown');
      await db.query(`SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory'
        AND classid = $1::oid AND objid = $2::oid AND objsubid = 2 AND granted`, [...OWNER_LOCK]);
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.equal(starts, 1, 'a successor must retain the previous cooldown');
      await db.query("UPDATE collection_control SET resume_at = clock_timestamp() - interval '1 second'");
      await waitFor(() => starts === 2);
      assert.equal(peak, 1);
    } finally { await Promise.all([a.close(), b.close()]); }
    assert.equal(active, 0);
  });
});

test('daily reservations are shared, survive restart and migration, and stop at twenty-four sessions', async () => {
  await isolated(async (db, second) => {
    const { reserveAisSession, AIS_DAILY_MS } = await import('./ais-daily-budget.js');
    const [a, b] = await Promise.all([db.connect(), second.connect()]);
    try {
      const bursts = await Promise.all([a, b].map(async client => {
        const results: Array<number | null> = [];
        for (let i = 0; i < 14; i++) results.push(await reserveAisSession(client));
        return results;
      }));
      const attempts = bursts.flat();
      assert.equal(attempts.filter(value => value !== null).length, 24);
      assert.equal(Number((await db.query('SELECT reserved_ms FROM ais_daily_budget')).rows[0].reserved_ms), AIS_DAILY_MS);
      await migrateSchema(a);
      assert.equal(await reserveAisSession(b), null, 'migration and another connection cannot replenish today');
      await db.query("UPDATE ais_daily_budget SET reserved_until = clock_timestamp() - interval '1 second'");
      assert.equal((await readCollectionState(second)).state, 'daily-limit');
      await db.query("UPDATE ais_daily_budget SET budget_day = (clock_timestamp() AT TIME ZONE 'UTC')::date - 1");
      assert.ok(await reserveAisSession(b), 'a new UTC day gets its own allowance');
      assert.equal(Number((await db.query('SELECT reserved_ms FROM ais_daily_budget')).rows[0].reserved_ms), 900_000);
    } finally { a.release(); b.release(); }
  });
});

test('exhausted daily allowance blocks the collector, including always mode', async () => {
  await isolated(async (db, _second, url) => {
    await db.query("UPDATE ais_daily_budget SET reserved_ms = 21600000, reserved_until = clock_timestamp() - interval '1 second'");
    let starts = 0;
    const owner = createCollectionOwner({ url, intervalMs: 20, onState() {},
      start: (signal, failed, session) => createCollectionRuntime({ db, session, signal, failed, log,
        always: true, feeds: [], pollMs: 20,
        startAis() { starts++; return async () => {}; },
      }),
    });
    try {
      await waitFor(() => owner.owned);
      assert.equal((await readCollectionState(db)).state, 'daily-limit');
      assert.equal(starts, 0);
    } finally { await owner.close(); }
  });
});
