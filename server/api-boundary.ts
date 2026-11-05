import type { FastifyInstance } from 'fastify';
import { apiOrigin } from '../shared/api-origin.js';

export function registerApiBoundary(server: FastifyInstance, options: { allowedOrigins?: string[] } = {}) {
  const configured = options.allowedOrigins ?? (process.env.API_ALLOWED_ORIGINS?.split(',') ?? [
    'https://shared-waters.onrender.com',
    ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
  ]);
  const allowed = new Set(configured.map(value => {
    const origin = apiOrigin(value);
    if (!origin) throw new Error('API_ALLOWED_ORIGINS cannot contain an empty origin.');
    return origin;
  }));
  server.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?', 1)[0];
    if (!path.startsWith('/api/')) return;
    reply.header('Vary', 'Origin');
    const origin = request.headers.origin;
    if (origin !== undefined) {
      if (!allowed.has(origin)) return reply.code(403).send({ error: 'origin_not_allowed', message: 'This site cannot access the question and data service.' });
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
    }
    if (request.method === 'POST' && path === '/api/ask') {
      if (!origin && request.headers.cookie) return reply.code(403).send({ error: 'origin_required', message: 'Browser questions require a recognized site origin.' });
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
        return reply.code(415).send({ error: 'json_required', message: 'Questions must be sent as JSON.' });
      }
    }
    if (request.method === 'OPTIONS') {
      reply.header('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
      const method = request.headers['access-control-request-method'];
      const headers = String(request.headers['access-control-request-headers'] ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      if (!origin || !['GET', 'HEAD', ...(path === '/api/ask' ? ['POST'] : [])].includes(String(method)) ||
        headers.some(header => header !== 'content-type')) {
        return reply.code(403).send({ error: 'preflight_not_allowed' });
      }
      reply.header('Access-Control-Allow-Methods', path === '/api/ask' ? 'GET, HEAD, POST' : 'GET, HEAD');
      reply.header('Access-Control-Allow-Headers', 'Content-Type');
      reply.header('Access-Control-Max-Age', '600');
      return reply.code(204).send();
    }
  });
  server.options('/api/*', async (_request, reply) => reply.code(403).send({ error: 'preflight_not_allowed' }));
}
