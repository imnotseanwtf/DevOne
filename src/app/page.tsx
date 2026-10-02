import { startPath } from '@/features/account/preferences';
import { getPreferences } from '@/features/account/service';
import { LandingPage } from '@/features/landing/components/landing-page';
import { listProjectsForUser } from '@/features/projects/service';
import { getCurrentUser } from '@/lib/auth/session';
import { redirect } from 'next/navigation';

/**
 * Signed-out visitors see the landing page. Every sign-in lands here too, then
 * goes to the person's chosen start page.
 */
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) return <LandingPage />;
  const [preferences, projects] = await Promise.all([
    getPreferences(user.id),
    listProjectsForUser(user.id)
  ]);
  redirect(startPath(preferences, projects[0]?.id ?? null));
}
