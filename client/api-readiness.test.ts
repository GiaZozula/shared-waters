import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiReadiness } from './api-readiness.js';

const ready = () => Response.json({ service: 'shared-waters', api: 'connected', database: 'connected' });
test('one long wake coalesces callers, validates readiness, and never becomes a keepalive', async () => {
  let calls = 0; let release: (value: Response) => void = () => {};
  const states: string[] = [];
  const wake = createApiReadiness({ fetcher: (() => { calls++; return new Promise(resolve => { release = resolve; }); }) as typeof fetch });
  wake.subscribe(value => states.push(value.state));
  const pending = wake.start(); void wake.start();
  assert.equal(calls, 1); assert.equal(wake.snapshot().state, 'loading');
  release(ready()); await pending;
  await wake.start(); assert.equal(calls, 1);
  assert.deepEqual(states, ['idle', 'loading', 'ready']); wake.close();
});

test('HTML host pages, incorrect JSON, offline, database failure and timeout remain unavailable; only explicit retry runs', async () => {
  for (const response of [new Response('<html>Loading</html>'), Response.json({ api: 'connected' }),
    Response.json({ service: 'shared-waters', api: 'connected', database: 'disconnected' }, { status: 503 }), null]) {
    let at = 10_000; let calls = 0;
    const wake = createApiReadiness({ now: () => at, fetcher: (async () => { calls++; if (!response) throw new Error('offline'); return response; }) as typeof fetch });
    await wake.start(); assert.equal(wake.snapshot().state, 'unavailable');
    await wake.start(); assert.equal(calls, 1); assert.equal(wake.snapshot().retryAfterSeconds, 5);
    at += 5000; await wake.start(); assert.equal(calls, 2); wake.close();
  }
  const wake = createApiReadiness({ timeoutMs: 5, fetcher: ((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
  })) as typeof fetch });
  await wake.start(); assert.equal(wake.snapshot().state, 'unavailable'); wake.close();
});

test('navigation retains elapsed start only, rechecks readiness, rejects stale/future state and survives blocked storage', async () => {
  for (const saved of ['95000', '1', '999999', 'garbage']) {
    let stored: string | null = saved; let calls = 0;
    const wake = createApiReadiness({ now: () => 100_000,
      storage: { getItem: () => stored, setItem: (_key, value) => { stored = value; }, removeItem: () => { stored = null; } },
      fetcher: (async () => { calls++; return ready(); }) as typeof fetch,
    });
    // '1' is within the two-minute window; a genuinely stale start is tested below.
    assert.equal(wake.snapshot().startedAt, saved === '95000' ? 95000 : saved === '1' ? 1 : 100_000);
    await wake.start(); assert.equal(calls, 1); assert.equal(stored, null); wake.close();
  }
  const blocked = () => { throw new Error('blocked'); };
  const wake = createApiReadiness({ storage: { getItem: blocked, setItem: blocked, removeItem: blocked }, fetcher: (async () => ready()) as typeof fetch });
  await wake.start(); assert.equal(wake.snapshot().state, 'ready'); wake.close();
  const stale = createApiReadiness({ now: () => 500_000, storage: { getItem: () => '1', setItem() {}, removeItem() {} } });
  assert.equal(stale.snapshot().startedAt, 500_000); stale.close();
});
