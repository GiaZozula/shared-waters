import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { refreshMarine } from './marine-store.js';
import { refreshWhoi } from './whoi-store.js';
import { refreshNavwarn } from './navwarn-store.js';

test('ownership loss aborts all feed HTTP adapters without writing obsolete failure status', async () => {
  for (const refresh of [refreshMarine, refreshWhoi, refreshNavwarn]) {
    const controller = new AbortController();
    let writes = 0, requests = 0;
    const db = { query: async () => { writes++; throw new Error('Obsolete source status write'); },
      connect: async () => { writes++; throw new Error('Obsolete source transaction'); } } as unknown as pg.Pool;
    const fetcher: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      requests++;
      const signal = init?.signal;
      assert.ok(signal);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    const pending = refresh(db, fetcher, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(requests, 1);
    assert.equal(writes, 0);
  }
});
