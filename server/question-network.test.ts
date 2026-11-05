import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import type pg from 'pg';
import { registerAgentRoutes } from './test-admission.js';
import { registerApiProtection } from './api-protection.js';
import { registerDomainRoutes } from './domain-routes.js';

test('a completed HTTP POST body does not cancel a pending model selection', async () => {
  const app = Fastify({ handlerTimeout: 1000 });
  registerApiProtection(app);
  let modelAborted = false;
  const db = { query: async (sql: string) => ({ rows: sql.includes('UNION SELECT') ? [{ id: 'whoi:one' }] : [{
    id: 'whoi:one', reviewDate: '2026-09-14', sourceLocalTime: '2026-09-14 15:23:53',
    occurrence: 'detected', sourceUrl: 'https://example.test/review',
  }] }) } as unknown as pg.Pool;
  registerDomainRoutes(app, db);
  registerAgentRoutes(app, db, async (_body, signal) => {
    await delay(30);
    modelAborted = signal.aborted;
    signal.throwIfAborted();
    return { id: 'stub', status: 'completed', output: [{ type: 'function_call', name: 'get_detections_on_date',
      arguments: JSON.stringify({ date: '2026-09-14' }), call_id: 'dated' }] };
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    const response = await fetch(`${address}/api/ask`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        question: 'What detections were recorded on September 14, 2026?', mode: 'story',
        selectedTime: '2026-09-14T12:00:00Z',
      }) });
    const body = await response.json() as { answer: string; evidenceIds: string[] };
    assert.equal(modelAborted, false, 'normal body completion cancelled the model');
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.match(body.answer, /2026-09-14 15:23:53/);
    assert.deepEqual(body.evidenceIds, ['whoi:one']);
  } finally { await app.close(); }
});

test('a disconnected question client cancels the model but holds admission until work settles', async () => {
  const app = Fastify({ handlerTimeout: 1000 });
  const guard = registerApiProtection(app, { maxActive: 1 });
  let enter: () => void = () => {}; let release: () => void = () => {};
  let cancelled: () => void = () => {};
  const started = new Promise<void>(resolve => { enter = resolve; });
  const aborted = new Promise<void>(resolve => { cancelled = resolve; });
  const work = new Promise<void>(resolve => { release = resolve; });
  registerAgentRoutes(app, {} as pg.Pool, async (_body, signal) => {
    signal.addEventListener('abort', cancelled, { once: true });
    enter(); await work; signal.throwIfAborted();
    return { id: 'stub', status: 'completed', output: [] };
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  try {
    const response = fetch(`${address}/api/ask`, { method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'latest detection?' }) }).catch(() => {});
    await started; controller.abort(); await response;
    await Promise.race([aborted, delay(500).then(() => { throw new Error('disconnect did not cancel model'); })]);
    assert.equal(guard.snapshot().active, 1);
    release(); await delay(20);
    assert.equal(guard.snapshot().active, 0);
  } finally { release(); await app.close(); }
});

test('a fully received POST still has a response deadline and retains its handler lease', async () => {
  const app = Fastify({ handlerTimeout: 40 });
  const guard = registerApiProtection(app, { maxActive: 1 });
  let release: () => void = () => {};
  const work = new Promise<void>(resolve => { release = resolve; });
  app.post('/api/slow', async () => { await work; return { ok: true }; });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    const response = await fetch(`${address}/api/slow`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 503);
    assert.equal(guard.snapshot().active, 1);
    release(); await delay(20);
    assert.equal(guard.snapshot().active, 0);
  } finally { release(); await app.close(); }
});
