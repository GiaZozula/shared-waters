import { apiFetch } from './api-fetch.js'
import type { ApiReadiness } from './api-readiness.js'

type Mode = 'intro' | 'story' | 'live' | 'system'
export type AisPreviewState = {
  state: 'idle' | 'checking' | 'connected' | 'unknown' | 'unavailable' | 'paused'
  message: string
  data: unknown
}
const STORY_WINDOW_MS = 90_000

// One AIS reader for both the Story preview and Live. Existing server session,
// cooldown and storage caps apply to these ordinary current-data reads.
export function createAisPreview(options: {
  sitewide?: boolean; readiness: ApiReadiness; mode: Mode; fetcher?: typeof fetch; now?: () => number
  schedule?: (callback: () => void, ms: number) => () => void
}) {
  const now = options.now ?? Date.now
  const schedule = options.schedule ?? ((callback, ms) => {
    const timer = setTimeout(callback, ms)
    return () => clearTimeout(timer)
  })
  let storage: Storage | undefined;
  if (options.sitewide) { try { storage = sessionStorage } catch { /* Optional navigation continuity. */ } }
  let lastActivity = now();
  let sessionStarted = now();
  let sessionPaused = false;
  let dailyPaused = false;
  let dailyResumeAt = 0;
  try {
    const saved = JSON.parse(storage?.getItem('sw-live-session') ?? 'null');
    if (saved && Number.isFinite(saved.started) && saved.started <= now() && saved.started > 0) { sessionStarted = saved.started; sessionPaused = saved.paused === true }
  } catch { /* Ignore invalid/blocked storage. */ }
  const save = () => { try { storage?.setItem('sw-live-session', JSON.stringify({ started: sessionStarted, paused: sessionPaused })) } catch { /* Optional. */ } };
  save();
  let mode = options.mode
  let visible = false
  let closed = false
  let storyDeadline: number | undefined
  let cancel: (() => void) | undefined
  let controller: AbortController | undefined
  let pending = false
  let value: AisPreviewState = { state: 'idle', message: 'AIS starts when you enter Story or Live.', data: null }
  const listeners = new Set<(value: AisPreviewState) => void>()
  const publish = (next: AisPreviewState) => { value = next; listeners.forEach(listener => listener(value)) }
  const active = () => !closed && visible && (!options.sitewide ? mode !== 'intro' : !sessionPaused && (!dailyPaused || now() >= dailyResumeAt)) && options.readiness.snapshot().state === 'ready'
  function pause() {
    cancel?.(); cancel = undefined
    controller?.abort()
    if (options.sitewide) publish({ state: 'paused', message: sessionPaused ? 'Live updates paused. Resume to keep following these waters.' : 'Live updates paused while this page is hidden.', data: value.data })
    else if (mode === 'intro') publish({ state: 'idle', message: 'AIS starts when you enter Story or Live.', data: null })
    else publish({ state: 'paused', message: 'Background AIS check paused. Open Live to keep following it.', data: value.data })
  }
  async function refresh() {
    cancel?.(); cancel = undefined
    if (!active() || pending) return
    if (options.sitewide && (now() - lastActivity >= 10 * 60_000 || now() - sessionStarted >= 30 * 60_000)) { sessionPaused = true; save(); pause(); return }
    if (!options.sitewide && mode === 'story') {
      storyDeadline ??= now() + STORY_WINDOW_MS
      if (now() >= storyDeadline) { pause(); return }
    }
    pending = true
    controller = new AbortController()
    const request = controller
    const deadline = schedule(() => request.abort(), Math.min(12_000, !options.sitewide && mode === 'story' ? storyDeadline! - now() : 12_000))
    if (value.state !== 'connected') publish({ state: 'checking', message: 'Connecting to AIS…', data: value.data })
    try {
      const response = await (options.fetcher ?? apiFetch)('/api/current/ais', { signal: request.signal, cache: 'no-store' })
      if (!response.ok) throw new Error('AIS unavailable')
      const data = await response.json()
      if (typeof data?.connection?.status !== 'string' || !Array.isArray(data?.data?.positions)) throw new Error('Invalid AIS response')
      if (request.signal.aborted || !active()) return
      if (data.collection?.state === 'daily-limit') {
        dailyPaused = true;
        dailyResumeAt = (Math.floor(now() / 86_400_000) + 1) * 86_400_000;
        cancel = schedule(() => { dailyPaused = false; void refresh() }, Math.max(1000, (Math.floor(now() / 86_400_000) + 1) * 86_400_000 - now()));
        publish({ state: 'paused', message: 'Today’s live vessel collection allowance has been reached. Available again after 00:00 UTC.', data });
        return;
      }
      const connected = data.connection.status === 'connected' && data.collection?.state !== 'cooldown'
      const count = data.data.positions.length
      const message = data.collection?.state === 'cooldown' ? 'Vessel collection is cooling down. Recent records remain available.' : connected
        ? count ? `AIS connected · ${count} vessel${count === 1 ? '' : 's'} in recent records.` : 'AIS connected · waiting for positions in Zone A.'
        : data.connection.status === 'connecting' ? 'Connecting to AIS…'
        : data.connection.status === 'unconfigured' ? 'AIS is not configured.'
        : data.connection.status === 'unverified' ? 'AIS connection needs a fresh check.'
        : 'AIS disconnected · waiting to reconnect.'
      const publicMessage = options.sitewide && connected
        ? count ? 'Vessel feed connected. Recent positions are available.' : 'Vessel feed connected. Waiting for positions in Zone A.'
        : message;
      publish({ state: connected ? 'connected' : 'unknown', message: publicMessage, data })
    } catch {
      if (active() && !request.signal.aborted) publish({ state: 'unavailable', message: 'AIS could not be checked. Vessel coverage is unknown.', data: null })
      else if (active()) publish({ state: 'unavailable', message: 'AIS check timed out. Vessel coverage is unknown.', data: null })
    } finally {
      deadline(); pending = false
      if (active()) cancel = schedule(() => { void refresh() }, !options.sitewide && mode === 'story' ? Math.max(0, Math.min(15_000, storyDeadline! - now())) : 15_000)
    }
  }
  const unsubscribe = options.readiness.subscribe(() => { if (active()) void refresh(); else pause() })
  return {
    snapshot: () => value,
    subscribe(listener: (value: AisPreviewState) => void) { listeners.add(listener); listener(value); return () => { listeners.delete(listener) } },
    activity() { if (!sessionPaused) lastActivity = now() },
    isFollowing: () => active(),
    setMode(next: Mode) { mode = next; if (next === 'story') storyDeadline = undefined; if (active()) void refresh(); else pause() },
    setVisible(next: boolean) { visible = next; if (active()) void refresh(); else pause() },
    retry() { if ((dailyPaused && now() < dailyResumeAt) || pending) return; dailyPaused = false; sessionPaused = false; sessionStarted = lastActivity = now(); save(); if (!active()) return; storyDeadline = undefined; void refresh() },
    close() { closed = true; pause(); unsubscribe(); listeners.clear() },
  }
}
export type AisPreview = ReturnType<typeof createAisPreview>
