import pg from 'pg';

export type RuntimeRole = 'api' | 'worker' | 'all';
export function runtimeRole(value = 'all'): RuntimeRole {
  if (value !== 'api' && value !== 'worker' && value !== 'all') throw new Error('ROLE must be api, worker or all.');
  return value;
}

// The lock belongs to this dedicated session, never the transaction-pooled API.
export function coordinationUrl(value: string | undefined, runtimeValue?: string): string {
  if (!value) throw new Error('Set COORDINATION_DATABASE_URL to a direct runtime connection before enabling collection.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid direct coordination database URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname.includes('-pooler.')) {
    throw new Error('COORDINATION_DATABASE_URL must use a direct PostgreSQL connection.');
  }
  if (runtimeValue) {
    let runtime: URL;
    try { runtime = new URL(runtimeValue); } catch { throw new Error('Invalid API database URL.'); }
    const host = (u: URL) => u.hostname.replace('-pooler.', '.');
    if (host(runtime) !== host(url) || runtime.pathname !== url.pathname || runtime.username !== url.username ||
        (runtime.port || '5432') !== (url.port || '5432') || runtime.searchParams.get('options') !== url.searchParams.get('options')) {
      throw new Error('Coordination and API connections must target the same database and runtime login.');
    }
  }
  return value;
}

export const OWNER_LOCK = [734921, 2] as const;

export function createCollectionOwner(options: {
  url: string;
  start: (signal: AbortSignal, failed: () => void, session: pg.Client) => Promise<() => Promise<void>>;
  onState: (state: 'owner' | 'standby' | 'disconnected') => void;
  intervalMs?: number;
}) {
  let client: pg.Client | null = null;
  let controller: AbortController | null = null;
  let stop: (() => Promise<void>) | null = null;
  let owned = false;
  let closed = false;
  let generation = 0;
  let pending: Promise<void> = Promise.resolve();
  let draining: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const interval = options.intervalMs ?? 2000;

  function lose() {
    if (closed || (!client && !controller)) return;
    generation++;
    owned = false;
    controller?.abort(); controller = null;
    const stopping = stop; stop = null;
    const disconnected = client; client = null;
    // Loss detection aborts upstream work synchronously. Drain locally before
    // retrying; other sessions can acquire once PostgreSQL releases this lock.
    draining = Promise.allSettled([stopping?.(), disconnected?.end()]).then(() => {});
    options.onState('disconnected');
  }

  async function check() {
    const currentGeneration = generation;
    await draining;
    if (closed || currentGeneration !== generation) return;
    try {
      if (!client) {
        const next = new pg.Client({ connectionString: options.url,
          connectionTimeoutMillis: 3000, query_timeout: 3000,
          keepAlive: true, keepAliveInitialDelayMillis: 1000,
          application_name: 'shared-waters-collection-owner' });
        client = next;
        next.on('error', () => { if (client === next) lose(); });
        next.on('end', () => { if (client === next) lose(); });
        await next.connect();
        await next.query("SET statement_timeout = '3000ms'");
      }
      const session = client;
      if (!session || closed || currentGeneration !== generation) return;
      if (!owned) {
        const result = await session.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', [...OWNER_LOCK]);
        if (closed || currentGeneration !== generation) return;
        if (!result.rows[0].acquired) { options.onState('standby'); return; }
        owned = true;
        const active = new AbortController(); controller = active;
        const shutdown = await options.start(active.signal, lose, session);
        if (closed || currentGeneration !== generation || active.signal.aborted) await shutdown();
        else { stop = shutdown; options.onState('owner'); }
      } else {
        const result = await session.query(`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()
            AND classid = $1::oid AND objid = $2::oid AND objsubid = 2 AND granted
        ) AS held`, [...OWNER_LOCK]);
        if (!result.rows[0].held) lose();
      }
    } catch { lose(); }
  }

  function schedule() {
    if (closed) return;
    timer = setTimeout(() => {
      pending = check().finally(schedule);
    }, interval);
  }
  pending = check().finally(schedule);
  return {
    get owned() { return owned; },
    async close() {
      if (closed) return;
      closed = true; generation++;
      clearTimeout(timer);
      controller?.abort(); controller = null;
      // Keep a healthy lock until all upstream work has drained on shutdown.
      try {
        await pending;
        await draining;
        const shutdown = stop; stop = null;
        await shutdown?.();
      } finally {
        const session = client; client = null; owned = false;
        await session?.end();
      }
    },
  };
}
