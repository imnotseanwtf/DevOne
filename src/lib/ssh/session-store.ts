import { randomUUID } from 'node:crypto';
import type { OpenShell } from '@/lib/ssh/connection';

export type SshEvent = { type: 'data'; data: Buffer } | { type: 'exit'; reason: string };

export interface SshSession {
  id: string;
  userId: string;
  projectId: string;
  label: string;
  shell: OpenShell;
  /**
   * Recent output, replayed whenever a browser attaches: a reloaded page gets a
   * fresh terminal and should still show the screen it had.
   */
  history: Buffer[];
  historyBytes: number;
  listener: ((event: SshEvent) => void) | null;
  exitReason: string | null;
  lastUsedAt: number;
  /** Closes the session if no stream re-attaches in time. */
  detachTimer: NodeJS.Timeout | null;
}

export const MAX_SESSIONS_PER_USER = 5;
const IDLE_TIMEOUT_MS = 60 * 60_000;
/** A reload or flaky network gets this long to re-attach before the shell is closed. */
const DETACH_GRACE_MS = 30_000;
const HISTORY_LIMIT = 256 * 1024;
const SWEEP_INTERVAL_MS = 60_000;

// The live sockets are in this process; keep the map on globalThis so a dev
// hot-reload of this module does not orphan them (see the database session store).
const globalForSsh = globalThis as unknown as {
  sshSessions?: Map<string, SshSession>;
  sshSessionSweep?: NodeJS.Timeout;
};

const sessions = (globalForSsh.sshSessions ??= new Map<string, SshSession>());

if (!globalForSsh.sshSessionSweep) {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (now - session.lastUsedAt > IDLE_TIMEOUT_MS) closeSshSession(session.id, 'Idle timeout');
    }
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  globalForSsh.sshSessionSweep = timer;
}

function record(session: SshSession, data: Buffer) {
  session.history.push(data);
  session.historyBytes += data.length;
  // Drop the oldest output rather than grow without bound.
  while (session.historyBytes > HISTORY_LIMIT && session.history.length > 1) {
    session.historyBytes -= session.history.shift()!.length;
  }
}

export function countSshSessions(userId: string): number {
  let count = 0;
  for (const session of sessions.values()) if (session.userId === userId) count++;
  return count;
}

export function createSshSession(
  input: Pick<SshSession, 'userId' | 'projectId' | 'label' | 'shell'>
): SshSession {
  const session: SshSession = {
    ...input,
    id: randomUUID(),
    history: [],
    historyBytes: 0,
    listener: null,
    exitReason: null,
    lastUsedAt: Date.now(),
    detachTimer: null
  };
  sessions.set(session.id, session);

  const { channel, client } = input.shell;
  const onData = (data: Buffer) => {
    session.lastUsedAt = Date.now();
    record(session, data);
    session.listener?.({ type: 'data', data });
  };
  channel.on('data', onData);
  channel.stderr.on('data', onData);
  channel.on('close', () => closeSshSession(session.id, 'Connection closed'));
  client.on('close', () => closeSshSession(session.id, 'Connection closed'));
  client.on('error', (error) => closeSshSession(session.id, error.message));

  // Closed if the browser never attaches a stream.
  scheduleDetachClose(session);
  return session;
}

/** The caller's live session, or undefined: another user's id is as good as unknown. */
export function getSshSession(id: string, userId: string): SshSession | undefined {
  const session = sessions.get(id);
  return session?.userId === userId ? session : undefined;
}

function scheduleDetachClose(session: SshSession) {
  if (session.detachTimer) clearTimeout(session.detachTimer);
  session.detachTimer = setTimeout(
    () => closeSshSession(session.id, 'Browser disconnected'),
    DETACH_GRACE_MS
  );
  session.detachTimer.unref?.();
}

/**
 * Sends output to `listener` from now on, starting with the recent history.
 * Returns a detach function. A newer attach (another tab) replaces this one.
 */
export function attachSshSession(
  session: SshSession,
  listener: (event: SshEvent) => void
): () => void {
  if (session.detachTimer) clearTimeout(session.detachTimer);
  session.detachTimer = null;
  session.listener?.({ type: 'exit', reason: 'Opened in another tab' });

  session.listener = listener;
  if (session.history.length > 0) {
    listener({ type: 'data', data: Buffer.concat(session.history) });
  }
  if (session.exitReason) listener({ type: 'exit', reason: session.exitReason });

  return () => {
    if (session.listener !== listener) return;
    session.listener = null;
    if (sessions.has(session.id)) scheduleDetachClose(session);
  };
}

export function writeSshSession(session: SshSession, data: string): void {
  session.lastUsedAt = Date.now();
  session.shell.channel.write(data);
}

export function resizeSshSession(session: SshSession, cols: number, rows: number): void {
  // ssh2 takes (rows, cols, height, width).
  session.shell.channel.setWindow(rows, cols, 0, 0);
}

export function closeSshSession(id: string, reason: string): void {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  if (session.detachTimer) clearTimeout(session.detachTimer);
  session.exitReason = reason;
  session.listener?.({ type: 'exit', reason });
  session.listener = null;
  session.shell.channel.removeAllListeners('data');
  session.shell.client.end();
}
