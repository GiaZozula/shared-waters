import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { AisCapacityError, setAisConnectionStatus, storeAisPosition } from './ais-store.js';
import type { AisPosition } from './ais.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('Set TEST_DATABASE_URL to an isolated local database.');
test('concurrent AIS writers cannot exceed a shared row cap; existing data is preserved', async () => {
  const schema = `ais_cap_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString }); let db: pg.Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    db = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 5 });
    await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await setAisConnectionStatus(db, 'connected');
    const position = (i: number): AisPosition => ({ id: `fixture:${i}`, sourceRecordId: `fixture:${i}`,
      mmsi: String(316000000 + i), observedAt: new Date().toISOString(), receivedAt: new Date().toISOString(),
      latitude: 49.35, longitude: -64.7, speedKnots: 8, shipName: 'LOCAL FIXTURE',
      sourceUrl: 'https://example.test/ais', rawPayload: { fixture: true } });
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => storeAisPosition(db!, position(i), 2)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
    for (const result of results) if (result.status === 'rejected') assert.ok(result.reason instanceof AisCapacityError);
    const rows = await db.query('SELECT id, source_record_id FROM ais_positions ORDER BY id');
    assert.equal(rows.rowCount, 2);
    const duplicate = position(Number(rows.rows[0].id.split(':')[1]));
    assert.equal(await storeAisPosition(db, duplicate, 2), false);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM ais_positions')).rows[0].n, 2);
  } finally { await db?.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
});
