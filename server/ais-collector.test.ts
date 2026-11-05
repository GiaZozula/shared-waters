import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { WebSocketServer } from 'ws';
import { startAisCollector } from './ais-collector.js';

test('a rejected subscription reconnects without logging the upstream secret', async () => {
  const websocketServer = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => websocketServer.once('listening', resolve));
  const port = (websocketServer.address() as { port: number }).port;
  const messages: unknown[][] = [];
  let connected: () => void = () => {};
  const confirmed = new Promise<void>(resolve => { connected = resolve; });
  const db = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Pool;
  let connections = 0;
  websocketServer.on('connection', socket => {
    connections++;
    socket.once('message', () => {
      socket.send(JSON.stringify(connections === 1
        ? { error: 'rejected secret-test-key' }
        : { MessageType: 'SubscriptionConfirmation' }));
    });
  });
  const stop = startAisCollector(db, {
    info(...args) {
      messages.push(args);
      if (args[1] === 'AIS subscription confirmed') connected();
    },
    warn(...args) { messages.push(args); },
    error(...args) { messages.push(args); },
  }, 'secret-test-key', { url: `ws://127.0.0.1:${port}`, reconnectBaseMs: 10 });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      confirmed,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('No reconnect')), 2000); }),
    ]);
    assert.equal(connections, 2);
    assert.equal(JSON.stringify(messages).includes('secret-test-key'), false);
    assert.ok(JSON.stringify(messages).includes('AIS subscription rejected'));
  } finally {
    clearTimeout(timeout);
    await stop();
    await new Promise<void>(resolve => websocketServer.close(() => resolve()));
  }
});

test('a burst against stalled persistence stops at the bounded backlog instead of growing a promise chain', async () => {
  const websocketServer = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => websocketServer.once('listening', resolve));
  const port = (websocketServer.address() as { port: number }).port;
  let unblock: () => void = () => {}; let queries = 0; let paused: () => void = () => {};
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  const halted = new Promise<void>(resolve => { paused = resolve; });
  const db = { query: async () => { queries++; if (queries === 1) await blocked; return { rows: [], rowCount: 0 }; } } as unknown as Pool;
  websocketServer.on('connection', socket => socket.once('message', () => {
    socket.send(JSON.stringify({ MessageType: 'SubscriptionConfirmation' }));
    for (let i = 0; i < 100; i++) socket.send('{not-json');
  }));
  const stop = startAisCollector(db, { info() {}, error() {}, warn(_data, message) {
    if (message === 'AIS collection paused by resource limit') paused();
  } }, 'local-test', { url: `ws://127.0.0.1:${port}`, maxPending: 4 });
  const timer = setTimeout(() => { unblock(); }, 1500);
  try {
    await Promise.race([halted, new Promise((_, reject) => setTimeout(() => reject(new Error('Backlog was not bounded')), 2000))]);
    unblock(); await stop(); assert.ok(queries <= 3, `discard queued work after halt; queries=${queries}`);
  } finally { unblock(); clearTimeout(timer); await stop(); await new Promise<void>(resolve => websocketServer.close(() => resolve())); }
});
