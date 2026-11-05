import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, stat, rm } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const root = fileURLToPath(new URL('../', import.meta.url));
const privateRoot = resolve(root, '.local/backups');
export const backupTables = ['ai_budget_state', 'ai_call_reservations', 'ais_connection_status', 'ais_daily_budget',
  'ais_positions', 'collection_control', 'feed_status', 'historical_presence',
  'marine_observations', 'navwarn_notices', 'schema_migrations', 'whoi_detections', 'whoi_reviews'];
const MAX_ROWS = 100_000, MAX_TABLE_BYTES = 64 * 1024 * 1024, MAX_DUMP_BYTES = 512 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
class BackupError extends Error {}
function requireThat(value, message) { if (!value) throw new BackupError(message); }
export function targetUrl(value, restore = false) {
  let url;
  try { url = new URL(value); } catch { throw new BackupError('Provide a PostgreSQL connection through the dedicated environment variable.'); }
  requireThat(['postgres:', 'postgresql:'].includes(url.protocol), 'Expected a PostgreSQL connection.');
  const allowed = new Set(['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'channel_binding']);
  requireThat(Array.from(url.searchParams.keys()).every(key => allowed.has(key)), 'Connection overrides or unsupported parameters are not supported.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (restore) requireThat(local && /^\/shared_water_restore_[a-z0-9_]+$/.test(url.pathname), 'Restore requires a disposable localhost database named shared_water_restore_ followed by a unique suffix.');
  if (!local) requireThat(url.searchParams.get('sslmode') === 'verify-full', 'Remote backup connections require sslmode=verify-full.');
  return url;
}
function privateDirectory(path) {
  const dir = resolve(path), rel = relative(privateRoot, dir);
  requireThat(rel && rel !== '..' && !rel.startsWith('..' + sep) && !rel.startsWith(sep), 'Use a new directory inside this repository’s .local/backups/.');
  return dir;
}
async function binary(name, args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    let output = '', bytes = 0;
    const executable = process.env.BACKUP_PG_BIN ? resolve(process.env.BACKUP_PG_BIN, name) : name;
    const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new BackupError('PostgreSQL tool exceeded the five-minute limit.')); }, 300_000);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes <= 1024 * 1024) output += chunk.toString(); else { child.kill('SIGTERM'); reject(new BackupError('PostgreSQL tool output exceeded its bound.')); } });
    child.stderr.on('data', () => {}); // Never log provider/tool diagnostics, which may expose private data.
    child.on('error', () => { clearTimeout(timer); reject(new BackupError('PostgreSQL tool could not start. Check the installed client tools.')); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolvePromise(output) : reject(new BackupError('PostgreSQL tool failed; no connection details or tool output were logged.')); });
  });
}
function childEnv(url) {
  // Credentials remain in the child environment, never in process arguments or output.
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('PG')) delete env[key];
  Object.assign(env, { PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGCONNECT_TIMEOUT: '15' });
  const keys = { sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', channel_binding: 'PGCHANNELBINDING' };
  for (const [key, value] of url.searchParams) {
    requireThat(keys[key], 'Unsupported connection parameter for native backup tools.');
    env[keys[key]] = value;
  }
  return env;
}

async function version(db, tool) {
  const major = Math.floor(Number((await db.query('SHOW server_version_num')).rows[0].server_version_num) / 10000);
  const output = await binary(tool, ['--version']);
  requireThat(Number(output.match(/\b(\d+)\./)?.[1]) === major, 'Use PostgreSQL client tools matching the database server major version.');
  return major;
}
async function fileHash(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
async function schema(db) {
  const names = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r => r.tablename);
  requireThat(JSON.stringify(names) === JSON.stringify(backupTables), 'Public tables differ from the reviewed application scope; update the backup contract first.');
  const columns = (await db.query(`SELECT c.relname AS table_name, a.attnum AS ordinal, a.attname AS column_name,
    format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null, pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`)).rows;
  const constraints = (await db.query(`SELECT c.relname AS table_name, x.conname AS name, pg_get_constraintdef(x.oid) AS definition
    FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' ORDER BY c.relname,x.conname`)).rows;
  const indexes = (await db.query("SELECT tablename AS table_name,indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
  return { columns, constraints, indexes };
}
async function contents(db) {
  const tables = {};
  for (const name of backupTables) {
    const count = Number((await db.query(`SELECT count(*)::text AS count FROM public.${name}`)).rows[0].count);
    requireThat(count <= MAX_ROWS, 'A table exceeds the reviewed backup row bound; review capacity before increasing it.');
    const bytes = Number((await db.query(`SELECT coalesce(sum(octet_length(row_to_json(t)::text)),0)::text AS bytes FROM public.${name} t`)).rows[0].bytes);
    requireThat(bytes <= MAX_TABLE_BYTES, 'A table exceeds the reviewed in-memory hashing bound.');
    // PostgreSQL serializes timestamps/microseconds and bigint exactly. Do not parse row JSON into JS numbers.
    const rows = (await db.query(`SELECT row_to_json(t)::text AS record FROM public.${name} t`)).rows.map(r => r.record).sort();
    const hash = createHash('sha256'); for (const row of rows) { hash.update(String(Buffer.byteLength(row)) + ':'); hash.update(row); }
    tables[name] = { count, sha256: hash.digest('hex') };
  }
  return tables;
}
function connect(url) { return new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 15_000, query_timeout: 60_000 }); }
async function snapshot(db) {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await db.query("SET LOCAL timezone='UTC'");
  await db.query("SET LOCAL statement_timeout='60000ms'");
  await db.query("SET LOCAL lock_timeout='10000ms'");
}
export async function createBackup(connection, output) {
  const started = Date.now(), url = targetUrl(connection), directory = privateDirectory(output);
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  await mkdir(directory, { mode: 0o700 }); // Exclusive directory; never replace a saved backup.
  const db = connect(url);
  let complete = false;
  try {
    await db.connect(); await snapshot(db);
    const serverMajor = await version(db, 'pg_dump');
    const definition = await schema(db), tables = await contents(db);
    const ledger = (await db.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
    requireThat(ledger.length > 0 && ledger.every((row, i) => row.version === i + 1 && /^[a-f0-9]{64}$/.test(row.checksum)), 'Migration ledger is missing or invalid.');
    const exported = (await db.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const dump = resolve(directory, 'database.dump');
    await binary('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--schema=public', '--snapshot=' + exported, '--file=' + dump], childEnv(url));
    requireThat((await stat(dump)).size <= MAX_DUMP_BYTES, 'Dump exceeds the reviewed storage bound.');
    // Directory is private; also restrict individual files for copying to another private store.
    const { chmod } = await import('node:fs/promises'); await chmod(dump, 0o600);
    const manifest = { version: 1, createdAt: new Date().toISOString(), serverMajor, scope: 'public application schema; roles and grants excluded',
      dump: { file: 'database.dump', bytes: (await stat(dump)).size, sha256: await fileHash(dump) }, schema: definition, schemaSha256: sha(JSON.stringify(definition)), ledger, tables };
    await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await db.query('COMMIT'); complete = true;
    return { outcome: 'created', createdAt: manifest.createdAt, durationSeconds: (Date.now() - started) / 1000, verifiedAt: null, backupAgeSeconds: null };
  } finally {
    await db.query('ROLLBACK').catch(() => {}); await db.end().catch(() => {});
    if (!complete) await rm(directory, { recursive: true, force: true });
  }
}
export async function verifyBackup(input) {
  const directory = privateDirectory(input);
  requireThat(((await stat(directory)).mode & 0o077) === 0, 'Backup directory must not be accessible to group or other users.');
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  requireThat(manifest.version === 1 && Number.isInteger(manifest.serverMajor) && Number.isFinite(Date.parse(manifest.createdAt)) &&
    manifest.dump?.file === 'database.dump' && manifest.dump.bytes <= MAX_DUMP_BYTES && /^[a-f0-9]{64}$/.test(manifest.dump.sha256 ?? ''), 'Backup manifest is invalid.');
  requireThat(JSON.stringify(Object.keys(manifest.tables ?? {}).sort()) === JSON.stringify(backupTables) &&
    Object.values(manifest.tables).every(t => Number.isInteger(t.count) && t.count >= 0 && t.count <= MAX_ROWS && /^[a-f0-9]{64}$/.test(t.sha256 ?? '')),
    'Backup table manifest is invalid.');
  requireThat(sha(JSON.stringify(manifest.schema)) === manifest.schemaSha256, 'Backup schema manifest integrity check failed.');
  const dump = resolve(directory, 'database.dump');
  requireThat((await stat(dump)).size === manifest.dump.bytes && await fileHash(dump) === manifest.dump.sha256, 'Backup dump integrity check failed.');
  return manifest;
}
export async function restoreBackup(connection, input) {
  const started = Date.now(), url = targetUrl(connection, true), directory = privateDirectory(input);
  const manifest = await verifyBackup(directory); // Reject corruption before touching the target.
  const db = connect(url);
  let tocPath;
  try {
    await db.connect();
    const serverMajor = await version(db, 'pg_restore'); requireThat(serverMajor === manifest.serverMajor, 'Restore server major must match the saved backup.');
    const objects = Number((await db.query(`SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%') +
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')) +
      (SELECT count(*) FROM pg_namespace WHERE nspname <> 'public' AND nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%') +
      (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') +
      (SELECT count(*) FROM pg_extension WHERE extname <> 'plpgsql') AS count`)).rows[0].count);
    requireThat(objects === 0, 'Restore target is not empty; nothing was restored.');
    // A fresh database already has public. Skip only that schema-creation entry;
    // do not use --clean or drop any target object.
    const dump = resolve(directory, 'database.dump');
    const toc = await binary('pg_restore', ['--list', dump]);
    let publicEntries = 0;
    const filtered = toc.split('\n').map(line => {
      if (/^\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+public\s+/.test(line)) { publicEntries++; return ';' + line; }
      return line;
    }).join('\n');
    requireThat(publicEntries === 1, 'Unexpected dump schema inventory; nothing was restored.');
    const resultDirectory = resolve(root, '.local/backup-results'); await mkdir(resultDirectory, { recursive: true, mode: 0o700 });
    tocPath = resolve(resultDirectory, randomUUID() + '.toc'); await writeFile(tocPath, filtered, { flag: 'wx', mode: 0o600 });
    await binary('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', '--use-list=' + tocPath,
      '--dbname=' + decodeURIComponent(url.pathname.slice(1)), dump], childEnv(url));
    await snapshot(db);
    const restoredSchema = await schema(db), restoredTables = await contents(db);
    requireThat(sha(JSON.stringify(restoredSchema)) === manifest.schemaSha256, 'Restored schema differs from the saved backup.');
    requireThat(JSON.stringify(restoredTables) === JSON.stringify(manifest.tables), 'Restored row counts or content hashes differ from the saved backup.');
    const ledger = (await db.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
    requireThat(JSON.stringify(ledger) === JSON.stringify(manifest.ledger), 'Restored migration ledger differs from the backup.');
    await db.query('COMMIT');
    return { outcome: 'verified', createdAt: manifest.createdAt, verifiedAt: new Date().toISOString(), backupAgeSeconds: Math.max(0, (Date.now() - Date.parse(manifest.createdAt)) / 1000),
      durationSeconds: (Date.now() - started) / 1000, schemaMatch: true, rowCountsMatch: true, tableHashesMatch: true };
  } finally { await db.query('ROLLBACK').catch(() => {}); await db.end().catch(() => {}); if (tocPath) await rm(tocPath, { force: true }); }
}
// A manual rehearsal provisions only one random, disposable LOCAL database.
// It never connects to a backup source or invokes the public application.
export async function rehearseBackup(connection, input) {
  const started = Date.now(), adminUrl = targetUrl(connection);
  requireThat(['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname), 'Rehearsal requires a localhost administrative database connection.');
  const manifest = await verifyBackup(input);
  const suffix = randomUUID().replaceAll('-', ''), name = 'shared_water_restore_' + suffix;
  const target = new URL(adminUrl); target.pathname = '/' + name;
  const db = connect(adminUrl);
  let pending, created = false, creationStarted = false, creationAcknowledged = false, result, failure, cleanupFailure;
  try {
    await db.connect();
    requireThat(await version(db, 'pg_restore') === manifest.serverMajor, 'Rehearsal server major must match the saved backup.');
    const directory = resolve(root, '.local/backup-results'); await mkdir(directory, { recursive: true, mode: 0o700 });
    pending = resolve(directory, 'rehearsal-' + suffix + '.json');
    await writeFile(pending, JSON.stringify({ database: name, startedAt: new Date().toISOString(), state: 'creating' }), { flag: 'wx', mode: 0o600 });
    creationStarted = true;
    await db.query(`CREATE DATABASE ${name}`);
    created = true; creationAcknowledged = true;
    await writeFile(pending, JSON.stringify({ database: name, startedAt: new Date().toISOString(), state: 'restoring' }), { mode: 0o600 });
    result = await restoreBackup(target.toString(), input);
  } catch (error) { failure = error; }
  finally {
    if (created) {
      try { await db.query(`DROP DATABASE ${name} WITH (FORCE)`); created = false; }
      catch { cleanupFailure = new BackupError('Disposable rehearsal cleanup failed; inspect its private pending record before manual cleanup.'); }
    }
    if (pending && !created && (!creationStarted || creationAcknowledged)) {
      try { await rm(pending, { force: true }); }
      catch { cleanupFailure = new BackupError('Disposable database was removed but private rehearsal state cleanup failed.'); }
    }
    await db.end().catch(() => {});
  }
  if (cleanupFailure) throw cleanupFailure;
  if (creationStarted && !creationAcknowledged) throw new BackupError('Rehearsal database creation was not confirmed; inspect its private pending record before manual cleanup.');
  if (failure) throw failure;
  return { ...result, restoreDurationSeconds: result.durationSeconds, durationSeconds: (Date.now() - started) / 1000, cleanupComplete: true };
}

export async function recordBackupResult(result, dir = resolve(root, '.local/backup-results')) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const verifiedPath = resolve(dir, 'last-verified.json');
  let previous;
  try { previous = JSON.parse(await readFile(verifiedPath, 'utf8')); } catch { /* First operation has no verified backup yet. */ }
  const verified = result.outcome === 'verified' ? result : previous;
  const recorded = { ...result, lastVerifiedAt: verified?.verifiedAt ?? null,
    lastVerifiedBackupAgeSeconds: verified?.createdAt ? Math.max(0, (Date.now() - Date.parse(verified.createdAt)) / 1000) : null };
  const temporary = resolve(dir, randomUUID() + '.tmp'); await writeFile(temporary, JSON.stringify(recorded, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, resolve(dir, 'latest.json'));
  if (result.outcome === 'verified') {
    const verifiedTemporary = resolve(dir, randomUUID() + '.tmp'); await writeFile(verifiedTemporary, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    await rename(verifiedTemporary, verifiedPath);
  }
  return recorded;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, directory] = process.argv.slice(2);
  try {
    requireThat(['create','verify','restore','rehearse'].includes(command) && directory && process.argv.length === 4, 'Usage: node scripts/backup.mjs create|verify|restore|rehearse .local/backups/unique-name');
    let result;
    if (command === 'create') result = await createBackup(process.env.BACKUP_DATABASE_URL, directory);
    else if (command === 'restore') result = await restoreBackup(process.env.RESTORE_DATABASE_URL, directory);
    else if (command === 'rehearse') result = await rehearseBackup(process.env.REHEARSAL_DATABASE_URL, directory);
    else { const manifest = await verifyBackup(directory); result = { outcome: 'integrity-verified', createdAt: manifest.createdAt, verifiedAt: null, backupAgeSeconds: null }; }
    result = await recordBackupResult(result); console.log(JSON.stringify(result));
  } catch (error) {
    const result = { outcome: 'failed', checkedAt: new Date().toISOString(), verifiedAt: null, reason: error instanceof BackupError ? error.message : 'Backup operation failed. Inspect private files and local tooling; raw errors are intentionally suppressed.' };
    const recorded = await recordBackupResult(result).catch(() => result); console.error(JSON.stringify(recorded)); process.exitCode = 1;
  }
}
