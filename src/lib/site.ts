import { isDemoMode } from '@/lib/demo';

/**
 * Whether `/` shows the public landing page to signed-out visitors. It's for
 * DevOne's own website and demo; a self-hosted install goes straight to sign-in.
 */
export function showLandingPage(env: Record<string, string | undefined> = process.env): boolean {
  return env.DEVONE_LANDING_PAGE === 'true' || isDemoMode(env);
}
