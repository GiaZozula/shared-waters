import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

const KINDS = ['api', 'wake', 'health', 'page', 'other'] as const;
const STATUSES = ['2xx', '3xx', '4xx', '5xx', 'other'] as const;
const BOUNDS = [.05, .1, .25, .5, 1, 2.5, 5, 10];
const SOURCES = ['open_meteo_marine', 'whoi_robots4whales', 'canadian_coast_guard_navwarn'] as const;
const OWNER_STATES = ['owner', 'standby', 'disconnected', 'disabled'] as const;
type OwnerState = typeof OWNER_STATES[number];
const attributes = (values: Record<string, string>) => Object.entries(values).map(([key, value]) => ({ key, value: { stringValue: value } }));
const nano = (ms: number) => `${BigInt(Math.floor(ms)) * 1_000_000n}`;

// Fixed dimensions, no paths/queries/identity/question text or growing maps.
export function createMetrics(now = Date.now) {
  const started = now();
  const requests = KINDS.map(() => STATUSES.map(() => 0));
  const latencies = KINDS.map(() => ({ count: 0, sum: 0, buckets: BOUNDS.map(() => 0).concat(0) }));
  const admission = { rate_limited: 0, unavailable: 0 };
  const transitions = OWNER_STATES.map(() => 0);
  let owner: OwnerState | null = null;
  let feedRead: boolean | null = null;
  let feedSampleAt: number | null = null;
  const feedSuccess = new Map<string, number>();
  return {
    request(route: string | undefined, status: number, durationMs: number) {
      const kind = route === '/api/wake' ? 'wake' : route === '/api/health' ? 'health' :
        route?.startsWith('/api/') ? 'api' : route === '/' || route === '/system' ? 'page' : 'other';
      const i = KINDS.indexOf(kind), group = `${Math.floor(status / 100)}xx`;
      const j = STATUSES.findIndex(value => value === group);
      requests[i][j < 0 ? 4 : j]++;
      if (Number.isFinite(durationMs) && durationMs >= 0) {
        const seconds = durationMs / 1000;
        const latency = latencies[i]; latency.count++; latency.sum += seconds;
        const bucket = BOUNDS.findIndex(bound => seconds <= bound);
        latency.buckets[bucket < 0 ? BOUNDS.length : bucket]++;
      }
      // HTTP outcomes, not a claim about which admission guard caused them.
      if (status === 429) admission.rate_limited++;
      if (status === 503) admission.unavailable++;
    },
    owner(state: OwnerState) {
      if (owner !== state) transitions[OWNER_STATES.indexOf(state)]++;
      owner = state;
    },
    feeds(rows: { source: string; lastSuccessAt: Date | string | null }[] | null) {
      feedRead = rows !== null;
      feedSuccess.clear();
      if (rows === null) return;
      feedSampleAt = now();
      for (const source of SOURCES) {
        const row = rows.find(row => row.source === source);
        const at = row?.lastSuccessAt == null ? NaN : new Date(row.lastSuccessAt).getTime();
        if (Number.isFinite(at) && at <= now()) feedSuccess.set(source, at / 1000);
      }
    },
    snapshot(instance: string) {
      const at = now();
      const point = (value: number, labels: Record<string, string> = {}) => ({ attributes: attributes(labels), timeUnixNano: nano(at), asDouble: value });
      const gauge = (name: string, unit: string, points: ReturnType<typeof point>[]) => ({ name, unit, gauge: { dataPoints: points } });
      const sum = (name: string, points: ReturnType<typeof point>[]) => ({ name, unit: '1', sum: {
        aggregationTemporality: 2, isMonotonic: true,
        dataPoints: points.map(point => ({ ...point, startTimeUnixNano: nano(started) })),
      } });
      const metrics: object[] = [
        sum('shared_waters_http_requests', KINDS.flatMap((kind, i) => STATUSES.map((status, j) => point(requests[i][j], { kind, status })))),
        { name: 'shared_waters_http_duration', unit: 's', histogram: { aggregationTemporality: 2,
          dataPoints: KINDS.map((kind, i) => ({ attributes: attributes({ kind }), startTimeUnixNano: nano(started),
            timeUnixNano: nano(at), count: String(latencies[i].count), sum: latencies[i].sum,
            explicitBounds: BOUNDS, bucketCounts: latencies[i].buckets.map(String) })) } },
        sum('shared_waters_http_admission_outcomes', Object.entries(admission).map(([outcome, value]) => point(value, { outcome }))),
        gauge('shared_waters_process_observed_time', 's', [point(at / 1000)]),
        sum('shared_waters_owner_transitions', OWNER_STATES.map((state, i) => point(transitions[i], { state }))),
      ];
      if (owner !== null) metrics.push(gauge('shared_waters_owner_state', '1', OWNER_STATES.map(state => point(Number(owner === state), { state }))));
      if (feedRead !== null) {
        metrics.push(gauge('shared_waters_feed_status_read_success', '1', [point(Number(feedRead))]));
        metrics.push(gauge('shared_waters_feed_success_known', '1', SOURCES.map(source => point(Number(feedSuccess.has(source)), { source }))));
        metrics.push(gauge('shared_waters_feed_last_success_time', 's', [...feedSuccess].map(([source, value]) => point(value, { source }))));
        if (feedRead && feedSampleAt !== null) metrics.push(gauge('shared_waters_feed_status_sample_time', 's', [point(feedSampleAt / 1000)]));
      }
      return { resourceMetrics: [{ resource: { attributes: attributes({ 'service.name': 'shared-waters', 'service.instance.id': instance }) },
        scopeMetrics: [{ scope: { name: 'shared-waters-bounded-metrics', version: '1' }, metrics }] }] };
    },
  };
}
export type Metrics = ReturnType<typeof createMetrics>;

export function metricsConfig(env: Record<string, string | undefined>) {
  if (env.METRICS_EXPORT_ENABLED !== 'true') return null;
  try {
    const endpoint = new URL(env.METRICS_OTLP_ENDPOINT ?? '');
    if (endpoint.protocol !== 'https:' || !/^otlp-gateway-[a-z0-9-]+\.grafana\.net$/.test(endpoint.hostname) ||
        endpoint.pathname !== '/otlp/v1/metrics' || endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw Error();
    const instance = env.METRICS_INSTANCE ?? '';
    if (!['all-1', 'api-1', 'api-2', 'worker-1', 'worker-2'].includes(instance) ||
        !/^Basic [A-Za-z0-9+/]+=*$/.test(env.METRICS_OTLP_AUTHORIZATION ?? '') ||
        (env.METRICS_OTLP_AUTHORIZATION?.length ?? 0) > 4096 ||
        !instance.startsWith(`${env.ROLE ?? 'all'}-`)) throw Error();
    return { endpoint: endpoint.toString(), instance, authorization: env.METRICS_OTLP_AUTHORIZATION! };
  } catch { throw new Error('Invalid bounded metrics export configuration.'); }
}

export function startMetricsExport(options: {
  metrics: Metrics; config: NonNullable<ReturnType<typeof metricsConfig>>;
  db: Pick<Pool, 'query'>; log: { warn: (value: object, message: string) => void };
  request?: typeof fetch; intervalMs?: number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  let pending: Promise<void> | null = null;
  let closed = false;
  const send = async () => {
    if (closed || pending) return;
    pending = (async () => {
      try {
        const result = await options.db.query<{ source: string; lastSuccessAt: Date | null }>(
          `SELECT source, last_success_at AS "lastSuccessAt" FROM feed_status WHERE source = ANY($1::text[])`, [[...SOURCES]]);
        options.metrics.feeds(result.rows);
      } catch { options.metrics.feeds(null); }
      if (closed) return;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 3000); timeout.unref();
      try {
        const body = JSON.stringify(options.metrics.snapshot(options.config.instance));
        if (Buffer.byteLength(body) > 32_768) throw Error();
        const response = await (options.request ?? fetch)(options.config.endpoint, { method: 'POST', redirect: 'error',
          headers: { 'Content-Type': 'application/json', Authorization: options.config.authorization }, body, signal: controller.signal });
        if (!response.ok) { await response.body?.cancel(); throw Error(); }
        // OTLP can report rejected points in a 200 response. Bound the response
        // before decoding it, and never retain/log arbitrary provider text.
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        if (reader) for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 4096) { await reader.cancel(); throw Error(); }
          chunks.push(next.value);
        }
        const text = Buffer.concat(chunks).toString('utf8');
        const result = text ? JSON.parse(text) : {};
        if (Number(result.partialSuccess?.rejectedDataPoints ?? 0) > 0) throw Error();
      } catch { if (!closed) options.log.warn({ event: 'metrics_export_failed' }, 'Metrics export failed; existing logs remain available'); }
      finally { clearTimeout(timeout); controller = null; }
    })().finally(() => { pending = null; });
    await pending;
  };
  const schedule = () => {
    if (closed) return;
    timer = setTimeout(() => { void send().finally(schedule); }, options.intervalMs ?? 60_000); timer.unref();
  };
  schedule();
  return { send, async close() { closed = true; clearTimeout(timer); controller?.abort(); await pending; } };
}

export function registerMetrics(server: FastifyInstance, metrics: Metrics) {
  server.addHook('onResponse', async (request, reply) => {
    const path = request.raw.url?.split('?', 1)[0];
    const route = path === '/' || path === '/index.html' ? '/' : request.routeOptions.url;
    metrics.request(route, reply.statusCode, reply.elapsedTime);
  });
}
