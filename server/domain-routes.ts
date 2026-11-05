import { calendarDate, STORY_FIRST_DATE, STORY_LAST_DATE } from '../shared/question-scope.js';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { NAVWARN_SOURCE } from './navwarn.js';
import { preferredCurrentNavwarnNotice } from './navwarn-query.js';
import { comparePresenceBands, getLatestDetection, getRestrictionAt, parseInstant,
  parsePresenceWindow, PRESENCE_START, type DetectionRecord, type NoticeRecord,
  type PresenceRecord } from './domain-queries.js';

type AtQuery = { at?: string };
type CompareQuery = { beforeStart?: string; beforeEnd?: string; afterStart?: string; afterEnd?: string };

export function registerDomainRoutes(server: FastifyInstance, db: pg.Pool): void {
  server.get<{ Querystring: AtQuery }>('/api/query/restriction', {
    schema: { querystring: { type: 'object', additionalProperties: false,
      required: ['at'], properties: { at: { type: 'string' } } } },
  }, async (request, reply) => {
    const at = parseInstant(request.query.at);
    if (!at || at < PRESENCE_START || Date.parse(at) > Date.now()) {
      return reply.code(400).send({ error: 'at_must_be_a_utc_instant_from_2026_09_13_through_now' });
    }
    try {
      const now = new Date();
      const current = now.getTime() - Date.parse(at) <= 5 * 60_000;
      const selectedNotice = current ? preferredCurrentNavwarnNotice(db) :
        db.query<NoticeRecord>(`SELECT id, source_record_id AS "sourceRecordId", published_at AS "publishedAt",
          effective_at AS "effectiveAt", zone_a_state AS "zoneAState", applies_to AS "appliesTo",
          cancels, source_url AS "sourceUrl", last_fetched_at AS "lastFetchedAt"
          FROM navwarn_notices WHERE zone_id = 'zone_a' AND published_at <= $1 AND effective_at <= $1
          ORDER BY effective_at DESC, published_at DESC LIMIT 1`, [at])
          .then((result) => result.rows[0] ?? null);
      const [notice, status] = await Promise.all([
        selectedNotice,
        db.query<{ last_attempt_status: 'success' | 'error'; last_success_at: Date | null }>(
          'SELECT last_attempt_status, last_success_at FROM feed_status WHERE source = $1', [NAVWARN_SOURCE]),
      ]);
      const feed = status.rows[0];
      return getRestrictionAt(at, notice ? [notice] : [],
        { status: feed?.last_attempt_status ?? 'never', lastSuccessAt: feed?.last_success_at ?? null }, now);
    } catch (error) {
      request.log.error(error, 'Restriction query failed');
      return reply.code(503).send({ error: 'domain_data_unavailable' });
    }
  });

  server.get<{ Querystring: { scope?: 'story'; throughDate?: string } }>('/api/query/latest-detection', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      scope: { type: 'string', enum: ['story'] }, throughDate: { type: 'string' },
    } } },
  }, async (request, reply) => {
    const { scope, throughDate } = request.query;
    if (throughDate !== undefined && (!scope || !calendarDate(throughDate) || throughDate < STORY_FIRST_DATE || throughDate > STORY_LAST_DATE)) {
      return reply.code(400).send({ error: 'invalid_detection_date' });
    }
    try {
      const endDate = throughDate ?? STORY_LAST_DATE;
      const result = await db.query<DetectionRecord>(`SELECT id, review_date::text AS "reviewDate",
        source_local_time AS "sourceLocalTime", occurrence,
        platform_latitude AS "platformLatitude", platform_longitude AS "platformLongitude",
        source_url AS "sourceUrl" FROM whoi_detections
        WHERE zone_id = 'zone_a' ${scope === 'story' ? 'AND review_date >= $1::date AND review_date <= $2::date' : ''}
        ORDER BY source_local_time DESC, id LIMIT 1`, scope === 'story' ? [STORY_FIRST_DATE, endDate] : []);
      return { ...getLatestDetection(result.rows), ...(scope ? {
        scope: 'story', reviewDateThrough: endDate,
        warning: 'Story review dates are bounded by calendar day. WHOI times are source-local with unresolved timezone; a row is not established as before the selected UTC instant. No indexed row does not prove whale absence.',
      } : {}) };
    } catch (error) {
      request.log.error(error, 'Latest detection query failed');
      return reply.code(503).send({ error: 'domain_data_unavailable' });
    }
  });

  server.get<{ Querystring: { date: string } }>('/api/query/detections', {
    schema: { querystring: { type: 'object', additionalProperties: false, required: ['date'],
      properties: { date: { type: 'string' } } } },
  }, async (request, reply) => {
    const date = calendarDate(request.query.date);
    if (!date || date < STORY_FIRST_DATE || date > new Date().toISOString().slice(0, 10)) {
      return reply.code(400).send({ error: 'invalid_detection_date' });
    }
    try {
      const result = await db.query<DetectionRecord>(`SELECT id, review_date::text AS "reviewDate",
        source_local_time AS "sourceLocalTime", occurrence,
        platform_latitude AS "platformLatitude", platform_longitude AS "platformLongitude",
        source_url AS "sourceUrl" FROM whoi_detections
        WHERE zone_id = 'zone_a' AND review_date = $1::date
        ORDER BY source_local_time, id LIMIT 101`, [date]);
      if (result.rows.length > 100) return reply.code(409).send({ error: 'detection_date_exceeds_reviewed_limit' });
      return { zoneId: 'zone_a', reviewDate: date, detections: result.rows,
        evidenceIds: result.rows.map(row => row.id),
        warning: 'WHOI review dates and times are source-local with unresolved timezone; they are not converted to UTC. Coordinates locate the glider, not whales. No indexed row does not establish whale absence or a reviewed zero-detection day.' };
    } catch (error) {
      request.log.error(error, 'Dated detection query failed');
      return reply.code(503).send({ error: 'domain_data_unavailable' });
    }
  });

  server.get<{ Querystring: CompareQuery }>('/api/query/presence-comparison', {
    schema: { querystring: { type: 'object', additionalProperties: false,
      required: ['beforeStart', 'beforeEnd', 'afterStart', 'afterEnd'],
      properties: { beforeStart: { type: 'string' }, beforeEnd: { type: 'string' },
        afterStart: { type: 'string' }, afterEnd: { type: 'string' } } } },
  }, async (request, reply) => {
    const before = parsePresenceWindow(request.query.beforeStart, request.query.beforeEnd);
    const after = parsePresenceWindow(request.query.afterStart, request.query.afterEnd);
    if (!before || !after || before.end > after.start) {
      return reply.code(400).send({ error: 'windows_must_be_ordered_nonoverlapping_whole_utc_hours_outside_2026_09_15_12_to_13_and_at_most_48_hours_each' });
    }
    try {
      const [first, second] = await Promise.all([before, after].map((window) =>
        db.query<PresenceRecord>(`SELECT id, event_at AS "eventAt", speed_band_group AS "speedBandGroup"
          FROM historical_presence WHERE source = 'global_fishing_watch' AND zone_id = 'zone_a'
          AND event_at >= $1 AND event_at < $2 ORDER BY event_at, id LIMIT 251`,
        [window.start, window.end])));
      if (first.rows.length > 250 || second.rows.length > 250) {
        return reply.code(409).send({ error: 'presence_window_exceeds_checked_snapshot_limit' });
      }
      return comparePresenceBands(first.rows, second.rows, before, after);
    } catch (error) {
      request.log.error(error, 'Presence comparison query failed');
      return reply.code(503).send({ error: 'domain_data_unavailable' });
    }
  });
}
