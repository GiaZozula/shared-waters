import type { Pool } from 'pg';
import type { AisPosition } from './ais.js';
import { AIS_SOURCE } from './ais.js';

export class AisCapacityError extends Error { constructor() { super('AIS storage capacity reached'); } }

export async function storeAisPosition(db: Pool, position: AisPosition, maxRows = 10_000): Promise<boolean> {
  const client = await db.connect();
  let failed: Error | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '1000ms'");
    await client.query('SELECT pg_advisory_xact_lock(21335, 1)');
    const duplicate = await client.query('SELECT 1 FROM ais_positions WHERE source = $1 AND source_record_id = $2',
      [AIS_SOURCE, position.sourceRecordId]);
    if (duplicate.rowCount) { await client.query('COMMIT'); return false; }
    const count = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM ais_positions');
    if (count.rows[0].count >= maxRows) throw new AisCapacityError();
    const result = await client.query(
      `INSERT INTO ais_positions
         (id, source, source_record_id, zone_id, mmsi, observed_at, received_at,
          latitude, longitude, speed_knots, ship_name, source_url, raw_payload)
       VALUES ($1, $2, $3, 'zone_a', $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (source, source_record_id) DO NOTHING`,
      [position.id, AIS_SOURCE, position.sourceRecordId, position.mmsi, position.observedAt,
        position.receivedAt, position.latitude, position.longitude, position.speedKnots,
        position.shipName, position.sourceUrl, JSON.stringify(position.rawPayload)],
    );
    await client.query(
      `UPDATE ais_connection_status SET last_message_at = GREATEST(COALESCE(last_message_at, $1), $1), checked_at = now()
       WHERE source = $2`, [position.receivedAt, AIS_SOURCE],
    );
    await client.query('COMMIT');
    return result.rowCount === 1;
  } catch (error) {
    failed = error instanceof Error ? error : new Error('AIS write failed');
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(failed); }
}

export async function setAisConnectionStatus(
  db: Pool, state: 'connecting' | 'connected' | 'disconnected' | 'unconfigured', error: string | null = null,
): Promise<void> {
  await db.query(
    `INSERT INTO ais_connection_status (source, state, checked_at, connected_at, last_error)
     VALUES ($1, $2, now(), CASE WHEN $2 = 'connected' THEN now() ELSE NULL END, $3)
     ON CONFLICT (source) DO UPDATE SET state = EXCLUDED.state, checked_at = EXCLUDED.checked_at,
       connected_at = CASE WHEN EXCLUDED.state = 'connected' THEN now() ELSE ais_connection_status.connected_at END,
       last_error = EXCLUDED.last_error`,
    [AIS_SOURCE, state, error],
  );
}

export async function recordAisReceipt(
  db: Pool, counts: { received?: number; unparsed?: number; outside?: number; stored?: number },
): Promise<void> {
  await db.query(
    `UPDATE ais_connection_status SET
       frames_received = frames_received + $1,
       frames_unparsed = frames_unparsed + $2,
       frames_outside = frames_outside + $3,
       frames_stored = frames_stored + $4
     WHERE source = $5`,
    [counts.received ?? 0, counts.unparsed ?? 0, counts.outside ?? 0, counts.stored ?? 0, AIS_SOURCE],
  );
}

export async function touchAisConnection(db: Pool): Promise<void> {
  await db.query(`UPDATE ais_connection_status SET checked_at = now() WHERE source = $1 AND state = 'connected'`,
    [AIS_SOURCE]);
}
