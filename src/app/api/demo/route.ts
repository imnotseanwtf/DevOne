import { createDemoAccount, deleteExpiredDemoAccounts } from '@/features/demo/service';
import { consumeAuthAttempt } from '@/lib/auth/rate-limit';
import { createSession, deleteCurrentSession } from '@/lib/auth/session';
import { getPrisma } from '@/lib/db/prisma';
import { isDemoMode } from '@/lib/demo';
import { NextResponse } from 'next/server';

/** Most demo accounts that may be started in an hour, across everyone. */
const DEMO_STARTS_PER_HOUR = 300;

/**
 * "Try the demo": signs the visitor in to a fresh demo account with its own
 * sample project. Only exists when DEVONE_DEMO_MODE is on.
 */
export async function POST(request: Request) {
  if (!isDemoMode()) return new NextResponse('Not found', { status: 404 });

  const back = (error: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url), 303);

  // Only a proxy that overwrites X-Forwarded-For makes it trustworthy (see rate-limit.ts).
  const ip =
    process.env.DEVONE_TRUST_PROXY === 'true'
      ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      : undefined;
  if (ip && !(await consumeAuthAttempt(`demo:${ip}`))) {
    return back('Too many demos started from your network. Try again in 15 minutes.');
  }

  await deleteExpiredDemoAccounts();
  const startedLastHour = await getPrisma().user.count({
    where: { demoExpiresAt: { not: null }, createdAt: { gte: new Date(Date.now() - 3_600_000) } }
  });
  if (startedLastHour >= DEMO_STARTS_PER_HOUR) {
    return back('The demo is busy right now. Try again in a few minutes.');
  }

  const { userId, projectId } = await createDemoAccount();
  await deleteCurrentSession();
  await createSession(userId);
  return NextResponse.redirect(new URL(`/projects/${projectId}/issues`, request.url), 303);
}
