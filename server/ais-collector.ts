import WebSocket from 'ws';
import type { Pool } from 'pg';
import { aisSubscription, classifyAisFrame } from './ais.js';
import { AisCapacityError, recordAisReceipt, setAisConnectionStatus, storeAisPosition, touchAisConnection } from './ais-store.js';

type Log = { info: (data: unknown, message: string) => void; warn: (data: unknown, message: string) => void;
  error: (data: unknown, message: string) => void };

export function startAisCollector(db: Pool, log: Log, apiKey: string | undefined,
  options: { url?: string; reconnectBaseMs?: number; maxPending?: number } = {}) {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let subscriptionTimer: NodeJS.Timeout | null = null;
  let attempt = 0;
  let pending = Promise.resolve();
  let queued = 0;
  let stopReason: string | null = null;

  function halt(reason: string) {
    stopped = true; stopReason = reason;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (subscriptionTimer) clearTimeout(subscriptionTimer);
    socket?.terminate();
    log.warn({ reason, queued }, 'AIS collection paused by resource limit');
    void pending.then(() => setAisConnectionStatus(db, 'disconnected', reason))
      .catch(error => log.error(error, 'AIS pause status failed'));
  }

  function enqueue(work: () => Promise<unknown>, message: string) {
    if (stopped) return;
    if (queued >= (options.maxPending ?? 32)) { halt('AIS persistence backlog limit reached'); return; }
    queued++;
    pending = pending.then(async () => { if (!stopped) await work(); })
      .catch((error: unknown) => {
        if (error instanceof AisCapacityError) halt('AIS storage capacity reached; operator review required');
        else log.error(error, message);
      }).finally(() => { queued--; });
  }

  const status = (state: 'connecting' | 'connected' | 'disconnected' | 'unconfigured', error: string | null = null) => {
    enqueue(() => setAisConnectionStatus(db, state, error), 'AIS status persistence failed');
  };

  function connect() {
    if (stopped || !apiKey) return;
    status('connecting');
    try {
      socket = new WebSocket(options.url ?? 'wss://stream.aisstream.io/v0/stream', { perMessageDeflate: true, maxPayload: 16_384 });
    } catch (error) {
      scheduleReconnect(error instanceof Error ? error.message : 'WebSocket setup failed');
      return;
    }
    const current = socket;
    let pongReceived = true;
    current.on('open', () => {
      current.send(JSON.stringify(aisSubscription(apiKey)));
      subscriptionTimer = setTimeout(() => {
        log.warn({}, 'AIS subscription confirmation timed out');
        current.terminate();
      }, 15_000);
      log.info({ box: aisSubscription('').BoundingBoxes }, 'AIS subscription sent');
      heartbeatTimer = setInterval(() => {
        if (current.readyState !== WebSocket.OPEN) return;
        if (!pongReceived) { current.terminate(); return; }
        pongReceived = false;
        current.ping();
      }, 30_000);
    });
    current.on('pong', () => {
      pongReceived = true;
      enqueue(() => touchAisConnection(db), 'AIS heartbeat persistence failed');
    });
    current.on('message', (bytes) => {
      if (stopped) return;
      let message: unknown;
      try { message = JSON.parse(bytes.toString()); }
      catch {
        log.warn({}, 'AIS frame was not JSON');
        enqueue(() => recordAisReceipt(db, { received: 1, unparsed: 1 }), 'AIS receipt persistence failed');
        return;
      }
      if (message && typeof message === 'object' && 'MessageType' in message &&
          message.MessageType === 'SubscriptionConfirmation') {
        if (subscriptionTimer) clearTimeout(subscriptionTimer);
        subscriptionTimer = null;
        attempt = 0;
        status('connected');
        log.info({}, 'AIS subscription confirmed');
        return;
      }
      if (message && typeof message === 'object' && ('error' in message || 'Error' in message)) {
        // Do not log the upstream payload: authentication errors can include secrets.
        log.warn({}, 'AIS subscription rejected');
        current.terminate();
        return;
      }
      const classified = classifyAisFrame(message, new Date());
      if (classified.kind === 'outside') {
        enqueue(() => recordAisReceipt(db, { received: 1, outside: 1 }), 'AIS receipt persistence failed');
        return;
      }
      if (classified.kind !== 'position') {
        enqueue(() => recordAisReceipt(db, { received: 1, unparsed: 1 }), 'AIS receipt persistence failed');
        return;
      }
      const position = classified.position;
      enqueue(async () => {
          const inserted = await storeAisPosition(db, position);
          await recordAisReceipt(db, { received: 1, stored: inserted ? 1 : 0 });
          if (inserted) log.info({ id: position.id, mmsi: position.mmsi }, 'AIS position stored');
        }, 'AIS position persistence failed');
    });
    current.on('error', (error) => log.warn({ error: error.message }, 'AIS WebSocket error'));
    current.on('close', (code) => {
      if (subscriptionTimer) clearTimeout(subscriptionTimer);
      subscriptionTimer = null;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      socket = null;
      if (!stopped) scheduleReconnect(`WebSocket closed (${code})`);
    });
  }

  function scheduleReconnect(error: string) {
    status('disconnected', error);
    const delay = Math.min(60_000, (options.reconnectBaseMs ?? 1000) * 2 ** Math.min(attempt++, 6));
    const jittered = Math.round(delay * (0.8 + Math.random() * 0.4));
    log.warn({ delayMs: jittered, error }, 'AIS reconnect scheduled');
    reconnectTimer = setTimeout(connect, jittered);
  }

  if (apiKey) connect();
  else status('unconfigured', 'AISSTREAM_API_KEY is not configured');

  return async (reason = 'Server stopped') => {
    const queuedAtStop = queued;
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (subscriptionTimer) clearTimeout(subscriptionTimer);
    socket?.terminate();
    await pending;
    await setAisConnectionStatus(db, 'disconnected', stopReason ?? reason);
    log.info({ reason: stopReason ?? reason, queuedAtStop }, 'AIS collector stopped');
  };
}
