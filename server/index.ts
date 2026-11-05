import { readHistoricalPresence } from './historical-presence.js';
import 'dotenv/config';
import { createMetrics, metricsConfig, registerMetrics, startMetricsExport } from './metrics.js';
import { registerWakeRoute } from './wake.js';
import { registerApiBoundary } from './api-boundary.js';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { databasePoolOptions, createRuntimePool } from './database.js';
import { MARINE_POINT, MARINE_SOURCE, MARINE_URL, marineDataStatus } from './marine.js';
import { WHOI_MISSION_URL, WHOI_SOURCE } from './whoi.js';
import { NAVWARN_SEARCH_URL, NAVWARN_SOURCE } from './navwarn.js';
import { registerDomainRoutes } from './domain-routes.js';
import { registerAgentRoutes } from './agent.js';
import { registerReplayRoute } from './replay.js';
import { preferredCurrentNavwarnNotice } from './navwarn-query.js';
import { registerAisRoute } from './ais-routes.js';
import { registerQuestionRoutes } from './question-routes.js';
import { createCollectionOwner, coordinationUrl, runtimeRole } from './collection-owner.js';
import { createCollectionRuntime } from './collection-runtime.js';
import { touchCollectionDemand, readCollectionState } from './collection-state.js';
import { observableServerOptions, registerObservability } from './observability.js';
import { registerApiProtection } from './api-protection.js';

const role = runtimeRole(process.env.ROLE);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL before starting the server.');

const db = createRuntimePool({ ...databasePoolOptions(databaseUrl), max: role === 'worker' ? 3 : 5 });
const server = Fastify(observableServerOptions);
// Worker processes expose readiness only, never the public data/question API.
if (role === 'worker') server.addHook('onRequest', async (request, reply) => {
  if (request.url !== '/api/health') return reply.code(404).send({ error: 'worker_readiness_only' });
});
db.on('error', error => server.log.error(error, 'Idle database connection failed'));
registerObservability(server, { browserApiOrigin: process.env.VITE_API_BASE });
const metrics = createMetrics();
registerMetrics(server, metrics);
let metricsConfiguration: ReturnType<typeof metricsConfig> = null;
try { metricsConfiguration = metricsConfig(process.env); }
catch { server.log.warn({ event: 'metrics_configuration_invalid' }, 'Metrics export disabled; existing logs remain available'); }
const metricsExport = metricsConfiguration ? startMetricsExport({ metrics, config: metricsConfiguration, db, log: server.log }) : null;
registerApiBoundary(server);
registerApiProtection(server);
registerWakeRoute(server, db);
const dist = resolve(process.cwd(), 'dist');
const systemPage = resolve(dist, 'system.html');
for (const path of ['/status', '/status/', '/status.html']) {
  server.get(path, async (_request, reply) => reply.code(301).redirect('/system'));
}
server.get('/system', async (_request, reply) => {
  try {
    return reply.header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(await readFile(systemPage));
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    if (!missing) throw error;
    return reply.code(404).type('text/plain; charset=utf-8').send('System page is not built. Open the Vite development server at /system, or run npm run build.');
  }
});
if (existsSync(resolve(dist, 'index.html'))) {
  await server.register(fastifyStatic, { root: dist, prefix: '/',
    setHeaders(response, path) {
      response.header('Cache-Control', path.includes('/assets/')
        ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
}
registerDomainRoutes(server, db);
registerAgentRoutes(server, db);
registerReplayRoute(server, db);
// An explicit offline switch for artifact checks and data-only operation.
const collectionEnabled = process.env.COLLECTION_ENABLED !== 'false';
const aisMode = process.env.AIS_COLLECTION_MODE ?? 'on-demand';
if (aisMode !== 'on-demand' && aisMode !== 'always') throw new Error('AIS_COLLECTION_MODE must be on-demand or always.');
let ownerState = '';
const owner = collectionEnabled && role !== 'api' ? createCollectionOwner({
  url: coordinationUrl(process.env.COORDINATION_DATABASE_URL, databaseUrl),
  start: (signal, failed, session) => createCollectionRuntime({ db, session, signal, failed,
    log: server.log, apiKey: process.env.AISSTREAM_API_KEY, always: aisMode === 'always' }),
  onState: state => { metrics.owner(state); if (state !== ownerState) { ownerState = state; server.log.info({ state, role }, 'Collector ownership changed'); } },
}) : null;
if (!owner) metrics.owner('disabled');
registerAisRoute(server, db, collectionEnabled ? () => touchCollectionDemand(db) : undefined,
  collectionEnabled ? () => readCollectionState(db, aisMode === 'always') : () => ({ mode: 'disabled', state: 'disabled', activeSince: null, resumeAt: null, idleSeconds: 120, maxActiveSeconds: 900 }));
registerQuestionRoutes(server, db);

server.get('/api/health', async (request, reply) => {
  try {
    await db.query('SELECT 1');
    return { api: 'connected', database: 'connected' };
  } catch (error) {
    request.log.error(error, 'Database health check failed');
    return reply.code(503).send({ api: 'connected', database: 'disconnected' });
  }
});

server.get<{ Querystring: { limit?: number; offset?: number } }>(
  '/api/historical/presence',
  {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0, maximum: 1000 },
        },
      },
    },
  },
  async (request, reply) => {
    const limit = request.query.limit ?? 25;
    const offset = request.query.offset ?? 0;
    try {
      return await readHistoricalPresence(db, limit, offset);
    } catch (error) {
      request.log.error(error, 'Historical presence query failed');
      return reply.code(503).send({ error: 'historical_data_unavailable' });
    }
  },
);

server.get('/api/current/marine', async (request, reply) => {
  try {
    const [feedResult, observationResult] = await Promise.all([
      db.query<{ last_attempt_at: Date; last_success_at: Date | null; last_error: string | null; last_attempt_status: 'success' | 'error' }>(
        `SELECT last_attempt_at, last_success_at, last_error, last_attempt_status
         FROM feed_status WHERE source = $1`, [MARINE_SOURCE]),
      db.query(
        `SELECT id, source, source_record_id AS "sourceRecordId", zone_id AS "zoneId",
                valid_at AS "validAt", grid_latitude AS "gridLatitude",
                grid_longitude AS "gridLongitude", wave_height_m AS "waveHeightM",
                sea_surface_temperature_c AS "seaSurfaceTemperatureC",
                ocean_current_velocity_kmh AS "oceanCurrentVelocityKmh",
                source_url AS "sourceUrl", raw_payload AS "rawPayload",
                first_ingested_at AS "firstIngestedAt", last_fetched_at AS "lastFetchedAt"
         FROM marine_observations WHERE source = $1 AND zone_id = 'zone_a'
         ORDER BY valid_at DESC LIMIT 1`, [MARINE_SOURCE]),
    ]);
    const feed = feedResult.rows[0];
    const storedObservation = observationResult.rows[0] ?? null;
    const { rawPayload: privatePayload, ...publicObservation } = storedObservation ?? {};
    const observation = storedObservation ? publicObservation : null;
    const freshness = marineDataStatus(observation, new Date());
    return {
      source: MARINE_SOURCE,
      requestedPoint: MARINE_POINT,
      sourceUrl: MARINE_URL.toString(),
      attribution: 'Modeled marine conditions: Open-Meteo; DWD credited per Open-Meteo attribution guidance.',
      note: 'Model values at the returned grid point, not direct observations of whales or vessels. Model issue time is not supplied.',
      fetch: feed ? {
        status: feed.last_attempt_status,
        checkedAt: feed.last_attempt_at,
        lastSuccessAt: feed.last_success_at,
        error: feed.last_error,
      } : { status: 'never', checkedAt: null, lastSuccessAt: null, error: null },
      weather: privatePayload?.liveWeather ?? null,
      data: { ...freshness, observation },
    };
  } catch (error) {
    request.log.error(error, 'Marine state query failed');
    return reply.code(503).send({ error: 'marine_data_unavailable' });
  }
});

type FeedRow = { last_attempt_at: Date; last_success_at: Date | null; last_error: string | null; last_attempt_status: 'success' | 'error' };
async function feedState(source: string) {
  const result = await db.query<FeedRow>(
    `SELECT last_attempt_at, last_success_at, last_error, last_attempt_status FROM feed_status WHERE source = $1`, [source],
  );
  const feed = result.rows[0];
  return feed ? { status: feed.last_attempt_status, checkedAt: feed.last_attempt_at,
    lastSuccessAt: feed.last_success_at, error: feed.last_error } :
    { status: 'never', checkedAt: null, lastSuccessAt: null, error: null };
}

server.get('/api/current/whoi', async (request, reply) => {
  try {
    const [fetch, reviewResult, detectionResult] = await Promise.all([
      feedState(WHOI_SOURCE),
      db.query(`SELECT review_date::text AS "reviewDate", detection_count AS "detectionCount", source_url AS "sourceUrl",
                       first_ingested_at AS "firstIngestedAt", last_fetched_at AS "lastFetchedAt"
                FROM whoi_reviews WHERE zone_id = 'zone_a' ORDER BY review_date DESC LIMIT 1`),
      db.query(`SELECT id, source_record_id AS "sourceRecordId", review_date::text AS "reviewDate",
                       source_local_time AS "sourceLocalTime", occurrence, platform_latitude AS "platformLatitude",
                       platform_longitude AS "platformLongitude", source_url AS "sourceUrl", raw_text AS "rawText"
                FROM whoi_detections WHERE zone_id = 'zone_a' ORDER BY source_local_time DESC LIMIT 10`),
    ]);
    const review = reviewResult.rows[0] ?? null;
    const day = review?.reviewDate ? new Date(review.reviewDate).getTime() : NaN;
    const ageDays = Number.isFinite(day) ? Math.floor((Date.now() - day) / 86_400_000) : null;
    return {
      source: WHOI_SOURCE, sourceUrl: WHOI_MISSION_URL.toString(), fetch,
      data: { status: !review ? 'missing' : ageDays !== null && ageDays >= 0 && ageDays <= 2 ? 'recent_review' : 'stale_review',
        ageDays, latestReview: review, indexedDetections: detectionResult.rows },
      note: 'WHOI analyst review, not a live acoustic stream. Only the seven newest review pages and the 14 September story page are indexed. Recent review means the current UTC calendar date or prior two dates, not a strict 48-hour window. Times remain source-local; coordinates are glider positions, not whale positions. No right-whale rows on a reviewed day do not prove absence.',
    };
  } catch (error) {
    request.log.error(error, 'WHOI state query failed');
    return reply.code(503).send({ error: 'whoi_data_unavailable' });
  }
});

server.get('/api/current/navwarn', async (request, reply) => {
  try {
    const [fetch, notice] = await Promise.all([
      feedState(NAVWARN_SOURCE),
      preferredCurrentNavwarnNotice(db),
    ]);
    const inLastSuccessfulSearch = Boolean(notice && fetch.lastSuccessAt &&
      new Date(notice.lastFetchedAt).getTime() === new Date(fetch.lastSuccessAt).getTime());
    const verifiedRecently = fetch.status === 'success' && fetch.lastSuccessAt &&
      Date.now() - new Date(fetch.lastSuccessAt).getTime() <= 6 * 60 * 60 * 1000;
    const status = !notice ? 'missing' : !verifiedRecently || !inLastSuccessfulSearch ? 'unverified' :
      new Date(notice.effectiveAt).getTime() > Date.now() ? 'pending_effective_time' : 'latest_published_notice';
    return {
      source: NAVWARN_SOURCE, sourceUrl: NAVWARN_SEARCH_URL.toString(), fetch,
      data: { status, notice },
      note: 'This reports what the newest matching notice found in the last successful published search says about Zone A, not a navigation or legal determination. A fresh successful search can return an older published notice if a newer stored notice was absent from that search; the absent notice is not returned as current. A failed or old search, or a fallback stored notice not seen in the last successful search, is unverified. The 10-knot rule applies to vessels over 13 m and has exceptions.',
    };
  } catch (error) {
    request.log.error(error, 'NAVWARN state query failed');
    return reply.code(503).send({ error: 'navwarn_data_unavailable' });
  }
});

server.addHook('onClose', async () => {
  await metricsExport?.close();
  await owner?.close();
  await db.end();
});
await server.listen({ host: process.env.HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 3001) });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void server.close().catch((error: unknown) => {
      server.log.error(error, 'Server shutdown failed');
      process.exitCode = 1;
    });
  });
}
