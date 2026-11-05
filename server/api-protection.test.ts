import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import { registerApiProtection } from './api-protection.js';

test('concurrent fixed reads coalesce, cache briefly, expire, and never cache failures', async () => {
  let now = 1000; let reads = 0; let fail = false;
  const app = Fastify();
  const guard = registerApiProtection(app, { now: () => now, cacheMs: { '/api/read': 100 }, burst: 1000 });
  app.get('/api/read', async (_request, reply) => {
    reads++; await delay(15);
    if (fail) return reply.code(503).send({ error: 'upstream' });
    return { observedAt: '2026-09-14T00:00:00Z', reads };
  });
  try {
    const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => app.inject(`/api/read?ignored=${i}`)));
    assert.ok(burst.every(result => result.statusCode === 200)); assert.equal(reads, 1);
    assert.equal(guard.snapshot().coalesced, 7);
    const hit = await app.inject('/api/read');
    assert.equal(hit.headers['x-data-cache'], 'HIT'); assert.equal(reads, 1);
    assert.equal(hit.json().observedAt, '2026-09-14T00:00:00Z');
    now += 101; fail = true;
    const failures = await Promise.all([app.inject('/api/read'), app.inject('/api/read')]);
    assert.ok(failures.every(result => result.statusCode === 503));
    assert.equal(guard.snapshot().cacheEntries, 0);
    fail = false;
    assert.equal((await app.inject('/api/read')).statusCode, 200); assert.equal(reads, 3);
  } finally { await app.close(); }
});

test('admission sheds immediately, reserves separate health capacity, and recovers', async () => {
  const app = Fastify(); let release: () => void = () => {}; let entered: () => void = () => {};
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const work = new Promise<void>(resolve => { release = resolve; });
  const guard = registerApiProtection(app, { maxActive: 1, burst: 100 });
  app.get('/api/slow', async () => { entered(); await work; return { ok: true }; });
  app.get('/api/health', async () => ({ ok: true }));
  try {
    const first = app.inject('/api/slow'); await waiting;
    const refused = await app.inject('/api/slow');
    assert.equal(refused.statusCode, 503); assert.equal(refused.headers['retry-after'], '1');
    assert.equal((await app.inject('/api/health')).statusCode, 200);
    assert.equal(guard.snapshot().active, 1);
    release(); assert.equal((await first).statusCode, 200);
    assert.equal((await app.inject('/api/slow')).statusCode, 200);
    assert.equal(guard.snapshot().active, 0);
  } finally { release(); await app.close(); }
});

test('a response timeout does not release still-running work into an unbounded queue', async () => {
  const app = Fastify({ handlerTimeout: 25 }); let release: () => void = () => {};
  const work = new Promise<void>(resolve => { release = resolve; });
  const guard = registerApiProtection(app, { maxActive: 1, burst: 100 });
  app.get('/api/slow', async () => { await work; return { ok: true }; });
  const keepAlive = setTimeout(() => {}, 2000);
  try {
    assert.equal((await app.inject('/api/slow')).statusCode, 503);
    assert.equal(guard.snapshot().active, 1);
    assert.equal((await app.inject('/api/slow')).json().error, 'api_overloaded');
    release(); await delay(5); assert.equal(guard.snapshot().active, 0);
  } finally { release(); clearTimeout(keepAlive); await app.close(); }
});

test('the shared request bucket replenishes and does not memoize question POSTs', async () => {
  let now = 0; let calls = 0;
  const app = Fastify(); registerApiProtection(app, { now: () => now, burst: 2, requestsPerSecond: 1 });
  app.post('/api/ask', async () => ({ calls: ++calls }));
  try {
    for (let i = 0; i < 2; i++) assert.equal((await app.inject({ method: 'POST', url: '/api/ask' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/ask' })).statusCode, 429);
    now = 1000;
    assert.equal((await app.inject({ method: 'POST', url: '/api/ask' })).statusCode, 200);
    assert.equal(calls, 3);
  } finally { await app.close(); }
});

test('trusted nested reads reuse one public slot, while external headers cannot bypass admission', async () => {
  const { injectInternalRead } = await import('./internal-read.js');
  const app = Fastify();
  let release: () => void = () => {}, entered: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const guard = registerApiProtection(app, {maxActive: 1, burst: 100});
  app.get('/api/current/ais', async () => ({ok: true}));
  app.get('/api/query/current-state', async () => {
    const result = await injectInternalRead(app, '/api/current/ais');
    entered(); await gate;
    return {nestedStatus: result.statusCode};
  });
  try {
    const parent = app.inject('/api/query/current-state'); await started;
    const denied = await app.inject({url: '/api/current/ais', headers: {'x-internal-read': 'true'}});
    assert.equal(denied.statusCode, 503);
    assert.equal(guard.snapshot().active, 1);
    release();
    assert.deepEqual((await parent).json(), {nestedStatus: 200});
    assert.equal(guard.snapshot().active, 0);
    assert.equal(guard.snapshot().accepted, 1);
    assert.throws(() => injectInternalRead(app, '/api/ask'), /Unsupported internal read/);
  } finally { release(); await app.close(); }
});

test('an admitted model question can execute a tool with a single HTTP slot and token', async () => {
  const {registerAgentRoutes} = await import('./agent.js');
  const app = Fastify();
  const guard = registerApiProtection(app, {maxActive: 1, burst: 1});
  let admissions = 0, finishes = 0, modelCalls = 0;
  app.get('/api/current/marine', async () => ({fetch: {status: 'never'}, data: {status: 'missing', observation: null}}));
  registerAgentRoutes(app, {} as never, async () => {
    modelCalls++;
    return {id: 'fake', status: 'completed', output: [{type: 'function_call', name: 'get_marine_conditions', arguments: '{}', call_id: 'one'}]};
  }, async () => { admissions++; return {remaining: 1, finish: async () => {finishes++;}}; });
  try {
    const result = await app.inject({method: 'POST', url: '/api/ask', payload: {question: 'What are the current waves?'}});
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(admissions, 1); assert.equal(finishes, 1); assert.equal(modelCalls, 1);
    assert.equal(guard.snapshot().accepted, 1);
    assert.equal((await app.inject('/api/current/marine')).statusCode, 429);
  } finally {await app.close();}
});
