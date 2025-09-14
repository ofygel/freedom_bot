const hits = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, intervalMs: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.reset < now) {
    hits.set(key, { count: 1, reset: now + intervalMs });
    return true;
  }
  if (entry.count < limit) {
    entry.count++;
    return true;
  }
  return false;
}
