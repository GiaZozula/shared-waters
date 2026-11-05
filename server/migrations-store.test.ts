import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { migrateSchema, migrations, schemaHash, schemaSql, verifyRuntime, verifySchema } from './schema-contract.js';

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');

async function isolated(run: (pool: pg.Pool, schema: string, admin: pg.Pool) => Promise<void>) {
  const schema = `migration_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.toString() });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await run(pool, schema, admin);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}

test('parallel migrations serialize; reapplication preserves spent AI calls and reservations', async () => {
  await isolated(async pool => {
    // Legacy schema already contains evidence/admission state before ledger adoption.
    await pool.query(schemaSql);
    await pool.query('UPDATE ai_budget_state SET used_calls = 7 WHERE id = 1');
    await pool.query('INSERT INTO ai_call_reservations (id, client_key) VALUES ($1, $2)', [randomUUID(), 'private-test']);
    const clients = await Promise.all([pool.connect(), pool.connect(), pool.connect()]);
    try { await Promise.all(clients.map(migrateSchema)); } finally { clients.forEach(c => c.release()); }
    const client = await pool.connect();
    try { await migrateSchema(client); } finally { client.release(); }
    assert.equal((await pool.query('SELECT used_calls FROM ai_budget_state')).rows[0].used_calls, '7');
    assert.equal((await pool.query('SELECT count(*) FROM ai_call_reservations WHERE finished_at IS NULL')).rows[0].count, '1');
    assert.deepEqual((await pool.query('SELECT version, checksum FROM schema_migrations')).rows,
      migrations.map(({ version, checksum }) => ({ version, checksum })));
  });
});

test('failed legacy adoption rolls back all new schema/ledger work', async () => {
  await isolated(async pool => {
    await pool.query('CREATE TABLE historical_presence (id text PRIMARY KEY)');
    const client = await pool.connect();
    try { await assert.rejects(migrateSchema(client)); } finally { client.release(); }
    assert.equal((await pool.query("SELECT to_regclass('schema_migrations') AS ledger, to_regclass('ai_budget_state') AS budget")).rows[0].ledger, null);
    assert.equal((await pool.query("SELECT to_regclass('ai_budget_state') AS budget")).rows[0].budget, null);
    assert.equal((await pool.query('SELECT count(*) FROM historical_presence')).rows[0].count, '0');
  });
});

test('checksum mismatch and missing columns/indexes stop delivery instead of rewriting recorded history', async () => {
  await isolated(async pool => {
    const client = await pool.connect();
    try {
      await migrateSchema(client);
      await client.query("UPDATE schema_migrations SET checksum = 'changed' WHERE version = 1");
      await assert.rejects(migrateSchema(client), /version\/checksum/);
      await client.query('UPDATE schema_migrations SET checksum = $1 WHERE version = 1', [schemaHash]);
      await client.query('DROP INDEX ai_calls_active');
      await assert.rejects(migrateSchema(client), /Missing required index/);
      await client.query('CREATE INDEX ai_calls_active ON ai_call_reservations (id) WHERE finished_at IS NULL');
      await client.query('ALTER TABLE ais_connection_status DROP COLUMN frames_received');
      await assert.rejects(verifySchema(client), /frames_received/);
    } finally { client.release(); }
  });
});

test('separate runtime role reads/writes app state but cannot migrate, truncate, or modify the ledger', async () => {
  await isolated(async (pool, schema, admin) => {
    const role = `runtime_${randomUUID().replaceAll('-', '')}`;
    const owner = await pool.connect();
    let runtime: pg.PoolClient | undefined;
    try {
      await migrateSchema(owner);
      await assert.rejects(verifyRuntime(owner), /administrative|create schema/);
      await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS`);
      await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
      await admin.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
      await admin.query(`REVOKE INSERT, UPDATE ON ${schema}.historical_presence FROM ${role}`);
      await admin.query(`GRANT DELETE ON ${schema}.whoi_detections TO ${role}`);
      await admin.query(`REVOKE ALL ON ${schema}.schema_migrations FROM ${role}`);
      await admin.query(`GRANT SELECT ON ${schema}.schema_migrations TO ${role}`);
      runtime = await pool.connect();
      await runtime.query(`SET ROLE ${role}`);
      await verifyRuntime(runtime);
      await runtime.query('UPDATE ai_budget_state SET used_calls = used_calls + 1 WHERE id = 1');
      await runtime.query('DELETE FROM whoi_detections WHERE false');
      await assert.rejects(runtime.query('CREATE TABLE unauthorized (id integer)'), /permission denied/);
      await assert.rejects(runtime.query('TRUNCATE ai_budget_state'), /permission denied/);
      await assert.rejects(runtime.query('UPDATE schema_migrations SET version = 2'), /permission denied/);
      await assert.rejects(migrateSchema(runtime), /permission denied/);
      await runtime.query('RESET ROLE');
    } finally {
      if (runtime) { await runtime.query('RESET ROLE').catch(() => {}); runtime.release(); }
      owner.release();
      // Unique test role, only objects in this disposable schema.
      await admin.query(`DROP OWNED BY ${role}`).catch(() => {});
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
    }
  });
});


test('a previous-compatible build accepts additive future history without rewriting it or paid state', async () => {
  await isolated(async pool => {
    const client = await pool.connect();
    try {
      await migrateSchema(client);
      await client.query('UPDATE ai_budget_state SET used_calls = 11 WHERE id = 1');
      await client.query('CREATE TABLE future_collector_control (id integer PRIMARY KEY, demand_until timestamptz)');
      await client.query('INSERT INTO future_collector_control VALUES (1, now())');
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [migrations.length + 1, 'a'.repeat(64)]);
      const before = (await client.query('SELECT * FROM schema_migrations ORDER BY version')).rows;
      await verifySchema(client);
      await migrateSchema(client);
      assert.deepEqual((await client.query('SELECT * FROM schema_migrations ORDER BY version')).rows, before);
      assert.equal((await client.query('SELECT count(*) FROM future_collector_control')).rows[0].count, '1');
      assert.equal((await client.query('SELECT used_calls FROM ai_budget_state')).rows[0].used_calls, '11');
      await client.query('ALTER TABLE historical_presence DROP COLUMN latitude');
      await assert.rejects(verifySchema(client), /latitude/);
    } finally { client.release(); }
  });
});
