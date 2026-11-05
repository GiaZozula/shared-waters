import { browserContentSecurityPolicy } from '../shared/browser-policy.js';
import { randomUUID } from 'node:crypto';
import { LogController } from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyServerOptions } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    questionTelemetry?: { kind: 'free' | 'paid'; admitted?: boolean; remainingCalls?: number; reason?: string };
  }
}

// Error messages/stacks can contain provider URLs, credentials or question content.
// Keep diagnostic categories, not arbitrary upstream text. Never log request bodies.
export const observableServerOptions: FastifyServerOptions = {
  requestIdHeader: false,
  genReqId: () => randomUUID(),
  logController: new LogController({ disableRequestLogging: true }),
  bodyLimit: 24_000,
  requestTimeout: 10_000,
  connectionTimeout: 20_000,
  handlerTimeout: 15_000,
  logger: {
    serializers: {
      req: () => ({}),
      res: (reply: { statusCode: number }) => ({ statusCode: reply.statusCode }),
      err: (error: { name?: string; code?: string }) => ({
        type: ['Error', 'TypeError', 'RangeError', 'AbortError'].includes(error.name ?? '') ? error.name! : 'Error',
        message: '[omitted]', stack: '[omitted]',
        code: /^(?:[0-9A-Z]{5}|E[A-Z_]{2,40}|FST_ERR_[A-Z_]{1,60})$/.test(error.code ?? '') ? error.code : undefined,
      }),
    },
    redact: { paths: ['req', 'headers', 'body', 'query', 'cookie', 'authorization', 'password', 'connectionString'], remove: true },
  },
};

const LATENCY_BUCKETS = [50, 100, 250, 500, 1000, 2500, 5000, 10_000, Infinity];
type RouteCounts = { requests: number; errors: number; limited: number; durationMsTotal: number; latencyBuckets: number[] };
const newCounts = (): RouteCounts => ({ requests: 0, errors: 0, limited: 0, durationMsTotal: 0,
  latencyBuckets: LATENCY_BUCKETS.map(() => 0) });

function routeLabel(request: FastifyRequest): string {
  // Static serving uses a wildcard. Recognize only these fixed page paths, never log URLs/query strings.
  const path = request.raw.url?.split('?', 1)[0];
  if (path === '/' || path === '/index.html') return '/';
  return request.routeOptions.url ?? 'unmatched';
}

export function registerObservability(server: FastifyInstance, options: { intervalMs?: number; detailLimit?: number; browserApiOrigin?: string } = {}) {
  const browserPolicy = browserContentSecurityPolicy(options.browserApiOrigin);
  let startedAt = Date.now();
  let detailWindow = startedAt;
  let detailed = 0;
  let suppressed = 0;
  let healthChecks = 0;
  let healthErrors = 0;
  let pages = 0;
  let questionCounts: Record<string, number> = {};
  let routes = new Map<string, RouteCounts>();
  const incrementQuestion = (key: string) => { questionCounts[key] = (questionCounts[key] ?? 0) + 1; };

  function flush() {
    if (!routes.size && !healthChecks) return;
    server.log.info({ event: 'traffic_summary', windowStartedAt: new Date(startedAt).toISOString(),
      windowSeconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
      pageRequests: pages, healthChecks, healthErrors, questions: questionCounts,
      latencyBucketUpperBoundsMs: LATENCY_BUCKETS.map(value => Number.isFinite(value) ? value : null),
      routes: Object.fromEntries(routes), suppressedDetails: suppressed,
    }, 'Traffic summary; request counts are not unique people');
    startedAt = Date.now(); routes = new Map(); questionCounts = {}; pages = 0; healthChecks = 0; healthErrors = 0; suppressed = 0;
  }

  server.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });
  server.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', browserPolicy);
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (request.routeOptions.url?.startsWith('/api/ask')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  server.setErrorHandler((error, request, reply) => {
    const statusCode = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const deadline = error && typeof error === 'object' && 'code' in error && error.code === 'FST_ERR_HANDLER_TIMEOUT';
    const status = deadline ? 503 : typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    if (status >= 500) request.log.error({ err: error, event: 'request_error' }, 'Unhandled request error');
    reply.code(status).send({ error: status >= 500 ? 'internal_error' : 'invalid_request',
      message: status >= 500 ? 'The request could not be completed.' : 'That request could not be accepted.', requestId: request.id });
  });
  server.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ error: 'not_found' }));
  server.addHook('onResponse', async (request, reply) => {
    const route = routeLabel(request);
    const statusCode = reply.statusCode;
    const durationMs = Math.round(reply.elapsedTime);
    if (route === '/api/health') { healthChecks++; healthErrors += Number(statusCode >= 500); }
    else {
      const method = ['GET', 'POST', 'HEAD', 'OPTIONS'].includes(request.method) ? request.method : 'OTHER';
      const key = `${method} ${route}`;
      const boundedKey = routes.has(key) || routes.size < 64 ? key : 'OTHER overflow';
      const counts = routes.get(boundedKey) ?? newCounts();
      counts.requests++; counts.errors += Number(statusCode >= 500); counts.limited += Number(statusCode === 429);
      counts.durationMsTotal += durationMs;
      counts.latencyBuckets[LATENCY_BUCKETS.findIndex(bound => durationMs <= bound)]++;
      routes.set(boundedKey, counts);
      if (route === '/' || route === '/system') pages++;
    }
    const question = request.questionTelemetry;
    if (route === '/api/ask') {
      if (question?.admitted) incrementQuestion('paidAdmitted');
      if (statusCode === 429) incrementQuestion('limited');
      else if (statusCode >= 500) incrementQuestion(question?.admitted ? 'paidFailed' : 'unavailable');
      else if (statusCode >= 400) incrementQuestion('invalid');
      else incrementQuestion(question?.kind === 'free' ? 'freeAnswered' : 'paidAnswered');
    }
    if (Date.now() - detailWindow >= 60_000) { detailWindow = Date.now(); detailed = 0; }
    if (route === '/' || route === '/system' || statusCode >= 400 || question?.admitted) {
      if (detailed++ >= (options.detailLimit ?? 60)) { suppressed++; return; }
      const entry = { event: 'http_request', method: request.method === 'POST' ? 'POST' : request.method === 'GET' ? 'GET' : 'OTHER',
        route, statusCode, durationMs, question };
      if (statusCode >= 500) request.log.error(entry, 'Request completed');
      else if (statusCode >= 400) request.log.warn(entry, 'Request completed');
      else request.log.info(entry, 'Request completed');
    }
  });
  const timer = setInterval(flush, options.intervalMs ?? 60_000);
  timer.unref();
  server.addHook('onClose', async () => { clearInterval(timer); flush(); });
  return { flush };
}
