import type { User } from '@/generated/prisma/client';

/**
 * Remembers who a session cookie belongs to for a few seconds, for the terminal's
 * keystroke endpoint: it runs on every key press, and a database lookup each time
 * is most of what makes typing feel slow when the database is not next door.
 * Signing out forgets the entry at once; anything else (a disabled user) is
 * noticed within TTL_MS.
 */
const TTL_MS = 15_000;
const MAX_ENTRIES = 500;

const globalForCache = globalThis as unknown as {
  sessionUserCache?: Map<string, { user: User; until: number }>;
};
const cache = (globalForCache.sessionUserCache ??= new Map());

export function recallSessionUser(tokenHash: string, now = Date.now()): User | null {
  const hit = cache.get(tokenHash);
  if (!hit) return null;
  if (hit.until <= now) {
    cache.delete(tokenHash);
    return null;
  }
  return hit.user;
}

export function rememberSessionUser(tokenHash: string, user: User, now = Date.now()): void {
  if (cache.size >= MAX_ENTRIES) {
    for (const [key, entry] of cache) if (entry.until <= now) cache.delete(key);
    // Still full of live entries: drop the oldest.
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  }
  cache.set(tokenHash, { user, until: now + TTL_MS });
}

export function forgetSessionUser(tokenHash: string): void {
  cache.delete(tokenHash);
}
