import { STORY_START, STORY_END, STORY_FIRST_DATE, matchesReviewedStory } from '../shared/story-scope.js';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

// pg's default timestamptz parser rounds to JS milliseconds. Return UTC text
// here to retain native microseconds while keeping existing millisecond output.
function utcTimestamp(column: string): string {
  return `CASE WHEN date_trunc('milliseconds', ${column}) = ${column}
    THEN to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ELSE to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END`;
}

// Explicit browser field allowlist; never export raw payloads or ingestion state.
export async function readStoryReplay(db: Pick<pg.Pool, 'query'>) {
  const [presence, notices, detections] = await Promise.all([
    db.query(`SELECT id, ${utcTimestamp('event_at')} AS "eventAt", latitude, longitude, vessel_id AS "vesselId",
              speed_band_group AS "speedBandGroup", source_url AS "sourceUrl",
              COALESCE(NULLIF(BTRIM(raw_payload->'presence'->>'shipName'), ''),
                       NULLIF(BTRIM(raw_payload->'categoryQuery'->>'shipName'), '')) AS "shipName",
              COALESCE(NULLIF(BTRIM(raw_payload->'presence'->>'vesselType'), ''),
                       NULLIF(BTRIM(raw_payload->'categoryQuery'->>'vesselType'), '')) AS "vesselType"
              FROM historical_presence
              WHERE source = 'global_fishing_watch' AND zone_id = 'zone_a'
                AND event_at >= $1 AND event_at < $2
              ORDER BY event_at, id LIMIT 501`, [STORY_START, STORY_END]),
    db.query(`SELECT id, source_record_id AS "sourceRecordId", ${utcTimestamp('published_at')} AS "publishedAt",
              ${utcTimestamp('effective_at')} AS "effectiveAt", zone_a_state AS "zoneAState",
              applies_to AS "appliesTo", cancels, source_url AS "sourceUrl"
              FROM navwarn_notices WHERE zone_id = 'zone_a'
                AND effective_at >= $1 AND effective_at < $2
              ORDER BY effective_at, id LIMIT 101`, [STORY_START, STORY_END]),
    db.query(`SELECT id, review_date::text AS "reviewDate", source_local_time AS "sourceLocalTime",
              occurrence, platform_latitude AS "platformLatitude",
              platform_longitude AS "platformLongitude", source_url AS "sourceUrl"
              FROM whoi_detections WHERE zone_id = 'zone_a'
                AND review_date >= $1::date AND review_date < $2::date
              ORDER BY source_local_time, id LIMIT 101`, [STORY_FIRST_DATE, STORY_END.slice(0, 10)]),
  ]);
  if (presence.rows.length > 500 || notices.rows.length > 100 || detections.rows.length > 100) {
    throw new Error('story_snapshot_exceeds_reviewed_limit');
  }
  const reviewed = matchesReviewedStory({ start: STORY_START, end: STORY_END,
    presence: presence.rows, notices: notices.rows, detections: detections.rows });
  return {
    zoneId: 'zone_a', start: STORY_START, end: STORY_END,
    status: reviewed ? 'ready' : presence.rows.length === 0 ? 'not_imported' : 'incomplete',
    presence: presence.rows, notices: notices.rows, detections: detections.rows,
    note: 'GFW rows are delayed AIS-derived vessel-hours with speed categories, not tracks or exact speeds. NAVWARN events use UTC effective time. WHOI detection times are source-local and are not converted to UTC.',
  };
}

export function registerReplayRoute(server: FastifyInstance, db: pg.Pool): void {
  server.get('/api/story/replay', async (request, reply) => {
    try {
      return await readStoryReplay(db);
    } catch (error) {
      if (error instanceof Error && error.message === 'story_snapshot_exceeds_reviewed_limit') {
        return reply.code(409).send({ error: error.message });
      }
      request.log.error(error, 'Story replay query failed');
      return reply.code(503).send({ error: 'story_data_unavailable' });
    }
  });
}
