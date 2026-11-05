// Credential-free local browser fixture. Build with VITE_API_BASE='' first.
// Never load .env, contact providers, or connect to a database.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const root = resolve('dist');
const snapshot = JSON.parse(await readFile('data/story/snapshot.json', 'utf8')).data;
const port = Number(process.env.QA_FIXTURE_PORT ?? 4885);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Use a local test port from 1024 to 65535.');
const scenarios = ['nogl', 'chunk-error', 'slow', 'offline', 'status', 'daily-limit', 'retained'];
const counts = Object.fromEntries(scenarios.map(name => [name, { wake: 0, ais: 0, scene: 0, otherApi: 0, activeWake: 0, ask: 0 }]));
const retainedReads = new Map();
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png' };
const noGL = `<script>const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(['webgl','webgl2','experimental-webgl'].includes(type))return null;return original.call(this,type,...args)};</script>`;
const wait = ms => new Promise(done => setTimeout(done, ms));

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const candidate = url.searchParams.get('fixture') ?? req.headers.cookie?.match(/sw_fixture=([^;]+)/)?.[1];
    const scenario = scenarios.includes(candidate) ? candidate : 'offline';
    const count = counts[scenario];
    res.setHeader('Cache-Control', 'no-store');
    // Even an accidentally API-configured build cannot contact a real origin.
    res.setHeader('Content-Security-Policy', "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    if (url.searchParams.has('fixture')) res.setHeader('Set-Cookie', `sw_fixture=${scenario}; Path=/; SameSite=Lax`);
    if (url.pathname === '/__fixture/counts') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ fixture: true, counts }));
    }
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/api/wake') {
        count.wake++; count.activeWake++;
        res.once('close', () => { count.activeWake--; });
        if (scenario === 'slow') await wait(3000);
        res.statusCode = ['slow', 'status', 'daily-limit', 'retained'].includes(scenario) ? 200 : 503;
        return res.end(JSON.stringify({ service: 'shared-waters', api: 'connected', database: ['slow', 'status', 'daily-limit', 'retained'].includes(scenario) ? 'connected' : 'disconnected' }));
      }
      if (url.pathname === '/api/current/ais') count.ais++;
      else if (url.pathname === '/api/ask' && req.method === 'POST') count.ask++;
      else count.otherApi++;
      if (scenario === 'retained') {
        const now = new Date().toISOString();
        if (url.pathname === '/api/health') return res.end(JSON.stringify({api: 'connected', database: 'connected'}));
        if (url.pathname === '/api/ask/status') return res.end(JSON.stringify({configured: false}));
        if (url.pathname === '/api/current/ais') return res.end(JSON.stringify({connection: {status: 'connected'}, data: {status: 'unknown', positions: []}}));
        const paths = ['/api/current/whoi', '/api/current/navwarn', '/api/current/marine'];
        if (paths.includes(url.pathname)) {
          const reads = (retainedReads.get(url.pathname) ?? 0) + 1;
          retainedReads.set(url.pathname, reads);
          if (reads > 1) { res.statusCode = 503; return res.end(JSON.stringify({error: 'fixture_poll_failed'})); }
          const fetch = {status: 'success', checkedAt: now, lastSuccessAt: now};
          const payload = url.pathname.endsWith('marine') ? {fetch, weather: {code: 95, validAt: now}, data: {status: 'fresh', observation: {waveHeightM: 0, seaSurfaceTemperatureC: 0, oceanCurrentVelocityKmh: 0, validAt: now}}} :
            url.pathname.endsWith('whoi') ? {fetch, data: {status: 'recent_review', latestReview: {reviewDate: now.slice(0,10), detectionCount: 0}}} :
              {fetch, data: {status: 'latest_published_notice', notice: snapshot.notices[0]}};
          return res.end(JSON.stringify(payload));
        }
      }
      if (scenario === 'status' || scenario === 'daily-limit') {
        const fetchState = { status: 'success', checkedAt: '2026-11-03T12:00:00Z', lastSuccessAt: '2026-11-03T12:00:00Z', error: null };
        if (url.pathname === '/api/health') return res.end(JSON.stringify({ api: 'connected', database: 'connected' }));
        if (url.pathname === '/api/historical/presence') return res.end(JSON.stringify({ total: 358, records: snapshot.presence.slice(0, 1) }));
        if (url.pathname === '/api/story/replay') return res.end(JSON.stringify(snapshot));
        if (url.pathname === '/api/ask/status') return res.end(JSON.stringify({ configured: true, limits: { clientCalls: 5, clientWindowSeconds: 600, siteCalls: 50, siteWindowSeconds: 3600, concurrency: 2, totalCalls: 250 } }));
        if (url.pathname === '/api/current/marine') return res.end(JSON.stringify({ sourceUrl: 'https://open-meteo.com/en/docs/marine-weather-api', fetch: fetchState, data: { status: 'fresh', observation: { validAt: '2026-11-03T12:00:00Z', gridLatitude: 49.3, gridLongitude: -64.2, waveHeightM: 1.2, seaSurfaceTemperatureC: 8, oceanCurrentVelocityKmh: 0.4 } } }));
        if (url.pathname === '/api/current/whoi') return res.end(JSON.stringify({ fetch: fetchState, data: { status: 'recent_review', latestReview: { reviewDate: '2026-09-14', detectionCount: 2, sourceUrl: 'https://example.com/whoi' }, indexedDetections: snapshot.detections } }));
        if (url.pathname === '/api/current/navwarn') return res.end(JSON.stringify({ fetch: fetchState, data: { status: 'latest_published_notice', notice: snapshot.notices[0] } }));
        if (url.pathname === '/api/current/ais') return res.end(JSON.stringify({ collection: { mode: 'on-demand', state: scenario === 'daily-limit' ? 'daily-limit' : 'idle', dailyLimitSeconds: 21600, idleSeconds: 120, maxActiveSeconds: 900 }, connection: { status: 'connected', checkedAt: '2026-11-03T12:00:00Z', framesReceived: 3, framesUnparsed: 0, framesOutside: 1, framesStored: 0, lastError: null }, data: { status: 'unknown', positions: [] } }));
        if (url.pathname === '/api/ask' && req.method === 'POST') {
          res.setHeader('X-AI-Remaining-Calls', '249');
          return res.end(JSON.stringify({ answer: 'Fixture model answer.', evidenceIds: [] }));
        }
      }
      if (scenario !== 'offline' && scenario !== 'status') {
        if (url.pathname === '/api/story/replay') return res.end(JSON.stringify(snapshot));
        if (url.pathname === '/api/health') return res.end(JSON.stringify({ api: 'connected', database: 'connected' }));
        if (url.pathname === '/api/historical/presence') return res.end(JSON.stringify({ total: 358, records: snapshot.presence.slice(0, 1) }));
        if (url.pathname === '/api/ask/status') return res.end(JSON.stringify({ configured: false }));
      }
      res.statusCode = 503;
      return res.end(JSON.stringify({ error: 'fixture_unavailable' }));
    }
    if (url.pathname.includes('/createWorld-')) {
      count.scene++;
      if (scenario === 'chunk-error') { res.statusCode = 503; return res.end('scene chunk unavailable fixture'); }
      if (scenario === 'slow') await wait(2500);
    }
    const path = ['/system', '/system/'].includes(url.pathname) ? '/system.html' : url.pathname === '/' ? '/index.html' : url.pathname;
    const full = resolve(root, '.' + path);
    if (!full.startsWith(root + '/')) throw Error();
    let body = await readFile(full);
    if (extname(path) === '.html' && scenario === 'nogl') body = Buffer.from(body.toString().replace('</head>', noGL + '</head>'));
    res.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end('fixture not found'); }
}).listen(port, '127.0.0.1', () => {
  console.log(`Local failure fixtures: http://127.0.0.1:${port}/?mode=story&fixture=nogl (also chunk-error, slow, offline, status, retained); counts: /__fixture/counts`);
});
