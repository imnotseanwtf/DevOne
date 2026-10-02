/**
 * Public demo mode (DEVONE_DEMO_MODE=true): anyone can try DevOne with a
 * throwaway account and sample data, so nothing that reaches outside DevOne may
 * run. SSH, database connections, outgoing API requests and URL imports are
 * refused where the connection is made, and real sign-in is switched off so no
 * one enters real credentials. Run the demo as its own deployment with its own
 * database.
 */
export function isDemoMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.DEVONE_DEMO_MODE === 'true';
}

export const DEMO_DISABLED_MESSAGE =
  'This is turned off in the public demo. Self-host DevOne to use it.';

/** How long a demo account and its sample workspace live. */
export const DEMO_LIFETIME_MS = 24 * 60 * 60 * 1000;
