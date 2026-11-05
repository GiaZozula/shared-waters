import 'dotenv/config';
import pg from 'pg';
import { databasePoolOptions } from './database.js';
import { migrateSchema, migrations } from './schema-contract.js';

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set MIGRATION_DATABASE_URL (or local DATABASE_URL) before migrating.');
const db = new pg.Pool({ ...databasePoolOptions(databaseUrl), max: 1, query_timeout: 65_000 });
try {
  const client = await db.connect();
  try { await migrateSchema(client); } finally { client.release(); }
  console.log(`Schema migration and verification complete (known version ${migrations.at(-1)!.version}).`);
} catch {
  // pg errors can include connection strings or SQL; keep deployment logs private by construction.
  console.error('Migration failed; transaction rolled back. Inspect the target privately before retrying.');
  process.exitCode = 1;
} finally {
  await db.end();
}
