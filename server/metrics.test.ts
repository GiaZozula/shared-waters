import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { createMetrics, metricsConfig, registerMetrics, startMetricsExport } from './metrics.js';
import type { Pool } from 'pg';

const config = { endpoint: 'https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/metrics', instance: 'all-1', authorization: 'Basic dXNlcjpzZWNyZXQ=' };
const instruments = (metrics: ReturnType<typeof createMetrics>) => metrics.snapshot('all-1').resourceMetrics[0].scopeMetrics[0].metrics as any[];
const byName = (metrics: ReturnType<typeof createMetrics>, name: string) => instruments(metrics).find(item => item.name === name);
const db = { query: async () => ({ rows: [] }) } as unknown as Pool;
const log = { warn: () => {} };

test('metrics use fixed dimensions and no raw paths, supplied IDs or query content', async () => {
  const metrics = createMetrics(() => 1000), server = Fastify(); registerMetrics(server, metrics);
  server.get('/*', async () => 'page');
  server.get('/api/read/:id', async () => ({ ok: true }));
  server.get('/api/wake', async (_req, reply) => reply.code(503).send({ ok: false }));
  try {
    await server.inject('/api/read/PRIVATE?question=SECRET');
    for (let i = 0; i < 100; i++) await server.inject(`/scanner-${i}?secret=SECRET`);
    await server.inject('/api/wake');
    await server.inject('/?question=SECRET');
    const snapshot = JSON.stringify(metrics.snapshot('all-1'));
    assert.doesNotMatch(snapshot, /PRIVATE|SECRET|scanner|read\/:id/);
    const requests = byName(metrics, 'shared_waters_http_requests').sum.dataPoints;
    assert.equal(requests.length, 25);
    assert.equal(requests.reduce((sum: number, point: any) => sum + point.asDouble, 0), 103);
    const latency = byName(metrics, 'shared_waters_http_duration').histogram.dataPoints;
    assert.equal(latency.length, 5);
    assert.equal(latency.reduce((sum: number, point: any) => sum + Number(point.count), 0), 103);
    assert.ok(Buffer.byteLength(snapshot) < 32_768);
    assert.equal(byName(metrics, 'shared_waters_http_admission_outcomes').sum.dataPoints[1].asDouble, 1);
  } finally { await server.close(); }
});

test('latency samples use seconds, explicit buckets and missing values are omitted', () => {
  const metrics = createMetrics(() => 1000);
  metrics.request('/api/read', 200, 100);
  metrics.request('/api/read', 200, NaN);
  metrics.request('/api/read', 200, 11_000);
  const duration = byName(metrics, 'shared_waters_http_duration').histogram.dataPoints[0];
  assert.equal(duration.count, '2'); assert.equal(duration.sum, 11.1);
  assert.deepEqual(duration.bucketCounts, ['0','1','0','0','0','0','0','0','1']);
  assert.equal(duration.startTimeUnixNano, '1000000000');
});

test('missing/future feed clocks never turn into zero freshness and owner transitions count changes', () => {
  const metrics = createMetrics(() => 20_000);
  assert.equal(byName(metrics, 'shared_waters_feed_success_known'), undefined);
  metrics.feeds([{ source: 'whoi_robots4whales', lastSuccessAt: new Date(10_000) }, { source: 'open_meteo_marine', lastSuccessAt: new Date(30_000) }]);
  assert.equal(byName(metrics, 'shared_waters_feed_last_success_time').gauge.dataPoints.length, 1);
  assert.equal(byName(metrics, 'shared_waters_feed_last_success_time').gauge.dataPoints[0].asDouble, 10);
  metrics.feeds(null);
  assert.equal(byName(metrics, 'shared_waters_feed_last_success_time').gauge.dataPoints.length, 0);
  assert.equal(byName(metrics, 'shared_waters_feed_status_read_success').gauge.dataPoints[0].asDouble, 0);
  metrics.owner('owner'); metrics.owner('owner'); metrics.owner('disconnected');
  assert.deepEqual(byName(metrics, 'shared_waters_owner_transitions').sum.dataPoints.map((point: any) => point.asDouble), [1,0,1,0]);
});

test('export defaults off and only accepts bounded Grafana endpoints and fixed instance names', () => {
  assert.equal(metricsConfig({}), null);
  const env = { METRICS_EXPORT_ENABLED: 'true', METRICS_OTLP_ENDPOINT: config.endpoint, METRICS_INSTANCE: config.instance, METRICS_OTLP_AUTHORIZATION: config.authorization };
  assert.deepEqual(metricsConfig(env), config);
  for (const endpoint of ['http://localhost:4318/v1/metrics', 'https://attacker.example/otlp/v1/metrics', config.endpoint + '?secret=a', 'https://user:password@otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/metrics']) {
    assert.throws(() => metricsConfig({ ...env, METRICS_OTLP_ENDPOINT: endpoint }), /Invalid bounded/);
  }
  assert.throws(() => metricsConfig({ ...env, METRICS_INSTANCE: 'user-supplied-or-random' }), /Invalid bounded/);
});

test('one batch at a time; no retry, no arbitrary response/error logging and shutdown prevents exports', async () => {
  let resolve!: (response: Response) => void, calls = 0, queries = 0;
  const warnings: unknown[] = [];
  const exporter = startMetricsExport({ metrics: createMetrics(), config,
    db: { query: async () => { queries++; return { rows: [] }; } } as unknown as Pool,
    log: { warn: (...args) => warnings.push(args) },
    request: async (_url, init) => {
      calls++; assert.equal(init?.redirect, 'error');
      assert.equal((init?.headers as Record<string,string>).Authorization, config.authorization);
      return new Promise<Response>(done => { resolve = done; });
    } });
  const pending = exporter.send(); await Promise.resolve(); await Promise.resolve();
  await exporter.send(); assert.equal(calls, 1); assert.equal(queries, 1);
  resolve(new Response('SECRET PROVIDER RESPONSE', { status: 500 })); await pending;
  assert.equal(calls, 1); assert.equal(warnings.length, 1);
  assert.doesNotMatch(JSON.stringify(warnings), /SECRET|Basic|secret/);
  await exporter.close(); await exporter.send(); assert.equal(calls, 1);
});

test('failed source sampling does not block export and shutdown aborts a pending request', async () => {
  let aborted = false;
  const exporter = startMetricsExport({ metrics: createMetrics(), config, log,
    db: { query: async () => { throw Error('PRIVATE DATABASE DETAILS'); } } as unknown as Pool,
    request: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      const payload = JSON.parse(String(init?.body));
      assert.doesNotMatch(JSON.stringify(payload), /PRIVATE/);
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(Error('SECRET')); });
    }) });
  const pending = exporter.send(); await Promise.resolve(); await Promise.resolve();
  await exporter.close(); await pending; assert.equal(aborted, true);
});

test('OTLP partial rejection and oversized success bodies are safe export failures', async () => {
  for (const body of ['{"partialSuccess":{"rejectedDataPoints":"3","errorMessage":"SECRET"}}', 'x'.repeat(5000)]) {
    const warnings: unknown[] = [];
    const exporter = startMetricsExport({ metrics: createMetrics(), config, db,
      log: { warn: (...args) => warnings.push(args) }, request: async () => new Response(body) });
    await exporter.send(); await exporter.close();
    assert.equal(warnings.length, 1); assert.doesNotMatch(JSON.stringify(warnings), /SECRET|xxxxx/);
  }
});
