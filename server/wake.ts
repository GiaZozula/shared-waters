import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

// Browser visit readiness, separately admitted/counted from platform health.
// Deliberately no collector, current-state injection or model call.
export function registerWakeRoute(server: FastifyInstance, db: Pick<Pool, 'query'>) {
  server.get('/api/wake', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      await db.query('SELECT 1');
      return { service: 'shared-waters', api: 'connected', database: 'connected' };
    } catch (error) {
      request.log.error(error, 'Browser readiness check failed');
      return reply.code(503).send({ service: 'shared-waters', api: 'connected', database: 'disconnected' });
    }
  });
}
