type Schedule = (callback: () => void, delayMs: number) => () => void;

// One request at a time; hidden tabs and Story do not keep the API awake.
export function createLiveRefresh(options: {
  load: () => Promise<void>;
  active: () => boolean;
  schedule?: Schedule;
  intervalMs?: number;
}) {
  const schedule: Schedule = options.schedule ?? ((callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  });
  let cancel: (() => void) | undefined;
  let pending = false;
  let paused = false;

  async function refresh() {
    cancel?.();
    cancel = undefined;
    if (pending || paused || !options.active()) return;
    pending = true;
    try {
      await options.load();
    } catch (error) {
      console.warn('Live refresh unavailable', error);
    } finally {
      pending = false;
      if (!paused && options.active()) {
        cancel = schedule(() => { void refresh(); }, options.intervalMs ?? 15_000);
      }
    }
  }

  return {
    resume() { paused = false; void refresh(); },
    pause() { paused = true; cancel?.(); cancel = undefined; },
  };
}
