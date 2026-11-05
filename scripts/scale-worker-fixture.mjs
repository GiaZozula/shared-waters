import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(`${process.cwd()}/package.json`);
const pg = require('pg');
const compiled = name => import(pathToFileURL(`${process.cwd()}/build/server/${name}.js`).href);
const { createCollectionOwner, coordinationUrl, runtimeRole } = await compiled('collection-owner');
const { createCollectionRuntime } = await compiled('collection-runtime');
const { refreshMarine } = await compiled('marine-store');
if (runtimeRole(process.env.ROLE) !== 'worker') throw new Error('Fixture requires ROLE=worker');
const url = coordinationUrl(process.env.COORDINATION_DATABASE_URL, process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', 'db'].includes(new URL(url).hostname)) throw new Error('Fixture database must be local');
const upstream = process.env.SCALE_UPSTREAM_URL;
if (!upstream || !['localhost', '127.0.0.1', 'fake-upstream'].includes(new URL(upstream).hostname)) throw new Error('Fixture upstream must be local');
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 3000, query_timeout: 3000 });
db.on('error', () => {});
const { startAisCollector } = await compiled('ais-collector');
const log = { info() {}, warn() {}, error() {} };
const feeds = [
  { source: 'open_meteo_marine', intervalMs: 15 * 60_000,
    refresh: signal => refreshMarine(db, (input, init) => fetch(`${upstream}/${new URL(input).pathname === '/v1/forecast' ? 'weather' : 'marine'}`,
      { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }), signal) },
  ...[['whoi_robots4whales', 'whoi'], ['canadian_coast_guard_navwarn', 'navwarn']].map(([source, path]) => ({
    source, intervalMs: 30 * 60_000,
    async refresh(signal) {
      const response = await fetch(`${upstream}/${path}`, { signal });
      if (!response.ok) throw new Error('Fixture feed failed');
      signal.throwIfAborted();
      await db.query(`INSERT INTO feed_status (source, last_attempt_at, last_success_at, last_attempt_status)
        VALUES ($1, now(), now(), 'success') ON CONFLICT (source) DO UPDATE
        SET last_attempt_at = now(), last_success_at = now(), last_attempt_status = 'success'`, [source]);
    },
  })),
];
const owner = createCollectionOwner({ url, onState() {},
  start: (signal, failed, session) => createCollectionRuntime({ db, session, signal, failed, log, feeds,
    startAis: () => startAisCollector(db, log, 'local-fixture', { url: upstream.replace('http:', 'ws:') }),
  }),
});
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ owned: owner.owned, tag: process.env.SCALE_WORKER_TAG, pid: process.pid }));
});
server.listen(Number(process.env.PORT ?? 0), '0.0.0.0', () => {
  console.log(`FIXTURE_READY http://127.0.0.1:${server.address().port}`);
});
const close = async () => { server.close(); await owner.close(); await db.end(); };
process.once('SIGTERM', () => { void close(); }); process.once('SIGINT', () => { void close(); });
