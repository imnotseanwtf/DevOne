'use server';

import { deleteCurrentSession } from '@/lib/auth/session';
import { loginSchema, type LoginInput, type LoginResult } from '@/features/auth/schema';
import { providerIsEnabled, signInWithToken } from '@/features/auth/service';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { authRateLimitKey, clearAuthAttempts, consumeAuthAttempt } from '@/lib/auth/rate-limit';

export async function loginAction(input: LoginInput): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid login' };

  const { provider, token, gitlabBaseUrl } = parsed.data;
  if (!providerIsEnabled(provider)) return { ok: false, error: 'This provider is disabled' };

  const requestHeaders = await headers();
  const rateLimitKey = authRateLimitKey(provider, requestHeaders.get('x-forwarded-for'), token);
  if (!(await consumeAuthAttempt(rateLimitKey))) {
    return { ok: false, error: 'Too many sign-in attempts. Try again in 15 minutes.' };
  }

  const result = await signInWithToken({ provider, token, gitlabBaseUrl });
  if (result.ok) await clearAuthAttempts(rateLimitKey);
  return result;
}

export async function logoutAction(): Promise<never> {
  await deleteCurrentSession();
  redirect('/login');
}
