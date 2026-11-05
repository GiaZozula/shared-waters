import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type pg from 'pg';

export const schemaSql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
export const schemaHash = createHash('sha256').update(schemaSql).digest('hex');
// Append migrations here; never change a recorded SQL file/checksum.
const collectionSql = await readFile(new URL('./migrations/002-collection-control.sql', import.meta.url), 'utf8');
const dailySql = await readFile(new URL('./migrations/003-ais-daily-budget.sql', import.meta.url), 'utf8');
export const migrations = [
  { version: 1, sql: schemaSql, checksum: schemaHash },
  { version: 2, sql: collectionSql, checksum: createHash('sha256').update(collectionSql).digest('hex') },
  { version: 3, sql: dailySql, checksum: createHash('sha256').update(dailySql).digest('hex') },
] as const;

type MigrationRow = { version: number; checksum: string };

// Older compatible builds verify their known prefix, not the total ledger length.
// Future entries are owner-written; this is a compatibility check, not a claim
// that arbitrary future SQL preserves every application behavior.
export function verifyMigrationLedger(rows: MigrationRow[], requireCurrent = true): void {
  if (requireCurrent && rows.length < migrations.length) {
    throw new Error('Schema version/checksum differs from this build.');
  }
  for (const [index, row] of rows.entries()) {
    const known = migrations[index];
    if (row.version !== index + 1 || !/^[a-f0-9]{64}$/.test(row.checksum) ||
        (known && (row.version !== known.version || row.checksum !== known.checksum))) {
      throw new Error('Schema version/checksum differs from this build.');
    }
  }
}

export const applicationTables = [...migrations.map(m => m.sql).join('\n').matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)]
  .map(([, name, body]) => ({ name, columns: [...body.matchAll(/^  ([a-z_]+) /gm)].map(match => match[1]) }));

// Identifier inputs here come only from the checked-in SQL, never from requests.
export async function verifySchema(client: pg.PoolClient, requireLedger = true): Promise<void> {
  if (requireLedger) {
    const { rows } = await client.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
    verifyMigrationLedger(rows);
  }
  for (const { name, columns } of applicationTables) {
    await client.query(`SELECT ${columns.join(', ')} FROM ${name} LIMIT 0`);
  }
  for (const [, name] of schemaSql.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)/g)) {
    const { rows } = await client.query('SELECT to_regclass($1) AS relation', [name]);
    if (!rows[0].relation) throw new Error(`Missing required index: ${name}`);
  }
}

export async function migrateSchema(client: pg.PoolClient): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '10000ms'");
    await client.query("SET LOCAL statement_timeout = '60000ms'");
    // Transaction-scoped: safe through a pooler and released on rollback/disconnect.
    await client.query('SELECT pg_advisory_xact_lock(734921, 1)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
    verifyMigrationLedger(rows, false);
    for (const migration of migrations.slice(rows.length)) {
      // Version 1 adopts legacy tables without replacing evidence or paid caps.
      // Later versions must be additive while previous compatible code can run.
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
        [migration.version, migration.checksum]);
    }
    await verifySchema(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export async function verifyRuntime(client: pg.PoolClient): Promise<void> {
  await verifySchema(client);
  const { rows: roles } = await client.query(`SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
    FROM pg_roles WHERE rolname = current_user`);
  if (!roles.length || Object.values(roles[0]).some(Boolean)) throw new Error('Runtime role has administrative privileges.');
  const { rows: schemas } = await client.query(`SELECT
    (has_schema_privilege(current_schema(), 'CREATE') OR
     has_database_privilege(current_database(), 'CREATE')) AS can_create`);
  if (schemas[0].can_create) throw new Error('Runtime role can create schema objects.');
  for (const { name } of applicationTables) {
    const { rows } = await client.query(`SELECT
      pg_has_role(c.relowner, 'MEMBER') AS owns_table,
      has_table_privilege(c.oid, 'TRUNCATE') AS can_truncate,
      has_table_privilege(c.oid, 'DELETE') AS can_delete,
      has_table_privilege(c.oid, 'INSERT, UPDATE') AS any_write,
      (has_table_privilege(c.oid, 'INSERT') AND has_table_privilege(c.oid, 'UPDATE')) AS can_write
      FROM pg_class c WHERE c.oid = to_regclass($1)`, [name]);
    if (rows[0].owns_table || rows[0].can_truncate ||
        rows[0].can_delete !== (name === 'whoi_detections') ||
        (name === 'historical_presence' ? rows[0].any_write : !rows[0].can_write)) {
      throw new Error(`Runtime privileges differ from the application contract: ${name}`);
    }
  }
  const { rows } = await client.query(`SELECT has_table_privilege('whoi_detections', 'DELETE') AS can_delete,
    has_table_privilege('schema_migrations', 'INSERT, UPDATE, DELETE, TRUNCATE') AS can_change_migrations`);
  if (!rows[0].can_delete || rows[0].can_change_migrations) throw new Error('Runtime migration/WHOI privileges differ.');
}
