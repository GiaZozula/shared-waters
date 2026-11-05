import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import pg from 'pg';
import { WebSocketServer } from 'ws';
import { startAisCollector } from './ais-collector.js';
import { registerAisRoute } from './ais-routes.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Set TEST_DATABASE_URL to a local test database.');

async function until(check: () => Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Timed out waiting for AIS collector state');
}

test('AIS repeat is deduplicated and a reconnect preserves the last stored row', async () => {
  const schema = `ais_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  let db: pg.Pool | null = null;
  let stop: (() => Promise<void>) | null = null;
  let websocketServer: WebSocketServer | null = null;
  const app = Fastify();
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    db = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    registerAisRoute(app, db);
    const initial = await app.inject('/api/current/ais');
    assert.equal(initial.statusCode, 200);
    assert.equal(initial.json().data.status, 'unknown');
    websocketServer = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => websocketServer!.once('listening', resolve));
    const port = (websocketServer.address() as { port: number }).port;
    let connections = 0;
    websocketServer.on('connection', (socket) => {
      connections++;
      socket.once('message', (bytes) => {
        const subscription = JSON.parse(bytes.toString());
        assert.equal(subscription.APIKey, 'test-key');
        assert.deepEqual(subscription.BoundingBoxes, [[[49.183333, -65], [49.683333, -64]]]);
        socket.send(JSON.stringify({ MessageType: 'SubscriptionConfirmation', Message: { CompressionEnabled: true } }));
        const now = new Date();
        const frame = JSON.stringify({ MessageType: 'PositionReport',
          MetaData: { MMSI: 316123456, ShipName: 'TEST', time_utc: now.toISOString() },
          Message: { PositionReport: { UserID: 316123456, Latitude: 49.35, Longitude: -64.7,
            Sog: 8.2, Timestamp: now.getUTCSeconds(), Valid: true } } });
        const outside = JSON.stringify({ MessageType: 'PositionReport',
          MetaData: { MMSI: 316123456, ShipName: 'OUTSIDE', time_utc: now.toISOString() },
          Message: { PositionReport: { UserID: 316123456, Latitude: 49.2, Longitude: -64.9,
            Sog: 9, Timestamp: now.getUTCSeconds(), Valid: true } } });
        if (connections === 1) {
          socket.send(frame);
          socket.send(frame);
          socket.send(outside);
          setTimeout(() => socket.close(), 100);
        }
      });
    });
    const log = { info() {}, warn() {}, error(error: unknown) { throw error; } };
    stop = startAisCollector(db, log, 'test-key', { url: `ws://127.0.0.1:${port}`, reconnectBaseMs: 30 });
    await until(async () => (await db!.query('SELECT COUNT(*)::int AS count FROM ais_positions')).rows[0].count === 1);
    await until(async () => (await db!.query('SELECT frames_outside FROM ais_connection_status')).rows[0]?.frames_outside === 1);
    await until(async () => connections >= 2);
    const stored = await db.query('SELECT id, speed_knots FROM ais_positions');
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].speed_knots, 8.2);
    const current = await app.inject('/api/current/ais');
    assert.equal(current.statusCode, 200);
    assert.equal(current.json().data.positions.length, 1);
    assert.equal(current.json().data.status, 'recent_messages');
    assert.equal(current.json().connection.framesReceived, 3);
    assert.equal(current.json().connection.framesOutside, 1);
    assert.equal(current.json().connection.framesStored, 1);
    assert.equal(current.json().connection.framesUnparsed, 0);
    assert.equal(current.json().data.lastStored !== null, true);
    await db.query(`UPDATE ais_connection_status SET checked_at = now() - interval '2 minutes' WHERE source = 'aisstream'`);
    const stale = await app.inject('/api/current/ais');
    assert.equal(stale.json().connection.status, 'unverified');
    assert.equal(stale.json().data.status, 'unknown');
    assert.equal(stale.json().data.positions.length, 0);
  } finally {
    if (stop) await stop();
    if (websocketServer) await new Promise<void>((resolve) => websocketServer!.close(() => resolve()));
    await app.close();
    if (db) await db.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
