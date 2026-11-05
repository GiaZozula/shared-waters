import { reserveAisSession } from './ais-daily-budget.js';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { createFeedScheduler } from './feed-scheduler.js';
import { MARINE_SOURCE } from './marine.js';
import { WHOI_SOURCE } from './whoi.js';
import { NAVWARN_SOURCE } from './navwarn.js';
import { refreshMarine } from './marine-store.js';
import { refreshWhoi } from './whoi-store.js';
import { refreshNavwarn } from './navwarn-store.js';
import { startAisCollector } from './ais-collector.js';
import { COLLECTION_SESSION_MS, COLLECTION_COOLDOWN_MS } from './collection-state.js';

type Log = Parameters<typeof startAisCollector>[1];
type Feed = { source: string; intervalMs: number; refresh: (signal: AbortSignal) => Promise<unknown> };

// Called only after the dedicated session acquired the cooperative owner lock.
// Test injection changes adapters/timing, never the ownership/demand protocol.
export async function createCollectionRuntime(options: {
  db: pg.Pool; session: pg.Client; signal: AbortSignal; failed: () => void; log: Log;
  apiKey?: string; always?: boolean;
  feeds?: Feed[];
  startAis?: () => (reason?: string) => Promise<void>;
  pollMs?: number; maxActiveMs?: number; cooldownMs?: number;
}) {
  const { db, session, signal, log } = options;
  const owner = randomUUID();
  let closed = false;
  let budgetRetryAt = 0;
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  let stopping: Promise<void> | undefined;
  let stopAis: ((reason?: string) => Promise<void>) | null = null;
  const feeds: ReturnType<typeof createFeedScheduler>[] = [];
  const definitions = options.feeds ?? [
    { source: MARINE_SOURCE, intervalMs: 15 * 60_000, refresh: (s: AbortSignal) => refreshMarine(db, fetch, s) },
    { source: WHOI_SOURCE, intervalMs: 60 * 60_000, refresh: (s: AbortSignal) => refreshWhoi(db, fetch, s) },
    { source: NAVWARN_SOURCE, intervalMs: 30 * 60_000, refresh: (s: AbortSignal) => refreshNavwarn(db, fetch, s) },
  ];
  const stopSocket = async (reason: string) => {
    clearTimeout(budgetTimer);
    const shutdown = stopAis; stopAis = null;
    await shutdown?.(reason);
  };
  function close(): Promise<void> {
    if (stopping) return stopping;
    closed = true; clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    // Termination begins before waiting for feed/database work to drain.
    stopping = Promise.all([stopSocket('Collection ownership ended'), ...feeds.map(feed => feed.close())])
      .then(async () => { await pending; });
    return stopping;
  }
  function onAbort() { void close().catch(() => {}); }
  signal.addEventListener('abort', onAbort, { once: true });

  async function write(sql: string, values: unknown[] = []) {
    signal.throwIfAborted();
    const result = await session.query(sql, values);
    signal.throwIfAborted();
    if (result.rowCount !== 1) throw new Error('Collector no longer owns shared control state.');
    return result.rows[0];
  }
  async function check() {
    const row = await write(`UPDATE collection_control SET owner_heartbeat_at = clock_timestamp()
      WHERE id = 1 AND owner_id = $1 RETURNING demand_until AS demand, active_since AS active,
      resume_at AS resume, extract(epoch FROM clock_timestamp()) * 1000 AS now`, [owner]);
    const now = Number(row.now);
    const active = row.active ? new Date(row.active).getTime() : null;
    const cooling = row.resume && new Date(row.resume).getTime() > now;
    const wanted = options.always || (row.demand && new Date(row.demand).getTime() > now);
    if (!options.always && active !== null && now - active >= (options.maxActiveMs ?? COLLECTION_SESSION_MS)) {
      await stopSocket('Collection session limit; cooling down');
      await write(`UPDATE collection_control SET active_since = NULL,
        resume_at = clock_timestamp() + $2 * interval '1 millisecond' WHERE id = 1 AND owner_id = $1`,
      [owner, options.cooldownMs ?? COLLECTION_COOLDOWN_MS]);
    } else if (!wanted || cooling) {
      await stopSocket(!wanted ? 'No active readers' : 'Collection cooldown');
      if (active !== null) await write('UPDATE collection_control SET active_since = NULL WHERE id = 1 AND owner_id = $1', [owner]);
    } else if (!stopAis) {
      if (!options.apiKey && !options.startAis) return;
      if (Date.now() < budgetRetryAt) return;
      const deadline = await reserveAisSession(session);
      if (deadline === null) {
        budgetRetryAt = Math.floor(Date.now() / 86_400_000) * 86_400_000 + 86_400_000;
        return;
      }
      if (active === null) await write('UPDATE collection_control SET active_since = clock_timestamp() WHERE id = 1 AND owner_id = $1', [owner]);
      signal.throwIfAborted();
      stopAis = (options.startAis ?? (() => startAisCollector(db, log, options.apiKey)))();
      budgetTimer = setTimeout(() => {
        void stopSocket('Daily collection reservation ended').catch(() => { if (!closed) options.failed(); });
      }, Math.max(0, deadline - Date.now()));
    }
  }
  function schedule() {
    if (closed) return;
    timer = setTimeout(() => {
      pending = check().catch(() => { if (!closed) options.failed(); }).finally(schedule);
    }, options.pollMs ?? 1000);
  }
  try {
    // Claim through the lock-owning session: a terminated session cannot later
    // overwrite a successor's claim after a delayed pooled query resumes.
    await write(`UPDATE collection_control SET owner_id = $1, owner_heartbeat_at = clock_timestamp() WHERE id = 1`, [owner]);
    for (const definition of definitions) {
      signal.throwIfAborted();
      const feed = createFeedScheduler({ ...definition, db, refresh: () => definition.refresh(signal),
        onError: error => { if (!signal.aborted) log.error(error, `${definition.source} refresh failed`); } });
      feeds.push(feed); void feed.check();
    }
    await check();
    schedule();
    return close;
  } catch (error) { await close(); throw error; }
}
