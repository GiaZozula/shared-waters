// Dynamic imports cannot be cancelled, but a late result must not keep the
// visitor on an indefinite loading screen. Callers decide whether to use it.
export async function loadSceneWithDeadline<T>(load: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([load(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('scene_load_timeout')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
