import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { createBackup, restoreBackup, verifyBackup, targetUrl, backupTables, recordBackupResult, rehearseBackup } from './backup.mjs';
import { migrateSchema } from '../server/schema-contract.ts';

const source = process.env.TEST_DATABASE_URL;
if (!source || !['localhost','127.0.0.1','[::1]'].includes(new URL(source).hostname)) throw new Error('TEST_DATABASE_URL must identify a disposable localhost database.');

test('restore connection guards reject remote, ambiguous and ordinary database targets', async () => {
  for (const url of ['postgres://owner:secret@remote.example/shared_water_restore_test', 'postgres://localhost/postgres',
    'postgres://localhost/shared_water_restore_test?host=remote.example', 'postgres://localhost/shared_water_restore_test?hostaddr=192.0.2.1', 'postgres://localhost/shared_water_restore_test?options=-csearch_path=public']) {
    assert.throws(() => targetUrl(url, true), /Restore requires|overrides/);
  }
  assert.throws(() => targetUrl('postgres://owner:secret@remote.example/app'), /verify-full/);
  assert.equal(targetUrl('postgres://localhost/shared_water_restore_test', true).pathname, '/shared_water_restore_test');
  await assert.rejects(rehearseBackup('postgres://owner:secret@remote.example/postgres?sslmode=verify-full', '.local/backups/unused'), /localhost/);
});

test('sanitized result history keeps the last verified backup age after a later failure', async () => {
  const directory = resolve('.local/backups/results-' + randomUUID());
  try {
    const createdAt = new Date(Date.now() - 60_000).toISOString(), verifiedAt = new Date().toISOString();
    const verified = await recordBackupResult({ outcome: 'verified', createdAt, verifiedAt, durationSeconds: 0.5,
      schemaMatch: true, rowCountsMatch: true, tableHashesMatch: true }, directory);
    assert.equal(verified.lastVerifiedAt, verifiedAt);
    const failed = await recordBackupResult({ outcome: 'failed', checkedAt: new Date().toISOString(), verifiedAt: null,
      reason: 'PostgreSQL tool failed; no connection details or tool output were logged.' }, directory);
    assert.equal(failed.lastVerifiedAt, verifiedAt);
    assert.ok(failed.lastVerifiedBackupAgeSeconds >= 60);
    assert.equal(JSON.parse(await readFile(resolve(directory,'last-verified.json'),'utf8')).createdAt, createdAt);
    assert.equal((await stat(resolve(directory,'latest.json'))).mode & 0o077, 0);
    assert.doesNotMatch(JSON.stringify(failed), /postgres:\/\/|password|client_key|question text/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('saved custom dump restores all application tables with exact schema/count/content hashes and refuses reuse/tampering', async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const admin = new pg.Client({connectionString: source});
  const sourceName = 'shared_water_backup_' + suffix, restoreName = 'shared_water_restore_' + suffix;
  const sourceUrl = new URL(source), restoreUrl = new URL(source);
  sourceUrl.pathname = '/' + sourceName; restoreUrl.pathname = '/' + restoreName;
  const directory = resolve('.local/backups/test-' + suffix);
  let sourceDb;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${sourceName}`); await admin.query(`CREATE DATABASE ${restoreName}`);
    sourceDb = new pg.Client({connectionString: sourceUrl.toString()}); await sourceDb.connect();
    await migrateSchema(sourceDb);
    await sourceDb.query("UPDATE ai_budget_state SET used_calls=9007199254740993 WHERE id=1");
    await sourceDb.query(`INSERT INTO ai_call_reservations VALUES ('00000000-0000-4000-8000-000000000001','private-test-key','2026-11-03T12:34:56.123456Z',NULL)`);
    await sourceDb.query(`INSERT INTO historical_presence (id,source,source_record_id,kind,zone_id,event_at,latitude,longitude,vessel_id,speed_band_group,source_url,raw_reference,raw_payload)
      VALUES ('fixture','global_fishing_watch','fixture','gfw_vessel_presence_hour','zone_a','2026-09-19T20:00:00.123456Z',49.35,-64.2,'fixture','bands_from_10_up','https://example.test/source','fixture','{"text":"private fixture newline\\n and quote \\\"","number":9007199254740993}')`);
    await sourceDb.query(`UPDATE collection_control SET demand_until='2026-11-03T12:34:56.654321Z', owner_id='fixture-owner' WHERE id=1`);
    await sourceDb.query('UPDATE ais_daily_budget SET reserved_ms=900000 WHERE id=1');
    const before = await sourceDb.query('SELECT used_calls::text FROM ai_budget_state');
    const created = await createBackup(sourceUrl.toString(), directory);
    assert.equal(created.outcome, 'created');
    assert.equal((await stat(directory)).mode & 0o077, 0);
    assert.equal((await stat(resolve(directory,'database.dump'))).mode & 0o077, 0);
    assert.equal((await sourceDb.query('SELECT used_calls::text FROM ai_budget_state')).rows[0].used_calls, before.rows[0].used_calls);
    const manifest = await verifyBackup(directory);
    assert.deepEqual(Object.keys(manifest.tables).sort(), backupTables);
    assert.equal(manifest.tables.ai_budget_state.count, 1);
    assert.equal(manifest.tables.schema_migrations.count, 3);
    assert.equal(manifest.tables.collection_control.count, 1);
    assert.equal(manifest.tables.ais_daily_budget.count, 1);
    // Change the source AFTER saving: the restore must come from the actual artifact, not a clone.
    await sourceDb.query('UPDATE ai_budget_state SET used_calls=7 WHERE id=1');
    const pendingRecords = async () => (await readdir(resolve('.local/backup-results')).catch(() => [])).filter(name => /^rehearsal-.*\.json$/.test(name)).sort();
    const pendingBefore = await pendingRecords();
    const rehearsalsBefore = (await admin.query("SELECT datname FROM pg_database WHERE datname LIKE 'shared_water_restore_%' ORDER BY datname")).rows;
    const rehearsal = await rehearseBackup(source, directory);
    assert.equal(rehearsal.cleanupComplete, true);
    assert.deepEqual(await pendingRecords(), pendingBefore);
    assert.equal(rehearsal.tableHashesMatch, true);
    assert.ok(rehearsal.durationSeconds >= rehearsal.restoreDurationSeconds);
    assert.deepEqual((await admin.query("SELECT datname FROM pg_database WHERE datname LIKE 'shared_water_restore_%' ORDER BY datname")).rows, rehearsalsBefore);
    const restored = await restoreBackup(restoreUrl.toString(), directory);
    assert.equal(restored.outcome, 'verified'); assert.equal(restored.tableHashesMatch, true);
    assert.equal(restored.schemaMatch, true); assert.ok(restored.backupAgeSeconds >= 0);
    const check = new pg.Client({connectionString: restoreUrl.toString()}); await check.connect();
    try {
      assert.equal((await check.query('SELECT used_calls::text FROM ai_budget_state')).rows[0].used_calls,'9007199254740993');
      assert.equal((await check.query("SELECT to_char(started_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS value FROM ai_call_reservations")).rows[0].value,'2026-11-03 12:34:56.123456');
    } finally { await check.end(); }
    await assert.rejects(restoreBackup(restoreUrl.toString(), directory), /not empty/);
    await assert.rejects(createBackup(sourceUrl.toString(), directory));
    const path = resolve(directory,'database.dump'), content = await readFile(path);
    const tampered = Buffer.from(content); tampered[tampered.length - 1] ^= 1; await writeFile(path,tampered);
    await assert.rejects(verifyBackup(directory), /integrity/);
    await writeFile(path,content);
    const manifestPath = resolve(directory,'manifest.json'); const metadata = await readFile(manifestPath,'utf8');
    const bad = JSON.parse(metadata); bad.schema.columns[0].not_null = !bad.schema.columns[0].not_null;
    await writeFile(manifestPath,JSON.stringify(bad)); await assert.rejects(verifyBackup(directory), /schema manifest integrity/);
    // Make a self-consistent but incorrect schema manifest to force a failure AFTER native restore.
    bad.schemaSha256 = (await import('node:crypto')).createHash('sha256').update(JSON.stringify(bad.schema)).digest('hex');
    await writeFile(manifestPath, JSON.stringify(bad));
    await assert.rejects(rehearseBackup(source, directory), /Restored schema/);
    assert.deepEqual(await pendingRecords(), pendingBefore);
    assert.deepEqual((await admin.query("SELECT datname FROM pg_database WHERE datname LIKE 'shared_water_restore_%' ORDER BY datname")).rows, rehearsalsBefore);
    await writeFile(manifestPath,metadata);
    assert.equal((await verifyBackup(directory)).version,1);
    await sourceDb.query('CREATE TABLE unexpected_fixture (id integer)');
    const refusedDirectory = directory + '-unsupported';
    await assert.rejects(createBackup(sourceUrl.toString(), refusedDirectory), /scope/);
    await assert.rejects(stat(refusedDirectory), { code: 'ENOENT' });
  } finally {
    await sourceDb?.end().catch(()=>{});
    for (const name of [restoreName,sourceName]) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(()=>{});
    await admin.end().catch(()=>{}); await rm(directory,{recursive:true,force:true});
  }
});
