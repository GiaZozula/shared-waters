import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import pg from 'pg';
import { parseAisPosition } from './ais.js';
import { storeAisPosition, setAisConnectionStatus } from './ais-store.js';
import { registerAisRoute } from './ais-routes.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Set TEST_DATABASE_URL to a local test database.');

test('delayed and future AIS records remain stored but cannot enter current Live positions', async () => {
  const schema = `ais_freshness_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({connectionString: databaseUrl});
  let db: pg.Pool | undefined;
  const app = Fastify();
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    db = new pg.Pool({connectionString: databaseUrl, options: `-c search_path=${schema}`});
    await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await setAisConnectionStatus(db, 'connected');
    const now = new Date();
    for (const [mmsi, offset] of [[316123451, -2 * 3600_000], [316123452, 3600_000], [316123453, -60_000]]) {
      const observed = new Date(now.getTime() + offset).toISOString();
      const position = parseAisPosition({MessageType: 'PositionReport', MetaData: {MMSI: mmsi, time_utc: observed},
        Message: {PositionReport: {UserID: mmsi, Latitude: 49.35, Longitude: -64.7, Timestamp: 0, Sog: 5}}}, now);
      assert.ok(position);
      await storeAisPosition(db, position);
    }
    registerAisRoute(app, db);
    const response = (await app.inject('/api/current/ais')).json();
    assert.equal(response.data.status, 'recent_messages');
    assert.deepEqual(response.data.positions.map((row: {mmsi: string}) => row.mmsi), ['316123453']);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM ais_positions')).rows[0].count, 3);
    const old = (await db.query('SELECT observed_at, received_at FROM ais_positions WHERE mmsi = $1', ['316123451'])).rows[0];
    assert.equal(old.received_at.getTime() - old.observed_at.getTime(), 2 * 3600_000);
    await setAisConnectionStatus(db, 'disconnected');
    const disconnected = (await app.inject('/api/current/ais')).json();
    assert.equal(disconnected.data.status, 'unknown');
    assert.deepEqual(disconnected.data.positions, []);
  } finally {
    await app.close();
    await db?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
