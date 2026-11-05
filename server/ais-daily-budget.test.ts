import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { createCollectionRuntime } from './collection-runtime.js';

const log = { info() {}, warn() {}, error() {} };
test('reservation deadline closes an open collector even before the next database poll', async () => {
  let starts = 0, stops = 0;
  const session = { async query(sql: string) {
    if (sql.includes('RETURNING extract')) return { rowCount: 1, rows: [{ deadline: Date.now() + 40 }] };
    return { rowCount: 1, rows: [{ demand: new Date(Date.now() + 10000), active: null, now: Date.now() }] };
  } } as unknown as pg.Client;
  const controller = new AbortController();
  const stop = await createCollectionRuntime({ db: {} as pg.Pool, session, signal: controller.signal, failed() {}, log,
    feeds: [], pollMs: 60_000, startAis() { starts++; return async () => { stops++; }; },
  });
  try {
    assert.equal(starts, 1);
    await delay(80);
    assert.equal(stops, 1, 'local deadline must not depend on another successful database check');
  } finally { await stop(); }
  assert.equal(stops, 1);
});

test('a failed reservation never opens the upstream socket', async () => {
  let starts = 0;
  const session = { async query(sql: string) {
    if (sql.includes('ais_daily_budget')) throw new Error('database unavailable');
    return { rowCount: 1, rows: [{ demand: new Date(Date.now() + 10000), active: null, now: Date.now() }] };
  } } as unknown as pg.Client;
  await assert.rejects(createCollectionRuntime({ db: {} as pg.Pool, session, signal: new AbortController().signal,
    failed() {}, log, feeds: [], startAis() { starts++; return async () => {}; },
  }), /database unavailable/);
  assert.equal(starts, 0);
});
