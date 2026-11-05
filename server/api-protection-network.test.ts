import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import { registerApiProtection } from './api-protection.js';

test('disconnecting a real HTTP client does not release unfinished handler capacity', async () => {
  const app = Fastify(); let release: () => void = () => {}; let entered: () => void = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const guard = registerApiProtection(app, { maxActive: 1 });
  app.get('/api/slow', async () => { entered(); await pending; return { ok: true }; });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  try {
    const abandoned = fetch(`${address}/api/slow`, { signal: controller.signal }).catch(error => error);
    await started; controller.abort(); await abandoned; await delay(10);
    assert.equal(guard.snapshot().active, 1);
    assert.equal((await fetch(`${address}/api/slow`)).status, 503);
    release(); await delay(10);
    assert.equal((await fetch(`${address}/api/slow`)).status, 200);
    assert.equal(guard.snapshot().active, 0);
  } finally { release(); await app.close(); }
});
