import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerWakeRoute } from './wake.js';
import { registerApiProtection } from './api-protection.js';

test('wake verifies database for each visit and uses ordinary API admission instead of health capacity', async () => {
  const server = Fastify(); let queries = 0;
  const protection = registerApiProtection(server, { burst: 2, requestsPerSecond: 0 });
  registerWakeRoute(server, { query: async (sql: string) => { queries++; assert.equal(sql, 'SELECT 1'); return { rows: [] }; } } as unknown as Pick<Pool, 'query'>);
  try {
    const first = await server.inject('/api/wake'); const second = await server.inject('/api/wake');
    assert.deepEqual(first.json(), { service: 'shared-waters', api: 'connected', database: 'connected' });
    assert.equal(second.statusCode, 200); assert.equal(queries, 2);
    assert.equal(protection.snapshot().healthActive, 0);
    assert.equal((await server.inject('/api/wake')).statusCode, 429);
  } finally { await server.close(); }
});
test('database failure cannot claim browser readiness', async () => {
  const server = Fastify();
  registerWakeRoute(server, { query: async () => { throw new Error('offline'); } } as unknown as Pick<Pool, 'query'>);
  try {
    const response = await server.inject('/api/wake');
    assert.equal(response.statusCode, 503); assert.equal(response.json().database, 'disconnected');
  } finally { await server.close(); }
});
