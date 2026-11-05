import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSceneWithDeadline } from './scene-load.js';

test('failed scene download is reported and a successful load returns its module', async () => {
  const module = { createWorld: () => {} };
  assert.equal(await loadSceneWithDeadline(async () => module), module);
  await assert.rejects(loadSceneWithDeadline(async () => { throw Error('download unavailable'); }), /download unavailable/);
});

test('a stalled import has a bounded wait and late completion does not run scene creation', async () => {
  let resolve!: (value: { createWorld: () => void }) => void;
  let created = 0;
  const pending = loadSceneWithDeadline(() => new Promise<{ createWorld: () => void }>(done => { resolve = done; }), 5)
    .then(module => module.createWorld());
  await assert.rejects(pending, /scene_load_timeout/);
  resolve({ createWorld: () => { created++; } });
  await Promise.resolve();
  assert.equal(created, 0);
});
