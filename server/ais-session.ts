// A free host collects during visits and releases the upstream connection afterward.
// Serialize shutdown/startup so a returning visitor cannot create two collectors.
export function createAisSession(options: {
  start: () => (reason?: string) => Promise<void>;
  onError: (error: unknown) => void;
  always?: boolean;
  idleMs?: number;
  maxActiveMs?: number;
  cooldownMs?: number;
}) {
  let stop: ((reason?: string) => Promise<void>) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let activeSince: number | null = null;
  let resumeAt = 0;
  let transition = Promise.resolve();
  let closed = false;
  const maxActiveMs = options.maxActiveMs ?? 15 * 60_000;
  const cooldownMs = options.cooldownMs ?? 5 * 60_000;

  function shutdown(reason: string, cooldown = false) {
    clearTimeout(timer); clearTimeout(deadline);
    const current = stop; stop = null; activeSince = null;
    if (cooldown) resumeAt = Date.now() + cooldownMs;
    if (current) transition = current(reason).catch(options.onError);
  }

  async function touch() {
    await transition;
    if (closed || Date.now() < resumeAt) return;
    clearTimeout(timer);
    if (!stop) {
      stop = options.start(); activeSince = Date.now();
      if (!options.always) {
        deadline = setTimeout(() => shutdown('Collection session limit; cooling down', true), maxActiveMs);
        deadline.unref();
      }
    }
    if (!options.always) {
      timer = setTimeout(() => {
        shutdown('No active readers');
      }, options.idleMs ?? 120_000);
      timer.unref();
    }
  }

  return {
    touch,
    snapshot: () => ({ mode: options.always ? 'always' : 'on-demand',
      state: closed ? 'closed' : stop ? 'active' : Date.now() < resumeAt ? 'cooldown' : 'idle',
      activeSince: activeSince === null ? null : new Date(activeSince).toISOString(),
      resumeAt: Date.now() < resumeAt ? new Date(resumeAt).toISOString() : null,
      idleSeconds: (options.idleMs ?? 120_000) / 1000, maxActiveSeconds: maxActiveMs / 1000 }),
    async close() {
      closed = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      await transition;
      const stopCurrent = stop;
      stop = null; activeSince = null;
      if (stopCurrent) await stopCurrent();
    },
  };
}
