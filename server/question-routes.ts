import { injectInternalRead } from './internal-read.js';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

const evidenceQueries = [
  `SELECT id, 'gfw_presence' AS kind, event_at AS "eventAt", speed_band_group AS "speedBandGroup",
    latitude, longitude, source_url AS "sourceUrl" FROM historical_presence WHERE zone_id = 'zone_a' AND id = $1`,
  `SELECT id, 'whoi_detection' AS kind, source_local_time AS "sourceLocalTime", occurrence,
    platform_latitude AS "platformLatitude", platform_longitude AS "platformLongitude",
    source_url AS "sourceUrl" FROM whoi_detections WHERE zone_id = 'zone_a' AND id = $1`,
  `SELECT id, 'navwarn_notice' AS kind, published_at AS "publishedAt", effective_at AS "effectiveAt",
    zone_a_state AS "zoneAState", applies_to AS "appliesTo", source_url AS "sourceUrl"
    FROM navwarn_notices WHERE zone_id = 'zone_a' AND id = $1`,
  `SELECT id, 'ais_position' AS kind, observed_at AS "observedAt", received_at AS "receivedAt",
    speed_knots AS "speedKnots", latitude, longitude, ship_name AS "shipName",
    source_url AS "sourceUrl" FROM ais_positions WHERE zone_id = 'zone_a' AND id = $1`,
];

export function registerQuestionRoutes(server: FastifyInstance, db: Pool): void {
  server.get('/api/query/current-state', async (request, reply) => {
    const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const [restriction, ais] = await Promise.all([
      injectInternalRead(server, `/api/query/restriction?at=${at}`),
      injectInternalRead(server, '/api/current/ais'),
    ]);
    if (restriction.statusCode !== 200 || ais.statusCode !== 200) {
      request.log.error({ restrictionStatus: restriction.statusCode, aisStatus: ais.statusCode }, 'Current state read failed');
      return reply.code(503).send({ error: 'domain_data_unavailable' });
    }
    const notice = restriction.json();
    const vessel = ais.json();
    if (vessel.data.status !== 'recent_messages') vessel.data.positions = [];
    return { zoneId: 'zone_a', at, restriction: notice, ais: vessel,
      evidenceIds: [...notice.evidenceIds, ...vessel.data.positions.map((row: { id: string }) => row.id)],
      warning: 'Current AIS coverage may be unknown. A stored notice is not a navigation or compliance determination.' };
  });

  server.get<{ Querystring: { id: string } }>('/api/query/evidence', {
    schema: { querystring: { type: 'object', required: ['id'], additionalProperties: false,
      properties: { id: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9:_./-]+$' } } } },
  }, async (request, reply) => {
    try {
      for (const sql of evidenceQueries) {
        const result = await db.query(sql, [request.query.id]);
        if (result.rows[0]) return { zoneId: 'zone_a', record: result.rows[0], evidenceIds: [request.query.id] };
      }
      return reply.code(404).send({ error: 'evidence_not_found' });
    } catch (error) {
      request.log.error(error, 'Evidence lookup failed');
      return reply.code(503).send({ error: 'domain_data_unavailable' });
    }
  });
}
