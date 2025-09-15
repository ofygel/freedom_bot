const hits = new Map<string, { count: number; reset: number }>();
const CLEANUP_INTERVAL_MS = 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits.entries()) {
    if (entry.reset < now) {
      hits.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref?.();

export function rateLimit(key: string, limit: number, intervalMs: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.reset < now) {
    if (entry && entry.reset < now) {
      hits.delete(key);
    }
    hits.set(key, { count: 1, reset: now + intervalMs });
    return true;
  }
  if (entry.count < limit) {
    entry.count++;
    return true;
  }
  return false;
}
