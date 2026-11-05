import 'dotenv/config';
import pg from 'pg';
import { databasePoolOptions } from './database.js';
import { applicationTables, verifySchema } from './schema-contract.js';

// Provision the login separately. This grants only the current app's table contract;
// it never changes passwords, PUBLIC privileges, role ownership or role membership.
const role = process.env.RUNTIME_DATABASE_ROLE;
if (!role || !/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error('Set a simple lowercase RUNTIME_DATABASE_ROLE.');
if (!process.env.MIGRATION_DATABASE_URL) throw new Error('Set MIGRATION_DATABASE_URL.');
const db = new pg.Pool({ ...databasePoolOptions(process.env.MIGRATION_DATABASE_URL), max: 1, query_timeout: 15_000 });
try {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10000ms'");
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    await client.query('SELECT pg_advisory_xact_lock(734921, 1)');
    await verifySchema(client);
    const { rows } = await client.query('SELECT current_user = $1 AS same_role', [role]);
    if (rows[0].same_role) throw new Error('Runtime and migration roles must differ.');
    for (const { name } of applicationTables) {
      await client.query(`REVOKE ALL ON TABLE ${name} FROM "${role}"`);
      const privileges = name === 'historical_presence' ? 'SELECT' : 'SELECT, INSERT, UPDATE';
      await client.query(`GRANT ${privileges} ON TABLE ${name} TO "${role}"`);
    }
    await client.query(`GRANT DELETE ON TABLE whoi_detections TO "${role}"`);
    // Keep the deployment ledger owner-written, including on legacy databases.
    await client.query(`REVOKE ALL ON TABLE schema_migrations FROM "${role}"`);
    await client.query(`GRANT SELECT ON TABLE schema_migrations TO "${role}"`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
  console.log('Application table grants applied to the separate runtime role.');
} catch {
  console.error('Runtime grants failed; inspect database/role configuration privately.');
  process.exitCode = 1;
} finally { await db.end(); }
