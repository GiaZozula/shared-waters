// Only for the dedicated disposable compose experiment database.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(`${process.cwd()}/package.json`);
const pg = require('pg');
const url = new URL(process.env.TEST_DATABASE_URL ?? '');
if (url.hostname !== 'db' || url.pathname !== '/scale_experiment') throw new Error('Expected the isolated scale compose database.');
const { migrateSchema, applicationTables, verifyRuntime } = await import(pathToFileURL(`${process.cwd()}/build/server/schema-contract.js`).href);
const db = new pg.Pool({ connectionString: url.toString() });
try {
  const client = await db.connect();
  try {
    await migrateSchema(client);
    await client.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scale_runtime') THEN CREATE ROLE scale_runtime LOGIN PASSWORD 'local_scale_only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF; END $$");
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query('GRANT CONNECT ON DATABASE scale_experiment TO scale_runtime');
    await client.query('GRANT USAGE ON SCHEMA public TO scale_runtime');
    for (const { name } of applicationTables) {
      await client.query(`REVOKE ALL ON ${name} FROM scale_runtime`);
      await client.query(`GRANT ${name === 'historical_presence' ? 'SELECT' : 'SELECT, INSERT, UPDATE'} ON ${name} TO scale_runtime`);
    }
    await client.query('GRANT DELETE ON whoi_detections TO scale_runtime');
    await client.query('REVOKE ALL ON schema_migrations FROM scale_runtime');
    await client.query('GRANT SELECT ON schema_migrations TO scale_runtime');
    await client.query('SET ROLE scale_runtime');
    await verifyRuntime(client);
    await client.query('RESET ROLE');
  } finally { client.release(); }
} finally { await db.end(); }
