import type { DatabaseProvider } from '@/generated/prisma/client';
import type { DatabaseAdapter } from '@/lib/database/types';
import { randomUUID } from 'crypto';

export interface Session {
  adapter: DatabaseAdapter;
  userId: string;
  connectionId: string;
  /** Which database this session's adapter is actually connected to. */
  database: string;
  provider: DatabaseProvider;
  createdAt: number;
  lastUsedAt: number;
}

const IDLE_TIMEOUT_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

// This process holds the live connections, so the map (and its sweep timer)
// lives on globalThis: Next.js dev hot-reloads this module without restarting
// the process, and a fresh Map here would orphan already-open connections.
const globalForSessions = globalThis as unknown as {
  dbSessions?: Map<string, Session>;
  dbSessionSweep?: NodeJS.Timeout;
};

const sessions = (globalForSessions.dbSessions ??= new Map<string, Session>());

function sweep() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastUsedAt > IDLE_TIMEOUT_MS) {
      sessions.delete(id);
      void session.adapter.disconnect().catch(() => undefined);
    }
  }
}

if (!globalForSessions.dbSessionSweep) {
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  timer.unref?.();
  globalForSessions.dbSessionSweep = timer;
}

export function createSession(
  input: Pick<Session, 'adapter' | 'userId' | 'connectionId' | 'database' | 'provider'>
): string {
  const id = randomUUID();
  const now = Date.now();
  sessions.set(id, { ...input, createdAt: now, lastUsedAt: now });
  return id;
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function touchSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) session.lastUsedAt = Date.now();
}

export function removeSession(sessionId: string): void {
  sessions.delete(sessionId);
}
