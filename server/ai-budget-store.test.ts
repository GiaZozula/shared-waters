import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { BudgetFailure, reserveAiCall, type AiPolicy } from './ai-budget.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Set TEST_DATABASE_URL to an isolated local database.');
const policy: AiPolicy = { clientCalls: 3, clientWindowSeconds: 600, siteCalls: 20,
  siteWindowSeconds: 3600, concurrency: 1, totalCalls: 100, identitySecret: 'test-only-identity-secret-32-characters' };

test('PostgreSQL admission serializes replicas, persists allowance, rolls windows, and fails closed', async () => {
  const schema = `budget_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  let db: pg.Pool | undefined;
  let replica: pg.Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const options = { connectionString: databaseUrl, options: `-c search_path=${schema}` };
    db = new pg.Pool(options); replica = new pg.Pool(options);
    const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    await db.query(sql);
    const burst = await Promise.allSettled(Array.from({ length: 12 }, (_, i) =>
      reserveAiCall(i % 2 ? db! : replica!, `peer-${i}`, policy)));
    const accepted = burst.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof reserveAiCall>>> => r.status === 'fulfilled');
    assert.equal(accepted.length, 1);
    for (const r of burst) if (r.status === 'rejected') assert.equal(r.reason.reason, 'ai_busy');
    await accepted[0].value.finish();
    await db.query('TRUNCATE ai_call_reservations');
    await db.query('UPDATE ai_budget_state SET used_calls = 0');
    const limited = { ...policy, concurrency: 20, totalCalls: 2 };
    const totalBurst = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => reserveAiCall(i % 2 ? db! : replica!, `peer-${i}`, limited)));
    assert.equal(totalBurst.filter(r => r.status === 'fulfilled').length, 2);
    for (const r of totalBurst) if (r.status === 'fulfilled') await r.value.finish();
    await db.end(); db = new pg.Pool(options); // new process/pool and migration cannot replenish allowance
    await db.query(sql);
    await assert.rejects(reserveAiCall(db, 'new-peer', limited), { reason: 'ai_budget_exhausted' });
    assert.equal(Number((await db.query('SELECT used_calls FROM ai_budget_state')).rows[0].used_calls), 2);
    // A deliberate owner allowance increase permits more calls without erasing history.
    await db.query('TRUNCATE ai_call_reservations');
    for (let i = 0; i < 3; i++) await (await reserveAiCall(db, 'same-peer', policy)).finish();
    await assert.rejects(reserveAiCall(replica, 'same-peer', policy), (error: unknown) => {
      assert.ok(error instanceof BudgetFailure);
      assert.equal(error.reason, 'ai_frequency_limit');
      assert.ok(error.retryAfterSeconds! > 0 && error.retryAfterSeconds! <= 600);
      return true;
    });
    await (await reserveAiCall(replica, 'different-peer', policy)).finish();
    await assert.rejects(reserveAiCall(db, 'third-peer', { ...policy, siteCalls: 4 }), { reason: 'ai_frequency_limit' });
    await db.query("UPDATE ai_call_reservations SET started_at = clock_timestamp() - interval '2 hours'");
    await (await reserveAiCall(db, 'same-peer', policy)).finish();
    const hashes = (await db.query('SELECT client_key FROM ai_call_reservations')).rows;
    assert.ok(hashes.every(r => /^[a-f0-9]{64}$/.test(r.client_key)));
    const abandoned = await reserveAiCall(db, 'abandoned', policy);
    await db.end(); db = new pg.Pool(options);
    await assert.rejects(reserveAiCall(db, 'after-restart', policy), { reason: 'ai_busy' });
    await abandoned.finish().catch(() => {}); // closed pool cannot accidentally release its reservation
    await db.query('DROP TABLE ai_budget_state');
    await assert.rejects(reserveAiCall(db, 'storage-failure', policy), { reason: 'ai_budget_unavailable' });
    assert.equal(Number((await db.query('SELECT count(*) FROM ai_call_reservations WHERE finished_at IS NULL')).rows[0].count), 1);
  } finally {
    await db?.end(); await replica?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
  }
});

test('connection failure is classified as unavailable', async () => {
  await assert.rejects(reserveAiCall({ connect: async () => { throw new Error('down'); } } as unknown as pg.Pool,
    'peer', policy), BudgetFailure);
});
