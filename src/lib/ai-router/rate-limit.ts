const WINDOW_MS = 60_000;

/**
 * Requests per person per minute, from DEVONE_AI_RATE_LIMIT (default 60, 0
 * turns the limit off). Shared free tiers run out fast; this keeps one busy
 * client from spending everyone's quota.
 */
export function aiRateLimit(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.DEVONE_AI_RATE_LIMIT?.trim() || 60);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 60;
}

/**
 * A sliding one-minute window kept in memory. DevOne runs as one server
 * process, so this is enough; a restart starts everyone afresh.
 */
export function createRateLimiter(limit: number) {
  const hits = new Map<string, number[]>();
  return {
    /** Records a request; false when the person already used up this minute. */
    take(key: string, now = Date.now()): boolean {
      if (limit === 0) return true;
      const recent = (hits.get(key) ?? []).filter((time) => now - time < WINDOW_MS);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    }
  };
}
