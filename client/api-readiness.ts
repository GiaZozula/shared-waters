import { apiFetch } from './api-fetch.js';

export type Readiness = { state: 'idle' | 'loading' | 'ready' | 'unavailable'; startedAt: number; elapsedSeconds: number; retryAfterSeconds: number };
const KEY = 'shared-waters-wake-start';

export function createApiReadiness(options: {
  fetcher?: typeof fetch; now?: () => number; timeoutMs?: number;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
} = {}) {
  const now = options.now ?? Date.now;
  let storage = options.storage;
  try { storage ??= sessionStorage; } catch { /* Storage is optional. */ }
  let startedAt = now();
  try {
    const saved = Number(storage?.getItem(KEY));
    if (saved > 0 && saved <= now() && now() - saved < 120_000) startedAt = saved;
  } catch { /* Blocked storage must not prevent browsing. */ }
  let state: Readiness['state'] = 'idle';
  let pending: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let lastFailureAt = -Infinity;
  const listeners = new Set<(value: Readiness) => void>();
  const snapshot = (): Readiness => ({ state, startedAt, elapsedSeconds: Math.max(0, Math.floor((now() - startedAt) / 1000)),
    retryAfterSeconds: Math.max(0, Math.ceil((5000 - (now() - lastFailureAt)) / 1000)) });
  const publish = () => { for (const listener of listeners) listener(snapshot()); };
  function start(): Promise<void> {
    if (pending) return pending;
    if (state === 'ready' || now() - lastFailureAt < 5000) return Promise.resolve();
    if (state === 'unavailable') startedAt = now();
    state = 'loading';
    try { storage?.setItem(KEY, String(startedAt)); } catch { /* Optional continuity only. */ }
    publish();
    controller = new AbortController();
    const signal = controller.signal;
    const timer = setTimeout(() => controller?.abort(), options.timeoutMs ?? 90_000);
    pending = (async () => {
      try {
        const response = await (options.fetcher ?? apiFetch)('/api/wake', { signal, cache: 'no-store' });
        const json = response.ok && response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
        if (signal.aborted || json?.service !== 'shared-waters' || json.api !== 'connected' || json.database !== 'connected') throw new Error('not ready');
        state = 'ready';
        try { storage?.removeItem(KEY); } catch { /* Optional continuity only. */ }
      } catch {
        state = 'unavailable'; lastFailureAt = now();
      } finally {
        clearTimeout(timer); pending = undefined; publish();
      }
    })();
    return pending;
  }
  return { start, snapshot,
    subscribe(listener: (value: Readiness) => void) { listeners.add(listener); listener(snapshot()); return () => { listeners.delete(listener); }; },
    close() { controller?.abort(); listeners.clear(); },
  };
}
export type ApiReadiness = ReturnType<typeof createApiReadiness>;
