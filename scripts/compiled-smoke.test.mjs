import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import pg from 'pg';

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required for the compiled smoke test.');

test('standalone compiled artifact migrates, serves frontend/API and closes on both signals without collection',
  { timeout: 180_000 }, async () => {
    const schema = `compiled_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
    const directory = await mkdtemp(join(tmpdir(), 'shared-water-artifact-'));
    const children = [];
    const scopedUrl = new URL(process.env.TEST_DATABASE_URL);
    scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
    const env = { ...process.env, DATABASE_URL: scopedUrl.toString(), COORDINATION_DATABASE_URL: scopedUrl.toString(), DOTENV_CONFIG_PATH: '/dev/null',
      HOST: '127.0.0.1', PORT: '0', COLLECTION_ENABLED: 'false', AIS_COLLECTION_MODE: 'always',
      AISSTREAM_API_KEY: 'unused-offline-test-key', DEEPSEEK_API_KEY: 'unused-offline-test-key',
      AI_QUESTIONS_ENABLED: 'false', METRICS_EXPORT_ENABLED: 'false',
      METRICS_OTLP_AUTHORIZATION: '', METRICS_OTLP_ENDPOINT: '' };
    function launch(entry) {
      const child = spawn(process.execPath, ['--import', './offline.mjs', entry], { cwd: directory, env,
        stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', bytes => { output += bytes; });
      child.stderr.on('data', bytes => { output += bytes; });
      const exited = once(child, 'exit');
      let deadline;
      function setBudget(phase, milliseconds) {
        clearTimeout(deadline);
        deadline = setTimeout(() => {
          output += `\nTimed out during ${phase}\n`;
          child.kill('SIGKILL');
        }, milliseconds);
      }
      setBudget('startup/migration', 20_000);
      child.once('exit', () => clearTimeout(deadline));
      children.push(child);
      return { child, exited, setBudget, output: () => output };
    }
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      // Exercise the deployable directories without source files, .env or the TS loader.
      await cp(resolve('build'), join(directory, 'build'), { recursive: true });
      await cp(resolve('dist'), join(directory, 'dist'), { recursive: true });
      await writeFile(join(directory, 'package.json'), '{"type":"module"}');
      await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
      // Any accidental feed/model fetch fails the test instead of contacting a provider.
      await writeFile(join(directory, 'offline.mjs'),
        "import http from 'node:http'; import https from 'node:https';\n" +
        "const blocked = () => { console.error('UNEXPECTED_PROVIDER_FETCH'); throw new Error('Offline artifact check'); };\n" +
        "http.request = https.request = http.get = https.get = blocked; globalThis.fetch = async () => blocked();\n");
      const migration = launch('build/server/migrate.js');
      assert.deepEqual(await migration.exited, [0, null], migration.output());
      for (const signal of ['SIGTERM', 'SIGINT']) {
        const app = launch('build/server/index.js');
        let address;
        const startupDeadline = Date.now() + 20_000;
        while (Date.now() < startupDeadline) {
          address = app.output().match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
          if (address || app.child.exitCode !== null || app.child.signalCode !== null) break;
          await delay(50);
        }
        assert.ok(address, app.output());
        app.setBudget('HTTP checks', 30_000);
        const get = async path => {
          const response = await fetch(`${address}${path}`, { signal: AbortSignal.timeout(5000) });
          assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
          return response;
        };
        assert.deepEqual(await (await get('/api/health')).json(), { api: 'connected', database: 'connected' });
        assert.deepEqual(await (await get('/api/wake')).json(), {
          service: 'shared-waters', api: 'connected', database: 'connected',
        });
        const entry = await get('/');
        assert.equal(entry.headers.get('cache-control'), 'no-cache');
        assert.match(await entry.text(), /<html/);
        assert.match(await (await get('/system')).text(), /<html/);
        for (const path of ['/status', '/status/', '/status.html']) {
          const response = await fetch(`${address}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
          assert.equal(response.status, 301);
          assert.equal(response.headers.get('location'), '/system');
        }
        const asset = (await (await get('/')).text()).match(/src="([^\"]+\.js)"/)?.[1];
        assert.ok(asset, 'built entry references a JavaScript asset');
        const javascript = await get(asset);
        assert.match(javascript.headers.get('content-type'), /javascript/);
        assert.equal(javascript.headers.get('cache-control'), 'public, max-age=31536000, immutable');
        const assetNames = await readdir(resolve('dist/assets'));
        const snapshotName = assetNames.find(name => /^snapshot-.+\.json$/.test(name));
        assert.ok(snapshotName, 'Story data is a separate fingerprinted static asset');
        const staticStory = await get(`/assets/${snapshotName}`);
        assert.equal(staticStory.headers.get('cache-control'), 'public, max-age=31536000, immutable');
        assert.equal((await staticStory.json()).data.presence.length, 358);
        await get('/api/story/replay');
        const ais = await (await get('/api/current/ais')).json();
        assert.deepEqual(ais.collection, { mode: 'disabled', state: 'disabled',
          activeSince: null, resumeAt: null, idleSeconds: 120, maxActiveSeconds: 900 });
        const question = await fetch(`${address}/api/ask`, { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Explain the latest evidence' }),
          signal: AbortSignal.timeout(5000) });
        assert.equal(question.status, 503);
        assert.equal((await question.json()).error, 'ai_disabled');
        app.setBudget('graceful shutdown', 10_000);
        app.child.kill(signal);
        assert.deepEqual(await app.exited, [0, null], app.output());
        assert.doesNotMatch(app.output(), /UNEXPECTED_PROVIDER_FETCH/);
      }
      const counts = await admin.query(`SELECT
        (SELECT count(*) FROM ${schema}.feed_status)::int AS feeds,
        (SELECT count(*) FROM ${schema}.ais_connection_status)::int AS ais,
        (SELECT count(*) FROM ${schema}.ai_call_reservations)::int AS calls`);
      assert.deepEqual(counts.rows[0], { feeds: 0, ais: 0, calls: 0 });
      // A real restart with collection enabled must reuse durable fresh status.
      // Provider transports are still forbidden; waking alone must not start AIS.
      await admin.query(`INSERT INTO ${schema}.feed_status
        (source, last_attempt_at, last_success_at, last_attempt_status)
        SELECT source, now(), now(), 'success' FROM unnest($1::text[]) source`,
      [['open_meteo_marine', 'whoi_robots4whales', 'canadian_coast_guard_navwarn']]);
      env.COLLECTION_ENABLED = 'true'; env.AIS_COLLECTION_MODE = 'on-demand';
      const fresh = launch('build/server/index.js');
      let freshAddress;
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        freshAddress = fresh.output().match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
        if (freshAddress || fresh.child.exitCode !== null) break;
        await delay(50);
      }
      assert.ok(freshAddress, fresh.output());
      const wake = await fetch(`${freshAddress}/api/wake`, { signal: AbortSignal.timeout(5000) });
      assert.equal(wake.status, 200);
      assert.equal((await wake.json()).database, 'connected');
      // Shutdown drains startup checks, so no arbitrary observation wait is needed.
      fresh.setBudget('fresh shutdown', 10_000); fresh.child.kill('SIGTERM');
      assert.deepEqual(await fresh.exited, [0, null], fresh.output());
      assert.doesNotMatch(fresh.output(), /UNEXPECTED_PROVIDER_FETCH/);
      const afterWake = await admin.query(`SELECT
        (SELECT count(*) FROM ${schema}.feed_status WHERE last_attempt_status = 'success'
          AND last_attempt_at = last_success_at)::int AS fresh,
        (SELECT count(*) FROM ${schema}.ais_connection_status)::int AS ais,
        (SELECT count(*) FROM ${schema}.ai_call_reservations)::int AS calls`);
      assert.deepEqual(afterWake.rows[0], { fresh: 3, ais: 0, calls: 0 });
    } finally {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await once(child, 'exit');
        }
      }
      try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
      finally { await admin.end(); await rm(directory, { recursive: true, force: true }); }
    }
  });
