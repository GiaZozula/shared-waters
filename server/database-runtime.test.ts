import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimePool } from './database.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('Set TEST_DATABASE_URL to an isolated local test database.');
test('server-side query timeout cancels real work and the pool recovers without leaking settings', async () => {
  const db = createRuntimePool({ connectionString, max: 2, query_timeout: 2000, connectionTimeoutMillis: 1000 }, 35);
  try {
    await assert.rejects(db.query('SELECT pg_sleep(0.2)'), { code: '57014' });
    assert.equal((await db.query('SELECT 1 AS value')).rows[0].value, 1);
    const raw = await db.connect();
    try { assert.equal((await raw.query('SHOW statement_timeout')).rows[0].statement_timeout, '0'); }
    finally { raw.release(); }
  } finally { await db.end(); }
});
