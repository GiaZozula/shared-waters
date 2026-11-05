import type pg from 'pg';
const COLLECTION_SESSION_MS = 15 * 60_000;

// Six hours across all visitors per UTC day. Charge a whole bounded session
// before opening a socket, even when it ends early or a worker crashes.
export const AIS_DAILY_MS = 6 * 60 * 60_000;
export async function reserveAisSession(db: Pick<pg.Client, 'query'>): Promise<number | null> {
  const { rows } = await db.query(`WITH clock AS (
    SELECT clock_timestamp() AS now, (clock_timestamp() AT TIME ZONE 'UTC')::date AS day
  ), allowance AS (
    SELECT now, day, CASE WHEN budget_day = day THEN reserved_ms ELSE 0 END AS used
    FROM ais_daily_budget, clock WHERE id = 1 FOR UPDATE OF ais_daily_budget
  ) UPDATE ais_daily_budget SET budget_day = allowance.day,
    reserved_ms = allowance.used + $1::bigint,
    reserved_until = LEAST(allowance.now + $1 * interval '1 millisecond',
      (allowance.day + 1)::timestamp AT TIME ZONE 'UTC')
    FROM allowance WHERE id = 1 AND allowance.used + $1::bigint <= $2::bigint
    RETURNING extract(epoch FROM reserved_until) * 1000 AS deadline`, [COLLECTION_SESSION_MS, AIS_DAILY_MS]);
  return rows.length ? Number(rows[0].deadline) : null;
}
