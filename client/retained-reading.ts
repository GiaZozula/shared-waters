// A failed browser read is not a successful empty provider result. Preserve the
// dated payload, but make the failure visible to adapters and presentation.
export function retainReading(previous: unknown, incoming: unknown): unknown {
  if (incoming !== null) return incoming;
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return null;
  return { ...previous, refreshUnavailable: true };
}
