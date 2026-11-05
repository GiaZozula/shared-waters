import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveRefresh } from './live-refresh.js';

test('Live refresh waits for completion, pauses, and refreshes immediately on return', async () => {
  let active = true;
  let calls = 0;
  let release: () => void = () => {};
  let scheduled: (() => void) | undefined;
  let delay = 0;
  const refresh = createLiveRefresh({
    active: () => active,
    load: () => { calls++; return new Promise<void>(resolve => { release = resolve; }); },
    schedule(callback, ms) {
      scheduled = callback;
      delay = ms;
      return () => { scheduled = undefined; };
    },
  });
  refresh.resume();
  refresh.resume();
  assert.equal(calls, 1, 'slow responses must not overlap');
  assert.equal(scheduled, undefined);
  release();
  await Promise.resolve();
  assert.equal(delay, 15_000);
  assert.ok(scheduled);
  (scheduled as () => void)();
  assert.equal(calls, 2);
  refresh.pause();
  release();
  await Promise.resolve();
  assert.equal(scheduled, undefined, 'an in-flight response must not restart a paused loop');
  active = false;
  refresh.resume();
  assert.equal(calls, 2, 'Story or a hidden tab must not request Live data');
  active = true;
  refresh.resume();
  assert.equal(calls, 3);
  refresh.pause();
  release();
  await Promise.resolve();
});
