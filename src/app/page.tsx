import { startPath } from '@/features/account/preferences';
import { getPreferences } from '@/features/account/service';
import { listProjectsForUser } from '@/features/projects/service';
import { getCurrentUser } from '@/lib/auth/session';
import { isDemoMode } from '@/lib/demo';
import { showLandingPage } from '@/lib/site';
import { redirect } from 'next/navigation';

/**
 * Signed-out visitors go to sign-in, or see the landing page where it's turned
 * on (DEVONE_LANDING_PAGE, or the public demo). Every sign-in lands here too,
 * then goes to the person's chosen start page. In the public demo, signed-in
 * visitors still get the landing page, with its buttons leading back to their
 * workspace.
 */
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) {
    if (!showLandingPage()) redirect('/login');
    // Loaded only when shown, so self-hosted installs never load the landing page.
    const { LandingPage } = await import('@/features/landing/components/landing-page');
    return <LandingPage />;
  }
  const [preferences, projects] = await Promise.all([
    getPreferences(user.id),
    listProjectsForUser(user.id)
  ]);
  const start = startPath(preferences, projects[0]?.id ?? null);
  if (isDemoMode()) {
    const { LandingPage } = await import('@/features/landing/components/landing-page');
    return <LandingPage workspaceHref={start} />;
  }
  redirect(start);
}
