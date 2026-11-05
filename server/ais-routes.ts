import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { AIS_SOURCE, AIS_SOURCE_URL } from './ais.js';

const RECENT_MS = 30 * 60_000;

export function registerAisRoute(server: FastifyInstance, db: Pool, onRead?: () => Promise<void>, collectionState?: () => unknown) {
  server.get('/api/current/ais', async (request, reply) => {
    try {
      await onRead?.();
      reply.header('Cache-Control', 'no-store');
      const [stateResult, latestResult, recentResult] = await Promise.all([
        db.query(`SELECT state, checked_at AS "checkedAt", connected_at AS "connectedAt",
                         last_message_at AS "lastMessageAt", last_error AS "lastError",
                         frames_received AS "framesReceived", frames_unparsed AS "framesUnparsed",
                         frames_outside AS "framesOutside", frames_stored AS "framesStored"
                  FROM ais_connection_status WHERE source = $1`, [AIS_SOURCE]),
        db.query(`SELECT observed_at AS "observedAt", received_at AS "receivedAt"
                  FROM ais_positions WHERE zone_id = 'zone_a' ORDER BY received_at DESC LIMIT 1`),
        db.query(`SELECT id, mmsi, observed_at AS "observedAt", received_at AS "receivedAt",
                         latitude, longitude, speed_knots AS "speedKnots", ship_name AS "shipName",
                         source_url AS "sourceUrl"
                  FROM (SELECT DISTINCT ON (mmsi) * FROM ais_positions
                        WHERE zone_id = 'zone_a' AND received_at >= $1
                          AND observed_at >= $1 AND observed_at <= $2
                        ORDER BY mmsi, received_at DESC) latest
                  ORDER BY received_at DESC LIMIT 100`, [new Date(Date.now() - RECENT_MS), new Date()]),
      ]);
      const connection = stateResult.rows[0] ?? null;
      const lastStored = latestResult.rows[0] ?? null;
      const checkedAt = connection ? new Date(connection.checkedAt).getTime() : NaN;
      const connected = connection?.state === 'connected' && Date.now() - checkedAt <= 90_000;
      return {
        source: AIS_SOURCE, sourceUrl: AIS_SOURCE_URL, zoneId: 'zone_a',
        collection: await collectionState?.() ?? null,
        connection: connection ? { ...connection, status: connected ? 'connected' : connection.state === 'connected' ? 'unverified' : connection.state } :
          { status: 'unconfigured', checkedAt: null, connectedAt: null, lastMessageAt: null, lastError: null,
            framesReceived: 0, framesUnparsed: 0, framesOutside: 0, framesStored: 0 },
        data: {
          status: recentResult.rows.length && connected ? 'recent_messages' : 'unknown',
          recentWindowMinutes: 30,
          lastStored,
          positions: connected ? recentResult.rows : [],
        },
        note: 'AIS positions observed and received within the last 30 minutes, excluding future observations, newest per MMSI, capped at 100. An empty recent list stays unknown coverage, not zero ships. Connection frame counts separate frames seen, frames that failed parsing, frames outside Zone A, and frames stored. Reported speeds are not compliance findings.',
      };
    } catch (error) {
      request.log.error(error, 'AIS state query failed');
      return reply.code(503).send({ error: 'ais_data_unavailable' });
    }
  });
}
