import { isInternalRead } from './internal-read.js';
import { requestLifetimeSignal } from './request-lifetime.js';
import type { FastifyInstance } from 'fastify';

export const READ_CACHE_MS: Record<string, number> = {
  '/api/health': 2000, '/api/story/replay': 5000,
  '/api/current/ais': 2000, '/api/current/marine': 2000,
  '/api/current/whoi': 2000, '/api/current/navwarn': 2000,
};
type Cached = { value: unknown; createdAt: number; expiresAt: number };

// Handler leases end when work settles, not when the client disconnects or a
// response deadline fires. Never create an unbounded admission queue.
export function registerApiProtection(server: FastifyInstance, options: {
  maxActive?: number; burst?: number; requestsPerSecond?: number;
  cacheMs?: Record<string, number>; now?: () => number;
} = {}) {
  const maxActive = options.maxActive ?? 12;
  const burst = options.burst ?? 120;
  const rate = options.requestsPerSecond ?? 10;
  const cacheMs = options.cacheMs ?? READ_CACHE_MS;
  const now = options.now ?? Date.now;
  let active = 0; let healthActive = 0; let tokens = burst; let replenishedAt = now();
  const cache = new Map<string, Cached>();
  const pending = new Map<string, Promise<Cached | null>>();
  const wrapped = new WeakSet<Function>();
  const counts = { accepted: 0, limited: 0, overloaded: 0, hits: 0, misses: 0, coalesced: 0, peakActive: 0 };
  server.addHook('onRoute', route => {
    if (!route.url.startsWith('/api/') || wrapped.has(route.handler)) return;
    const original = route.handler;
    const wrapper: typeof original = async function(request, reply) {
      const internal = isInternalRead();
      const health = route.url === '/api/health';
      const at = now();
      tokens = Math.min(burst, tokens + Math.max(0, at - replenishedAt) * rate / 1000);
      replenishedAt = at;
      if (!internal && !health && tokens < 1) {
        counts.limited++; reply.header('Retry-After', '1');
        return reply.code(429).send({ error: 'api_rate_limit', message: 'The site is busy. Please try again shortly.' });
      }
      if (!internal && !health) tokens--;
      if (!internal && (health ? healthActive >= 2 : active >= maxActive)) {
        counts.overloaded++; reply.header('Retry-After', '1');
        return reply.code(503).send({ error: 'api_overloaded', message: 'The site is busy. Please try again shortly.' });
      }
      if (!internal) { if (health) healthActive++; else active++; }
      if (!internal) counts.accepted++;
      counts.peakActive = Math.max(counts.peakActive, active);
      const ttl = (request.method === 'GET' || request.method === 'HEAD') ? cacheMs[route.url] : undefined;
      const label = (entry: Cached, state: string) => {
        reply.header('Cache-Control', 'no-store');
        reply.header('X-Data-Cache', state);
        reply.header('X-Data-Cached-At', new Date(entry.createdAt).toISOString());
        return entry.value;
      };
      try {
        if (requestLifetimeSignal(request, reply).aborted) return;
        if (!ttl) return await original.call(this, request, reply);
        const existing = cache.get(route.url);
        if (existing && existing.expiresAt > at) { counts.hits++; return label(existing, 'HIT'); }
        const inFlight = pending.get(route.url);
        if (inFlight) {
          counts.coalesced++;
          const result = await inFlight;
          if (requestLifetimeSignal(request, reply).aborted) return;
          if (result) return label(result, 'COALESCED');
          return reply.code(503).send({ error: 'read_unavailable', message: 'That reading is temporarily unavailable.' });
        }
        counts.misses++;
        let resolve: (value: Cached | null) => void = () => {};
        pending.set(route.url, new Promise(done => { resolve = done; }));
        try {
          const value = await original.call(this, request, reply);
          if (reply.statusCode === 200 && !reply.sent && !requestLifetimeSignal(request, reply).aborted && value !== undefined && value !== reply) {
            const createdAt = now();
            const entry = { value, createdAt, expiresAt: createdAt + ttl };
            cache.set(route.url, entry); resolve(entry);
            return label(entry, 'MISS');
          }
          cache.delete(route.url); resolve(null); return value;
        } catch (error) { cache.delete(route.url); resolve(null); throw error; }
        finally { pending.delete(route.url); }
      } finally { if (!internal) { if (health) healthActive--; else active--; } }
    };
    wrapped.add(wrapper); route.handler = wrapper;
  });
  return { snapshot: () => ({ ...counts, active, healthActive, cacheEntries: cache.size, pendingReads: pending.size }) };
}
