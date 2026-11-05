import type pg from 'pg';
import { WHOI_MISSION_URL, WHOI_SOURCE, parseWhoiReview, parseWhoiReviewLinks } from './whoi.js';

export async function refreshWhoi(db: pg.Pool, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<{ reviews: number; detections: number }> {
  const attemptedAt = new Date();
  try {
    signal?.throwIfAborted();
    const missionResponse = await fetcher(WHOI_MISSION_URL, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
    if (!missionResponse.ok) throw new Error(`WHOI mission HTTP ${missionResponse.status}`);
    const links = parseWhoiReviewLinks(await missionResponse.text());
    // Recheck recent pages and the known 14 September story source, without scanning the whole mission.
    const selected = new Map(links.slice(0, 7).map((link) => [link.day, link]));
    const storyLink = links.find((link) => link.day === '2026-09-14');
    if (storyLink) selected.set(storyLink.day, storyLink);
    const reviews = [];
    for (const link of selected.values()) {
      const response = await fetcher(link.url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`WHOI review HTTP ${response.status} (${link.day})`);
      reviews.push(parseWhoiReview(await response.text(), link.day, link.url));
    }
    const fetchedAt = new Date();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const review of reviews) {
        await client.query(
          `INSERT INTO whoi_reviews (source, source_record_id, zone_id, review_date, detection_count, source_url, last_fetched_at)
           VALUES ($1, $2, 'zone_a', $3, $4, $5, $6)
           ON CONFLICT (source, source_record_id) DO UPDATE SET detection_count = EXCLUDED.detection_count,
             source_url = EXCLUDED.source_url, last_fetched_at = EXCLUDED.last_fetched_at`,
          [WHOI_SOURCE, review.sourceRecordId, review.reviewDate, review.detections.length, review.sourceUrl, fetchedAt],
        );
        for (const detection of review.detections) {
          await client.query(
            `INSERT INTO whoi_detections (id, source, source_record_id, zone_id, review_date,
              source_local_time, occurrence, platform_latitude, platform_longitude, source_url, raw_text, last_fetched_at)
             VALUES ($1, $2, $3, 'zone_a', $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (source, source_record_id) DO UPDATE SET occurrence = EXCLUDED.occurrence,
               platform_latitude = EXCLUDED.platform_latitude, platform_longitude = EXCLUDED.platform_longitude,
               source_url = EXCLUDED.source_url, raw_text = EXCLUDED.raw_text, last_fetched_at = EXCLUDED.last_fetched_at`,
            [detection.id, WHOI_SOURCE, detection.sourceRecordId, review.reviewDate,
             detection.sourceLocalTime, detection.occurrence, detection.platformLatitude,
             detection.platformLongitude, detection.sourceUrl, detection.rawText, fetchedAt],
          );
        }
        // A successful reread replaces this day's membership without changing surviving rows' first ingestion time.
        await client.query(
          `DELETE FROM whoi_detections
           WHERE source = $1 AND zone_id = 'zone_a' AND review_date = $2
             AND NOT (source_record_id = ANY($3::text[]))`,
          [WHOI_SOURCE, review.reviewDate, review.detections.map((detection) => detection.sourceRecordId)],
        );
      }
      await client.query(
        `INSERT INTO feed_status (source, last_attempt_at, last_success_at, last_error, last_attempt_status)
         VALUES ($1, $2, $3, NULL, 'success')
         ON CONFLICT (source) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at,
           last_success_at = EXCLUDED.last_success_at, last_error = NULL, last_attempt_status = 'success'`,
        [WHOI_SOURCE, attemptedAt, fetchedAt],
      );
      signal?.throwIfAborted();
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { reviews: reviews.length, detections: reviews.reduce((sum, review) => sum + review.detections.length, 0) };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Unknown WHOI feed error';
    await db.query(
      `INSERT INTO feed_status (source, last_attempt_at, last_error, last_attempt_status)
       VALUES ($1, $2, $3, 'error')
       ON CONFLICT (source) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at,
         last_error = EXCLUDED.last_error, last_attempt_status = 'error'`,
      [WHOI_SOURCE, attemptedAt, message],
    );
    throw error;
  }
}
