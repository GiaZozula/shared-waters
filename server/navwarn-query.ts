import type pg from 'pg';
import { NAVWARN_SOURCE } from './navwarn.js';
import type { NoticeRecord } from './domain-queries.js';

export type StoredNavwarnNotice = NoticeRecord & {
  rawText: string;
  firstIngestedAt: Date;
};

// Both current routes use this exact selection: prefer rows seen in the latest successful search.
export async function preferredCurrentNavwarnNotice(db: pg.Pool): Promise<StoredNavwarnNotice | null> {
  const result = await db.query<StoredNavwarnNotice>(`SELECT id, source_record_id AS "sourceRecordId",
    published_at AS "publishedAt", effective_at AS "effectiveAt", zone_a_state AS "zoneAState",
    applies_to AS "appliesTo", cancels, source_url AS "sourceUrl", raw_text AS "rawText",
    first_ingested_at AS "firstIngestedAt", last_fetched_at AS "lastFetchedAt"
    FROM navwarn_notices WHERE zone_id = 'zone_a'
    ORDER BY CASE WHEN last_fetched_at =
      (SELECT last_success_at FROM feed_status WHERE source = $1) THEN 0 ELSE 1 END,
      published_at DESC LIMIT 1`, [NAVWARN_SOURCE]);
  return result.rows[0] ?? null;
}
