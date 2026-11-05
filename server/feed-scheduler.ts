import type { Pool } from 'pg';

type Status = { lastSuccessAt: Date | string | null; lastAttemptAt: Date | string | null; lastAttemptStatus: string };
type Schedule = (callback: () => void, delay: number) => () => void;

// Fetch freshness is independent of the dates of observations returned by a source.
export function nextFeedCheck(status: Status | undefined, interval: number, now: number): number {
  const time = (value: Date | string | null | undefined) => {
    const parsed = value == null ? NaN : new Date(value).getTime();
    return Number.isFinite(parsed) && parsed <= now ? parsed : -Infinity;
  };
  return Math.max(now, time(status?.lastSuccessAt) + interval,
    status?.lastAttemptStatus === 'error' ? time(status.lastAttemptAt) + interval : -Infinity);
}

export function createFeedScheduler(options: {
  db: Pick<Pool, 'query'>; source: string; intervalMs: number;
  refresh: () => Promise<unknown>; onError: (error: unknown) => void;
  now?: () => number; schedule?: Schedule;
}) {
  const now = options.now ?? Date.now;
  const schedule: Schedule = options.schedule ?? ((callback, delay) => {
    const timer = setTimeout(callback, delay);
    timer.unref();
    return () => clearTimeout(timer);
  });
  let pending: Promise<void> | undefined;
  let cancel: (() => void) | undefined;
  let closed = false;
  let notBefore = -Infinity;

  function check(): Promise<void> {
    if (closed) return Promise.resolve();
    if (pending) return pending;
    cancel?.(); cancel = undefined;
    pending = (async () => {
      let due = now() + options.intervalMs;
      try {
        const result = await options.db.query<Status>(
          `SELECT last_success_at AS "lastSuccessAt", last_attempt_at AS "lastAttemptAt",
                  last_attempt_status AS "lastAttemptStatus" FROM feed_status WHERE source = $1`, [options.source]);
        due = Math.max(notBefore, nextFeedCheck(result.rows[0], options.intervalMs, now()));
        if (due <= now() && !closed) {
          // A failed status read/write must not create a tight in-process retry loop.
          notBefore = now() + options.intervalMs;
          await options.refresh();
          notBefore = now() + options.intervalMs;
          due = notBefore;
        }
      } catch (error) {
        notBefore = now() + options.intervalMs;
        due = notBefore;
        options.onError(error);
      } finally {
        pending = undefined;
        if (!closed) cancel = schedule(() => { void check(); }, Math.max(1, due - now()));
      }
    })();
    return pending;
  }
  return { check, async close() { closed = true; cancel?.(); await pending; } };
}
