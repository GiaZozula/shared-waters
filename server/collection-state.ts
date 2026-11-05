import { AIS_DAILY_MS } from './ais-daily-budget.js';
import type pg from 'pg';

export const COLLECTION_IDLE_MS = 120_000;
export const COLLECTION_SESSION_MS = 15 * 60_000;
export const COLLECTION_COOLDOWN_MS = 5 * 60_000;

export async function touchCollectionDemand(db: Pick<pg.Pool, 'query'>) {
  // Coalesce demand writes across all APIs. One singleton row, no visitor IDs.
  await db.query(`UPDATE collection_control SET demand_until = clock_timestamp() + interval '120 seconds'
    WHERE id = 1 AND (demand_until IS NULL OR demand_until < clock_timestamp() + interval '118 seconds')`);
}

export async function readCollectionState(db: Pick<pg.Pool, 'query'>, always = false) {
  const { rows } = await db.query(`SELECT active_since AS "activeSince", resume_at AS "resumeAt",
    owner_heartbeat_at > clock_timestamp() - interval '8 seconds' AS "ownerRecent",
    resume_at > clock_timestamp() AS cooling FROM collection_control WHERE id = 1`);
  const state = rows[0];
  const budget = await db.query(`SELECT reserved_ms,
    budget_day = (clock_timestamp() AT TIME ZONE 'UTC')::date AS today,
    reserved_until > clock_timestamp() AS reserved FROM ais_daily_budget WHERE id = 1`);
  const daily = budget.rows[0];
  const exhausted = daily?.today && Number(daily.reserved_ms) >= AIS_DAILY_MS && !daily.reserved;
  return { mode: always ? 'always' : 'on-demand',
    state: exhausted ? 'daily-limit' : !state?.ownerRecent ? 'waiting-owner' : state.cooling ? 'cooldown' : state.activeSince ? 'active' : 'idle',
    activeSince: state?.activeSince ?? null, resumeAt: state?.cooling ? state.resumeAt : null,
    dailyLimitSeconds: AIS_DAILY_MS / 1000,
    idleSeconds: COLLECTION_IDLE_MS / 1000, maxActiveSeconds: COLLECTION_SESSION_MS / 1000 };
}
