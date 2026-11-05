import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { createAisPreview } from './ais-preview.js'
import type { ApiReadiness } from './api-readiness.js'

function fixture(initialMode: 'intro' | 'story' | 'live' = 'story') {
  let now = 0, ready = false, calls = 0
  let status = 'connected', positions: unknown[] = []
  let fail = false
  const timers = new Set<{ callback: () => void; ms: number }>()
  let notify = () => {}
  const readiness = {
    snapshot: () => ({ state: ready ? 'ready' : 'loading' }),
    subscribe(listener: () => void) { notify = listener; listener(); return () => {} },
  } as unknown as ApiReadiness
  const controller = createAisPreview({ mode: initialMode, readiness,
    now: () => now,
    schedule(callback, ms) { const timer = { callback, ms }; timers.add(timer); return () => { timers.delete(timer) } },
    fetcher: async () => { calls++; if (fail) throw new Error('offline'); return new Response(JSON.stringify({ connection: { status }, data: { positions } }), { status: 200 }) },
  })
  return { controller, timers, get calls() { return calls },
    ready() { ready = true; notify() }, time(value: number) { now = value },
    feed(next: string, nextPositions: unknown[] = []) { status = next; positions = nextPositions },
    fail() { fail = true },
    async poll() { const timer = [...timers][0]; assert.ok(timer); timers.delete(timer); timer.callback(); await setImmediate() },
  }
}

test('AIS waits for readiness and visibility; Intro makes no collection reads', async () => {
  const f = fixture('intro')
  f.controller.setVisible(true); f.ready(); await setImmediate()
  assert.equal(f.calls, 0)
  f.controller.setMode('story'); await setImmediate()
  assert.equal(f.calls, 1)
  assert.match(f.controller.snapshot().message, /waiting for positions/)
  f.controller.setVisible(false)
  assert.equal(f.timers.size, 0)
  assert.equal(f.controller.snapshot().state, 'paused')
  f.controller.close()
})

test('Story preview stops after 90 seconds; Live continues and distinguishes receipt', async () => {
  const f = fixture()
  f.controller.setVisible(true); assert.equal(f.calls, 0)
  f.ready(); await setImmediate()
  f.time(90_000); await f.poll()
  assert.equal(f.calls, 1)
  assert.equal(f.controller.snapshot().state, 'paused')
  assert.equal(f.timers.size, 0)
  f.controller.setVisible(false); f.controller.setVisible(true); await setImmediate()
  assert.equal(f.calls, 1, 'tab return must not silently renew the Story budget')
  f.feed('connected', [{ id: 'position' }]); f.controller.setMode('live'); await setImmediate()
  assert.match(f.controller.snapshot().message, /1 vessel in recent records/)
  f.time(180_000); await f.poll()
  assert.equal(f.calls, 3)
  f.controller.close(); assert.equal(f.timers.size, 0)
})

test('Failed checks never retain a connected claim; returning to Intro stops reads', async () => {
  const f = fixture()
  f.controller.setVisible(true); f.ready(); await setImmediate()
  f.fail(); await f.poll()
  assert.equal(f.controller.snapshot().state, 'unavailable')
  assert.equal(f.controller.snapshot().data, null)
  f.controller.setMode('intro'); assert.equal(f.timers.size, 0)
  assert.equal(f.controller.snapshot().state, 'idle')
  f.controller.close()
})


test('an explicit retry renews an expired Story preview without overlapping requests', async () => {
  const f = fixture()
  f.controller.setVisible(true); f.ready(); await setImmediate()
  f.time(90_000); await f.poll()
  assert.equal(f.controller.snapshot().state, 'paused')
  f.controller.retry(); f.controller.retry(); await setImmediate()
  assert.equal(f.calls, 2, 'duplicate retries must coalesce')
  assert.equal(f.controller.snapshot().state, 'connected')
  f.time(180_000); await f.poll()
  assert.equal(f.calls, 2)
  assert.equal(f.controller.snapshot().state, 'paused')
  f.controller.close()
})

test('sitewide collection pauses on inactivity and requires explicit resume after session expiry', async () => {
  let now = 0, calls = 0;
  const timers = new Set<() => void>();
  const readiness = { snapshot: () => ({ state: 'ready' }), subscribe: () => () => {} } as unknown as ApiReadiness;
  const controller = createAisPreview({ readiness, mode: 'intro', sitewide: true, now: () => now,
    schedule(callback) { timers.add(callback); return () => { timers.delete(callback) } },
    fetcher: async () => { calls++; return new Response(JSON.stringify({ connection: { status: 'connected' }, data: { positions: [] } })) },
  });
  const poll = async () => { const callback = [...timers][0]; assert.ok(callback); timers.delete(callback); callback(); await setImmediate() };
  controller.setVisible(true); await setImmediate();
  assert.equal(calls, 1, 'visible Intro participates');
  now = 10 * 60_000; await poll();
  assert.equal(controller.snapshot().state, 'paused');
  controller.activity(); controller.setMode('system'); await setImmediate();
  assert.equal(calls, 1, 'ordinary activity does not silently resume a paused session');
  controller.retry(); await setImmediate(); assert.equal(calls, 2);
  now = 39 * 60_000; controller.activity();
  now = 40 * 60_000; await poll();
  assert.equal(controller.snapshot().state, 'paused', 'active use still reaches the 30-minute limit');
  controller.setVisible(false); controller.retry(); await setImmediate(); assert.equal(calls, 2);
  controller.setVisible(true); await setImmediate(); assert.equal(calls, 3);
  controller.close(); assert.equal(timers.size, 0);
});

test('daily allowance stops repeated reads and can recheck on a visible new UTC day', async () => {
  let now = 1, calls = 0;
  const timers = new Set<() => void>();
  const readiness = { snapshot: () => ({ state: 'ready' }), subscribe: () => () => {} } as unknown as ApiReadiness;
  const controller = createAisPreview({ readiness, mode: 'system', sitewide: true, now: () => now,
    schedule(callback) { timers.add(callback); return () => { timers.delete(callback) } },
    fetcher: async () => { calls++; return new Response(JSON.stringify({ collection: { state: 'daily-limit' }, connection: { status: 'disconnected' }, data: { positions: [] } })) },
  });
  controller.setVisible(true); await setImmediate();
  assert.equal(calls, 1);
  assert.match(controller.snapshot().message, /allowance has been reached/);
  controller.retry(); controller.activity(); await setImmediate();
  assert.equal(calls, 1, 'Resume cannot bypass the shared daily stop');
  controller.setVisible(false);
  assert.equal(timers.size, 0);
  now = 86_400_001;
  controller.setVisible(true); controller.retry(); await setImmediate();
  assert.equal(calls, 2, 'new-day visible session may ask the server again');
  controller.close();
});
