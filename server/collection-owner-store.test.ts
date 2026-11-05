import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { createCollectionOwner, OWNER_LOCK } from './collection-owner.js';

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
const waitFor = async (predicate: () => boolean | Promise<boolean>) => {
  const end = Date.now() + 4000;
  while (!(await predicate())) {
    if (Date.now() >= end) throw new Error('Timed out waiting for collector ownership');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

test('two collector sessions elect one owner, abort on session loss, and hand over without controlled overlap', async () => {
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let starts = 0, stops = 0, active = 0, peak = 0;
  const states: string[] = [];
  const make = () => createCollectionOwner({ url: process.env.TEST_DATABASE_URL!, intervalMs: 25,
    onState: state => states.push(state),
    async start(signal) {
      starts++; active++; peak = Math.max(peak, active);
      let stopped = false;
      const stop = async () => { if (!stopped) { stopped = true; active--; stops++; } };
      signal.addEventListener('abort', () => { void stop(); }, { once: true });
      return stop;
    },
  });
  const first = make(), second = make();
  try {
    await waitFor(() => first.owned || second.owned);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(starts, 1);
    assert.equal(active, 1);
    assert.notEqual(first.owned, second.owned);
    const before = Date.now();
    const result = await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_locks
      WHERE locktype = 'advisory' AND classid = $1::oid AND objid = $2::oid AND objsubid = 2 AND granted`, [...OWNER_LOCK]);
    assert.equal(result.rowCount, 1);
    await waitFor(() => starts === 2 && (first.owned || second.owned));
    assert.ok(Date.now() - before < 4000);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(starts, 2, 'the previous owner must not restart while another session holds the lock');
    assert.equal(stops, 1);
    assert.equal(active, 1);
    assert.equal(peak, 1);
    assert.ok(states.includes('disconnected'));
  } finally {
    await Promise.all([first.close(), second.close()]);
    assert.equal(active, 0);
    assert.equal(stops, starts);
    assert.equal((await admin.query(`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'
      AND classid = $1::oid AND objid = $2::oid AND objsubid = 2 AND granted`, [...OWNER_LOCK])).rows[0].count, '0');
    await admin.end();
  }
});


test('a failed collector shutdown still releases its advisory session', async () => {
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let started = false;
  const owner = createCollectionOwner({ url: process.env.TEST_DATABASE_URL!, intervalMs: 20,
    onState: state => { if (state === 'owner') started = true; },
    async start() { return async () => { throw new Error('Fixture shutdown failure'); }; },
  });
  try {
    await waitFor(() => started);
    await assert.rejects(owner.close(), /Fixture shutdown failure/);
    assert.equal(owner.owned, false);
    assert.equal((await admin.query(`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'
      AND classid = $1::oid AND objid = $2::oid AND objsubid = 2 AND granted`, [...OWNER_LOCK])).rows[0].count, '0');
  } finally { await owner.close(); await admin.end(); }
});
