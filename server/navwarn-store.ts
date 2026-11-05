import type pg from 'pg';
import { NAVWARN_SEARCH_URL, NAVWARN_SOURCE, parseNavwarnSearch } from './navwarn.js';

export async function refreshNavwarn(db: pg.Pool, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<{ notices: number }> {
  const attemptedAt = new Date();
  try {
    signal?.throwIfAborted();
    const response = await fetcher(NAVWARN_SEARCH_URL, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`NAVWARN HTTP ${response.status}`);
    const notices = parseNavwarnSearch(await response.text());
    const fetchedAt = new Date();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const notice of notices) {
        await client.query(
          `INSERT INTO navwarn_notices (id, source, source_record_id, zone_id, published_at, effective_at,
            zone_a_state, applies_to, cancels, source_url, raw_text, last_fetched_at)
           VALUES ($1, $2, $3, 'zone_a', $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (source, source_record_id) DO UPDATE SET published_at = EXCLUDED.published_at,
             effective_at = EXCLUDED.effective_at, zone_a_state = EXCLUDED.zone_a_state,
             applies_to = EXCLUDED.applies_to, cancels = EXCLUDED.cancels,
             source_url = EXCLUDED.source_url, raw_text = EXCLUDED.raw_text, last_fetched_at = EXCLUDED.last_fetched_at`,
          [notice.id, NAVWARN_SOURCE, notice.sourceRecordId, notice.publishedAt, notice.effectiveAt,
           notice.zoneAState, notice.appliesTo, notice.cancels, notice.sourceUrl, notice.rawText, fetchedAt],
        );
      }
      await client.query(
        `INSERT INTO feed_status (source, last_attempt_at, last_success_at, last_error, last_attempt_status)
         VALUES ($1, $2, $3, NULL, 'success')
         ON CONFLICT (source) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at,
           last_success_at = EXCLUDED.last_success_at, last_error = NULL, last_attempt_status = 'success'`,
        [NAVWARN_SOURCE, attemptedAt, fetchedAt],
      );
      signal?.throwIfAborted();
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { notices: notices.length };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Unknown NAVWARN feed error';
    await db.query(
      `INSERT INTO feed_status (source, last_attempt_at, last_error, last_attempt_status)
       VALUES ($1, $2, $3, 'error')
       ON CONFLICT (source) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at,
         last_error = EXCLUDED.last_error, last_attempt_status = 'error'`,
      [NAVWARN_SOURCE, attemptedAt, message],
    );
    throw error;
  }
}
