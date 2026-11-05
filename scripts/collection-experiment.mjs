// Four real processes, one disposable database, and loopback-only upstreams.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(`${process.cwd()}/package.json`);
const pg = require('pg');
const { migrateSchema, applicationTables } = await import(pathToFileURL(`${process.cwd()}/build/server/schema-contract.js`).href);
const { OWNER_LOCK } = await import(pathToFileURL(`${process.cwd()}/build/server/collection-owner.js`).href);
const base = process.env.TEST_DATABASE_URL;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Use a disposable localhost TEST_DATABASE_URL.');
const compose = process.argv.includes('--compose');
const schema = compose ? 'public' : `scale01_${randomUUID().replaceAll('-', '')}`;
const role = compose ? 'scale_runtime' : `scale_runtime_${randomUUID().replaceAll('-', '')}`;
const password = compose ? 'local_scale_only' : randomUUID();
const scoped = new URL(base);
if (!compose) scoped.searchParams.set('options', `-c search_path=${schema}`);
const admin = new pg.Pool({ connectionString: scoped.toString(), connectionTimeoutMillis: 3000, query_timeout: 5000 });
const runtime = new URL(scoped);
runtime.username = role; runtime.password = password;
const children = [];
const env = { ...process.env, DOTENV_CONFIG_PATH: '/dev/null', DATABASE_URL: runtime.toString(),
  COORDINATION_DATABASE_URL: runtime.toString(), HOST: '127.0.0.1', PORT: '0', COLLECTION_ENABLED: 'true',
  AI_QUESTIONS_ENABLED: 'false', METRICS_EXPORT_ENABLED: 'false', METRICS_OTLP_AUTHORIZATION: '', METRICS_OTLP_ENDPOINT: '', DEEPSEEK_API_KEY: '', AISSTREAM_API_KEY: '', GFW_API_ACCESS_TOKEN: '', AIS_COLLECTION_MODE: 'on-demand' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(url, path = '/health') {
  const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Fixture request failed (${response.status})`);
  return response.json();
}
async function until(check, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const value = await check(); if (value) return value; } catch {}
    await delay(50);
  }
  throw new Error('Collection experiment phase timed out.');
}
async function stop(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill(signal);
  const kill = setTimeout(() => child.kill('SIGKILL'), 8000);
  try { await exited; } finally { clearTimeout(kill); }
}
async function launch(entry, additions = {}) {
  const child = spawn(process.execPath, ['--import', './scripts/scale-network-guard.mjs', entry],
    { env: { ...env, ...additions }, stdio: ['ignore', 'pipe', 'pipe'] });
  const processState = { child, output: '', url: null };
  children.push(processState);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { processState.output += bytes; });
  await until(() => {
    if (child.exitCode !== null) throw new Error('Fixture process exited');
    processState.url = processState.output.match(/(?:FIXTURE_READY|Server listening at) (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    return processState.url;
  });
  return processState;
}
const docker = (...args) => execFileSync('docker', ['compose', '--env-file', '/dev/null', '-f', 'compose.scale.yaml', ...args], { stdio: 'pipe' });
const signalWorker = async (worker, signal) => {
  if (compose) docker('kill', '-s', signal, worker.service);
  else worker.child.kill(signal);
};
let prepared = false;
const report = { experiment: compose ? 'two-apis-two-workers-compose' : 'two-apis-two-workers-local',
  node: process.version, productionDeployment: false, timing: { lockPollMs: 2000, controlPollMs: 1000, demandMs: 120000 }, cases: {} };
try {
  if (!compose) {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const client = await admin.connect();
    try { await migrateSchema(client); } finally { client.release(); }
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS`);
    await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    for (const { name } of applicationTables) await admin.query(`GRANT ${name === 'historical_presence' ? 'SELECT' : 'SELECT, INSERT, UPDATE'} ON ${name} TO ${role}`);
    await admin.query(`GRANT DELETE ON whoi_detections TO ${role}`);
    await admin.query(`GRANT SELECT ON schema_migrations TO ${role}`);
  } else {
    assert.equal(new URL(base).pathname, '/scale_experiment', 'compose mode must use its dedicated database');
  }
  prepared = true;
  await admin.query('UPDATE ai_budget_state SET used_calls = 7 WHERE id = 1');
  const reservation = randomUUID();
  await admin.query('INSERT INTO ai_call_reservations (id, client_key) VALUES ($1, $2)', [reservation, 'local-scale-fixture']);
  report.postgres = (await admin.query('SHOW server_version')).rows[0].server_version;
  const upstream = compose ? { url: 'http://127.0.0.1:5305' } : await launch('scripts/scale-upstream-fixture.mjs');
  const metrics = () => request(upstream.url, '/metrics');
  const apis = compose ? [{ url: 'http://127.0.0.1:5301' }, { url: 'http://127.0.0.1:5302' }]
    : await Promise.all([launch('build/server/index.js', { ROLE: 'api' }), launch('build/server/index.js', { ROLE: 'api' })]);
  await Promise.all(apis.map(api => request(api.url, '/api/health')));
  if (!compose) assert.deepEqual((await metrics()).requests, { marine: 0, weather: 0, whoi: 0, navwarn: 0 });
  const makeWorker = tag => launch('scripts/scale-worker-fixture.mjs', { ROLE: 'worker', SCALE_WORKER_TAG: tag, SCALE_UPSTREAM_URL: upstream.url });
  let workers = compose ? [{ url: 'http://127.0.0.1:5311', service: 'worker_a' }, { url: 'http://127.0.0.1:5312', service: 'worker_b' }]
    : await Promise.all([makeWorker('a'), makeWorker('b')]);
  await until(async () => Object.values((await metrics()).requests).every(count => count === 1));
  assert.equal((await metrics()).connections, 0, 'ownership/readiness must not start on-demand AIS');
  const states = await Promise.all(workers.map(worker => request(worker.url)));
  assert.equal(states.filter(state => state.owned).length, 1);
  report.cases.simultaneousStart = { owners: 1, requests: (await metrics()).requests, aisSessionsBeforeReaders: 0 };
  await request(apis[0].url, '/api/current/ais');
  await until(async () => (await metrics()).connections === 1);
  await request(apis[1].url, '/api/current/ais');
  await until(async () => (await admin.query('SELECT count(*) FROM ais_positions')).rows[0].count === '1');
  const activeSince = (await admin.query('SELECT active_since FROM collection_control')).rows[0].active_since.toISOString();
  report.connections = { apiPoolLimitPerProcess: 5, workerPoolLimitPerProcess: 3,
    ownerSessionPerWorker: 1, fourProcessMaximum: 18, singleAllProcessMaximum: 6,
    observedRuntimeConnectionsAtRead: Number((await admin.query('SELECT count(*) FROM pg_stat_activity WHERE usename = $1', [role])).rows[0].count) };
  const leaderIndex = (await request(workers[0].url)).owned ? 0 : 1;
  let leader = workers[leaderIndex], standby = workers[1 - leaderIndex];
  const killed = Date.now();
  await signalWorker(leader, 'SIGKILL');
  await until(async () => (await request(standby.url)).owned && (await metrics()).connections === 2);
  report.cases.leaderKill = { handoverMs: Date.now() - killed, peakSessions: (await metrics()).peak };
  assert.equal((await metrics()).peak, 1, 'clean process death should not overlap upstream sessions in this experiment');
  assert.equal((await admin.query('SELECT active_since FROM collection_control')).rows[0].active_since.toISOString(), activeSince);
  if (compose) { docker('start', leader.service); }
  else { leader = await makeWorker('restarted'); workers[leaderIndex] = leader; }
  await until(async () => !(await request(leader.url)).owned);
  await delay(250);
  assert.equal((await metrics()).connections, 2);
  // Deliberately retain an external socket while the owning JS process is paused.
  // Releasing its DB session demonstrates the unavoidable stale/in-flight window.
  await signalWorker(standby, 'SIGSTOP');
  const paused = Date.now();
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory'
    AND classid = $1::oid AND objid = $2::oid AND objsubid = 2 AND granted`, [...OWNER_LOCK]);
  await until(async () => (await request(leader.url)).owned && (await metrics()).active === 2);
  await signalWorker(standby, 'SIGCONT');
  await until(async () => (await metrics()).active === 1 && !(await request(standby.url)).owned);
  const overlapEvents = (await metrics()).events.filter(event => event.at >= paused);
  const overlapStart = overlapEvents.find(event => event.active === 2)?.at;
  const overlapEnd = overlapEvents.find(event => overlapStart && event.at >= overlapStart && event.active === 1)?.at;
  assert.ok(overlapStart && overlapEnd);
  report.cases.staleOwnerResume = { peakSessions: 2, measuredOverlapMs: overlapEnd - overlapStart,
    limit: 'Pausing JS prevents abort handling; session locks cannot fence an already-open external socket.' };
  const beforeLoss = (await metrics()).connections;
  await admin.query(`ALTER ROLE ${role} NOLOGIN`);
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1', [role]);
  await until(async () => (await metrics()).active === 0);
  await delay(2200);
  assert.equal((await metrics()).connections, beforeLoss);
  await admin.query(`ALTER ROLE ${role} LOGIN`);
  await until(async () => (await request(apis[0].url, '/api/health')).database === 'connected');
  await until(async () => (await metrics()).active === 1);
  report.cases.runtimeDatabaseAccessLoss = { sessionsWhileAccessDenied: 0, resumed: true,
    method: 'Temporary NOLOGIN plus termination of this disposable runtime role, not a production network failure.' };
  await admin.query("UPDATE collection_control SET demand_until = clock_timestamp() - interval '1 second'");
  await until(async () => (await metrics()).active === 0);
  await until(async () => (await admin.query('SELECT active_since FROM collection_control')).rows[0].active_since === null);
  assert.equal((await admin.query('SELECT count(*) FROM ais_positions')).rows[0].count, '1');
  assert.equal((await admin.query('SELECT count(*) FROM marine_observations')).rows[0].count, '1');
  assert.equal((await admin.query("SELECT raw_payload->'liveWeather'->>'code' AS code FROM marine_observations")).rows[0].code, '63', 'the sole marine refresh also persists the weather enrichment');
  assert.equal((await admin.query('SELECT count(*) FROM collection_control')).rows[0].count, '1');
  assert.equal((await admin.query('SELECT used_calls FROM ai_budget_state')).rows[0].used_calls, '7');
  assert.equal((await admin.query('SELECT count(*) FROM ai_call_reservations WHERE id = $1 AND finished_at IS NULL', [reservation])).rows[0].count, '1');
  const final = await metrics();
  assert.deepEqual(final.requests, { marine: 1, weather: 1, whoi: 1, navwarn: 1 }, 'fresh feed status must avoid repeated requests during handover');
  report.cases.readerExpiry = { activeSessions: final.active, sharedControlRows: 1 };
  report.evidence = { aisRows: 1, marineRows: 1, repeatedAISFramesDeduplicated: true, paidCallsUnchanged: true,
    feedRequests: final.requests, totalAISConnections: final.connections };
  if (!compose) {
    const probe = await launch('build/server/index.js', { ROLE: 'worker', COLLECTION_ENABLED: 'false' });
    assert.equal((await request(probe.url, '/api/health')).database, 'connected');
    assert.equal((await fetch(`${probe.url}/api/current/ais`)).status, 404);
    await stop(probe.child);
  }
  if (!compose && process.env.SCALE_PREVIOUS_BUILD) {
    const previous = process.env.SCALE_PREVIOUS_BUILD;
    const contract = await import(pathToFileURL(`${previous}/server/schema-contract.js`).href);
    assert.equal(contract.migrations.length, 1);
    execFileSync(process.execPath, [`${previous}/server/verify-schema.js`],
      { env: { ...env, COLLECTION_ENABLED: 'false' }, timeout: 15_000 });
    const previousApp = await launch(`${previous}/server/index.js`, { ROLE: 'api', COLLECTION_ENABLED: 'false' });
    assert.equal((await request(previousApp.url, '/api/health')).database, 'connected');
    assert.equal((await request(previousApp.url, '/api/current/ais')).data.positions.length, 1);
    await stop(previousApp.child);
    report.previousArtifact = { knownSchemaVersion: 1, schemaAndRuntimePrivilegesVerified: true,
      healthAndAISReadPassed: true, collectionDisabled: true };
  }
  for (const child of children) assert.equal(child.output.includes('FORBIDDEN_EXPERIMENT_UPSTREAM'), false);
  const fingerprint = createHash('sha256');
  for (const file of ['server/collection-owner.ts', 'server/collection-runtime.ts', 'server/collection-state.ts', 'server/index.ts', 'server/marine-store.ts', 'server/whoi-store.ts', 'server/navwarn-store.ts', 'server/schema-contract.ts', 'server/migrations/002-collection-control.sql', 'scripts/collection-experiment.mjs', 'scripts/scale-worker-fixture.mjs', 'scripts/scale-upstream-fixture.mjs', 'scripts/scale-network-guard.mjs']) fingerprint.update(await readFile(file));
  report.sourceFingerprint = fingerprint.digest('hex');
  const output = process.env.SCALE_RESULTS_PATH;
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const child of children) { child.child.kill('SIGCONT'); }
  await Promise.all(children.map(child => stop(child.child)));
  if (!compose) {
    if (prepared) { await admin.query(`DROP OWNED BY ${role}`).catch(() => {}); await admin.query(`DROP ROLE ${role}`).catch(() => {}); }
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
  }
  await admin.end();
}
