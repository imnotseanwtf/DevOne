import { getPrisma } from '@/lib/db/prisma';
import {
  createSessionToken,
  getSessionExpiry,
  hashSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS
} from '@/lib/auth/session-token';
import type { User } from '@/generated/prisma/client';
import { readPreferences } from '@/features/account/preferences';
import { LOCALE_COOKIE } from '@/i18n/config';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

export async function createSession(userId: string): Promise<void> {
  const token = createSessionToken();
  const expiresAt = getSessionExpiry();

  const requestHeaders = await headers();
  // Only a proxy that overwrites X-Forwarded-For makes it trustworthy (see rate-limit.ts).
  const ipAddress =
    process.env.DEVONE_TRUST_PROXY === 'true'
      ? (requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null)
      : null;
  await getPrisma().session.create({
    data: {
      userId,
      expiresAt,
      tokenHash: hashSessionToken(token),
      userAgent: requestHeaders.get('user-agent')?.slice(0, 300) ?? null,
      ipAddress
    }
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
    maxAge: SESSION_MAX_AGE_SECONDS
  });

  // The language follows the person to a new browser.
  const user = await getPrisma().user.findUnique({
    where: { id: userId },
    select: { preferences: true }
  });
  const stored = (user?.preferences ?? {}) as Record<string, unknown>;
  if ('locale' in stored) setLocaleCookie(cookieStore, readPreferences(stored).locale);
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export function setLocaleCookie(cookieStore: CookieStore, locale: string): void {
  cookieStore.set(LOCALE_COOKIE, locale, {
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365
  });
}

/** The signed-in session's id, so My account can mark "this device". */
export async function getCurrentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await getPrisma().session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: { id: true }
  });
  return session?.id ?? null;
}

export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await getPrisma().session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true }
  });

  // Disabling a user deletes their sessions too; this covers a sign-in racing it.
  if (!session || session.expiresAt <= new Date() || session.user.disabledAt) {
    if (session) await getPrisma().session.deleteMany({ where: { id: session.id } });
    return null;
  }

  return session.user;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function deleteCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await getPrisma().session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}
