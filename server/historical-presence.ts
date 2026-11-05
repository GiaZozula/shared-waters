import type pg from 'pg';

const publicFields = ['id', 'eventAt', 'latitude', 'longitude', 'vesselId', 'speedBandGroup', 'sourceUrl'] as const;

export async function readHistoricalPresence(db: Pick<pg.Pool, 'query'>, limit: number, offset: number) {
  const totalResult = await db.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM historical_presence WHERE source = 'global_fishing_watch' AND zone_id = 'zone_a'`);
  const total = Number(totalResult.rows[0].total);
  const result = await db.query(
    `SELECT id, event_at AS "eventAt", latitude, longitude, vessel_id AS "vesselId",
            speed_band_group AS "speedBandGroup", source_url AS "sourceUrl"
     FROM historical_presence
     WHERE source = 'global_fishing_watch' AND zone_id = 'zone_a'
     ORDER BY event_at, id LIMIT $1 OFFSET $2`, [limit, offset]);
  return {
    status: total === 0 ? 'not_imported' : 'ready', total, limit, offset,
    note: 'One AIS-derived vessel presence per vessel-hour. Speed fields are category sets, not exact speeds or compliance evidence.',
    records: result.rows.map(row => Object.fromEntries(publicFields.map(key => [key, row[key]]))),
  };
}
