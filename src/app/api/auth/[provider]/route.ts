import { providerIsEnabled } from '@/features/auth/service';
import {
  buildAuthorizeUrl,
  getAppUrl,
  getOAuthConfig,
  OAUTH_STATE_COOKIE,
  oauthCallbackUrl
} from '@/lib/auth/oauth';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * Starts "Continue with GitHub/GitLab": remembers a random `state` in a short-lived
 * cookie and sends the browser to the provider's consent page.
 */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const back = (error: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url));

  if (provider !== 'github' && provider !== 'gitlab') return back('Unknown sign-in provider');
  const config = getOAuthConfig(provider);
  const appUrl = getAppUrl();
  if (!providerIsEnabled(provider) || !config || !appUrl) {
    return back(`Sign-in with ${provider === 'github' ? 'GitHub' : 'GitLab'} is not configured`);
  }

  const state = randomBytes(32).toString('base64url');
  const response = NextResponse.redirect(
    buildAuthorizeUrl(config, oauthCallbackUrl(appUrl, provider), state)
  );
  response.cookies.set(OAUTH_STATE_COOKIE, `${provider}.${state}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
    maxAge: 10 * 60
  });
  return response;
}
