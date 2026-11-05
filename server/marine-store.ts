import type pg from 'pg';
import { MARINE_SOURCE, MARINE_URL, parseMarineCurrent } from './marine.js';

import { WEATHER_URL, parseWeatherCurrent } from './weather.js';

type Database = pg.Pool;
type Fetcher = typeof fetch;

export async function refreshMarine(db: Database, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<void> {
  const attemptedAt = new Date();
  try {
    signal?.throwIfAborted();
    const response = await fetcher(MARINE_URL, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Marine HTTP ${response.status}`);
    const observation = parseMarineCurrent(await response.json() as unknown);
    // Optional weather enrichment shares the bounded collector refresh. Marine reads survive failure.
    try {
      const weatherResponse = await fetcher(WEATHER_URL, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
      if (!weatherResponse.ok) throw new Error('Weather unavailable');
      observation.rawPayload = { ...observation.rawPayload, liveWeather: parseWeatherCurrent(await weatherResponse.json()) };
    } catch (error) {
      if (signal?.aborted) throw error;
      observation.rawPayload = { ...observation.rawPayload, liveWeather: null, weatherRefreshUnavailable: true };
    }
    const fetchedAt = new Date();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO marine_observations
         (id, source, source_record_id, zone_id, valid_at, grid_latitude, grid_longitude,
          wave_height_m, sea_surface_temperature_c, ocean_current_velocity_kmh,
          source_url, raw_payload, last_fetched_at)
         VALUES ($1, $2, $3, 'zone_a', $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (source, source_record_id) DO UPDATE SET
           grid_latitude = EXCLUDED.grid_latitude, grid_longitude = EXCLUDED.grid_longitude,
           wave_height_m = EXCLUDED.wave_height_m,
           sea_surface_temperature_c = EXCLUDED.sea_surface_temperature_c,
           ocean_current_velocity_kmh = EXCLUDED.ocean_current_velocity_kmh,
           raw_payload = CASE WHEN EXCLUDED.raw_payload->>'weatherRefreshUnavailable' = 'true'
             THEN EXCLUDED.raw_payload || jsonb_build_object('liveWeather',
               CASE WHEN marine_observations.raw_payload->'liveWeather' <> 'null'::jsonb
               THEN marine_observations.raw_payload->'liveWeather' || '{"refreshUnavailable":true}'::jsonb
               ELSE 'null'::jsonb END)
             ELSE EXCLUDED.raw_payload END, last_fetched_at = EXCLUDED.last_fetched_at`,
        [observation.id, MARINE_SOURCE, observation.sourceRecordId, observation.validAt,
         observation.gridLatitude, observation.gridLongitude, observation.waveHeightM,
         observation.seaSurfaceTemperatureC, observation.oceanCurrentVelocityKmh,
         MARINE_URL.toString(), observation.rawPayload, fetchedAt],
      );
      await client.query(
        `INSERT INTO feed_status (source, last_attempt_at, last_success_at, last_error, last_attempt_status)
         VALUES ($1, $2, $3, NULL, 'success')
         ON CONFLICT (source) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at,
           last_success_at = EXCLUDED.last_success_at, last_error = NULL, last_attempt_status = 'success'`,
        [MARINE_SOURCE, attemptedAt, fetchedAt],
      );
      signal?.throwIfAborted();
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Unknown marine feed error';
    await db.query(
      `INSERT INTO feed_status (source, last_attempt_at, last_error, last_attempt_status)
       VALUES ($1, $2, $3, 'error')
       ON CONFLICT (source) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at,
         last_error = EXCLUDED.last_error, last_attempt_status = 'error'`,
      [MARINE_SOURCE, attemptedAt, message],
    );
    throw error;
  }
}
