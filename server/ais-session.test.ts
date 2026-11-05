import assert from 'node:assert/strict';
import test from 'node:test';
import { createAisSession } from './ais-session.js';

test('a visit starts one collector and a returning visit waits for idle shutdown', async () => {
  let starts = 0;
  let stops = 0;
  let shuttingDown: () => void = () => {};
  let stopped: () => void = () => {};
  const shutdownStarted = new Promise<void>(resolve => { shuttingDown = resolve; });
  const session = createAisSession({
    idleMs: 20,
    onError(error) { throw error; },
    start() {
      starts++;
      return async () => {
        stops++;
        if (stops === 1) {
          shuttingDown();
          await new Promise<void>(resolve => { stopped = resolve; });
        }
      };
    },
  });
  // Keep the test alive: the production idle timer deliberately does not do so.
  const keepAlive = setTimeout(() => {}, 2000);
  try {
    await Promise.all([session.touch(), session.touch()]);
    assert.equal(starts, 1);
    await shutdownStarted;
    const returning = session.touch();
    await Promise.resolve();
    assert.equal(starts, 1, 'do not start a second collector until the old one closes');
    stopped();
    await returning;
    assert.equal(starts, 2);
    await session.close();
    assert.equal(stops, 2);
    await session.touch();
    assert.equal(starts, 2, 'closed sessions must not restart');
  } finally {
    stopped();
    await session.close();
    clearTimeout(keepAlive);
  }
});

test('continued reads cannot extend the hard session limit or bypass cooldown', async () => {
  let starts = 0; const reasons: (string | undefined)[] = [];
  const session = createAisSession({ idleMs: 1000, maxActiveMs: 30, cooldownMs: 40,
    onError(error) { throw error; }, start() { starts++; return async reason => { reasons.push(reason); }; } });
  const keepAlive = setTimeout(() => {}, 2000);
  try {
    await session.touch();
    for (let i = 0; i < 5; i++) { await new Promise(resolve => setTimeout(resolve, 8)); await session.touch(); }
    assert.equal(session.snapshot().state, 'cooldown'); assert.equal(starts, 1);
    assert.match(reasons[0]!, /session limit/);
    await new Promise(resolve => setTimeout(resolve, 45)); await session.touch();
    assert.equal(starts, 2); assert.equal(session.snapshot().state, 'active');
  } finally { await session.close(); clearTimeout(keepAlive); }
});
