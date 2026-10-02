import { providerIsEnabled, signInWithToken } from '@/features/auth/service';
import {
  exchangeOAuthCode,
  getAppUrl,
  getOAuthConfig,
  OAUTH_STATE_COOKIE,
  OAuthExchangeError,
  oauthCallbackUrl
} from '@/lib/auth/oauth';
import { cookies } from 'next/headers';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

function sameValue(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The provider sends the browser back here with a one-time `code`. After the
 * `state` matches the cookie set by the start route, the code becomes a token and
 * goes through the same sign-in as a pasted personal access token.
 */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(request.url);
  const back = (error: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url));

  const cookieStore = await cookies();
  const expected = cookieStore.get(OAUTH_STATE_COOKIE)?.value ?? '';
  cookieStore.delete({ name: OAUTH_STATE_COOKIE, path: '/api/auth' });

  if (provider !== 'github' && provider !== 'gitlab') return back('Unknown sign-in provider');
  const name = provider === 'github' ? 'GitHub' : 'GitLab';
  if (url.searchParams.get('error')) return back(`${name} sign-in was cancelled`);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  if (!code || !expected || !sameValue(expected, `${provider}.${state}`)) {
    return back('That sign-in link expired. Try again.');
  }

  const config = getOAuthConfig(provider);
  const appUrl = getAppUrl();
  if (!providerIsEnabled(provider) || !config || !appUrl) {
    return back(`Sign-in with ${name} is not configured`);
  }

  let tokens;
  try {
    tokens = await exchangeOAuthCode(config, code, oauthCallbackUrl(appUrl, provider));
  } catch (error) {
    return back(
      error instanceof OAuthExchangeError
        ? `${name} did not accept the sign-in: ${error.message}`
        : `Could not reach ${name}`
    );
  }

  const result = await signInWithToken({
    provider,
    token: tokens.accessToken,
    gitlabBaseUrl: provider === 'gitlab' ? config.baseUrl : undefined,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt
  });
  if (!result.ok) return back(result.error ?? `Could not sign in with ${name}`);
  return NextResponse.redirect(new URL('/', request.url));
}
