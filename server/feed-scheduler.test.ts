import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { createFeedScheduler, nextFeedCheck } from './feed-scheduler.js';

test('freshness uses successful fetch time, missing/invalid dates are due, failed attempts back off', () => {
  const status = { lastSuccessAt: new Date(1000), lastAttemptAt: new Date(1000), lastAttemptStatus: 'success' };
  assert.equal(nextFeedCheck(status, 1000, 1500), 2000);
  assert.equal(nextFeedCheck(status, 1000, 3000), 3000);
  assert.equal(nextFeedCheck(undefined, 1000, 3000), 3000);
  assert.equal(nextFeedCheck({ ...status, lastSuccessAt: 'invalid' }, 1000, 3000), 3000);
  assert.equal(nextFeedCheck({ ...status, lastSuccessAt: new Date(9000) }, 1000, 3000), 3000);
  assert.equal(nextFeedCheck({ ...status, lastAttemptAt: new Date(2800), lastAttemptStatus: 'error' }, 1000, 3000), 3800);
});

test('fresh restart schedules remaining interval; due refresh is coalesced and close cancels timers', async () => {
  let at = 1500; let refreshes = 0; let reads = 0; let cancelled = false;
  let scheduled: { callback: () => void; delay: number } | undefined;
  const status = { lastSuccessAt: new Date(1000), lastAttemptAt: new Date(1000), lastAttemptStatus: 'success' };
  const scheduler = createFeedScheduler({ source: 'test', intervalMs: 1000, now: () => at,
    db: { query: async () => { reads++; return { rows: [status] }; } } as unknown as Pick<Pool, 'query'>,
    refresh: async () => { refreshes++; status.lastSuccessAt = new Date(at); },
    schedule: (callback, delay) => { scheduled = { callback, delay }; return () => { cancelled = true; }; },
    onError: error => { throw error; },
  });
  await scheduler.check();
  assert.equal(refreshes, 0); assert.equal(scheduled?.delay, 500);
  at = 2000;
  await Promise.all([scheduler.check(), scheduler.check(), scheduler.check()]);
  assert.equal(refreshes, 1); assert.equal(reads, 2); assert.equal(scheduled?.delay, 1000);
  await scheduler.close(); assert.equal(cancelled, true);
  await scheduler.check(); assert.equal(reads, 2);
});

test('failed refresh and database outage do not advance success or spin; restart honors durable failure', async () => {
  let at = 3000; let refreshes = 0; let errors = 0; let delay = 0; let outage = false;
  const status = { lastSuccessAt: new Date(1000), lastAttemptAt: new Date(1000), lastAttemptStatus: 'success' };
  const options = { source: 'test', intervalMs: 1000, now: () => at,
    db: { query: async () => { if (outage) throw new Error('offline'); return { rows: [status] }; } } as unknown as Pick<Pool, 'query'>,
    refresh: async () => { refreshes++; status.lastAttemptAt = new Date(at); status.lastAttemptStatus = 'error'; throw new Error('provider'); },
    schedule: (_callback: () => void, ms: number) => { delay = ms; return () => {}; },
    onError: () => { errors++; },
  };
  const first = createFeedScheduler(options);
  await first.check(); await first.check();
  assert.equal(refreshes, 1); assert.equal(delay, 1000); assert.equal(status.lastSuccessAt.getTime(), 1000);
  await first.close();
  at = 3500;
  const restarted = createFeedScheduler(options);
  await restarted.check(); assert.equal(refreshes, 1); assert.equal(delay, 500);
  outage = true; at = 4000;
  await restarted.check(); assert.equal(errors, 2); assert.equal(delay, 1000);
  outage = false;
  await restarted.check(); assert.equal(refreshes, 1);
  at = 5000; await restarted.check(); assert.equal(refreshes, 2);
  await restarted.close();
});
