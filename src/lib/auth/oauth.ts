import { z } from 'zod';

export type OAuthProvider = 'github' | 'gitlab';

export interface OAuthConfig {
  provider: OAuthProvider;
  clientId: string;
  clientSecret: string;
  /** Where the provider's API lives: github.com, gitlab.com or a self-hosted GitLab. */
  baseUrl: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

export class OAuthExchangeError extends Error {
  constructor(message = 'The provider did not issue a token') {
    super(message);
    this.name = 'OAuthExchangeError';
  }
}

export const OAUTH_STATE_COOKIE = 'devone_oauth_state';

/** Reads the OAuth app for a provider from the environment; null when it is not configured. */
export function getOAuthConfig(
  provider: OAuthProvider,
  env: Record<string, string | undefined> = process.env
): OAuthConfig | null {
  if (provider === 'github') {
    const clientId = env.DEVONE_GITHUB_CLIENT_ID?.trim();
    const clientSecret = env.DEVONE_GITHUB_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return null;
    return {
      provider,
      clientId,
      clientSecret,
      baseUrl: 'https://github.com',
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      // Same access the personal access token needs: repos to edit, orgs for sign-in checks.
      scope: 'repo read:org read:user'
    };
  }

  const clientId = env.DEVONE_GITLAB_CLIENT_ID?.trim();
  const clientSecret = env.DEVONE_GITLAB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const baseUrl = (env.DEVONE_GITLAB_OAUTH_URL?.trim() || 'https://gitlab.com').replace(/\/+$/, '');
  return {
    provider,
    clientId,
    clientSecret,
    baseUrl,
    authorizeUrl: `${baseUrl}/oauth/authorize`,
    tokenUrl: `${baseUrl}/oauth/token`,
    scope: 'api read_user'
  };
}

/**
 * The public origin providers redirect back to. It comes from configuration, never
 * the request's Host header, so a spoofed host cannot redirect a code elsewhere.
 */
export function getAppUrl(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = env.DEVONE_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : null;
}

export function oauthCallbackUrl(appUrl: string, provider: OAuthProvider): string {
  return `${appUrl}/api/auth/${provider}/callback`;
}

export function buildAuthorizeUrl(config: OAuthConfig, redirectUri: string, state: string) {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', state);
  if (config.provider === 'gitlab') url.searchParams.set('response_type', 'code');
  else url.searchParams.set('allow_signup', 'false');
  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional()
});

export function parseTokenResponse(value: unknown, now = new Date()): OAuthTokens {
  const parsed = tokenResponseSchema.safeParse(value);
  if (!parsed.success) {
    // GitHub answers 200 with { error, error_description } for a bad or reused code.
    const described = z.object({ error_description: z.string() }).safeParse(value);
    throw new OAuthExchangeError(described.success ? described.data.error_description : undefined);
  }
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token ?? null,
    expiresAt: parsed.data.expires_in
      ? new Date(now.getTime() + parsed.data.expires_in * 1000)
      : null
  };
}

async function requestToken(
  config: OAuthConfig,
  params: Record<string, string>,
  fetcher: typeof fetch
): Promise<OAuthTokens> {
  const response = await fetcher(config.tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'DevOne'
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...params
    }),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000)
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok && !payload) throw new OAuthExchangeError();
  return parseTokenResponse(payload);
}

export function exchangeOAuthCode(
  config: OAuthConfig,
  code: string,
  redirectUri: string,
  fetcher: typeof fetch = fetch
) {
  return requestToken(
    config,
    { code, redirect_uri: redirectUri, grant_type: 'authorization_code' },
    fetcher
  );
}

export function refreshOAuthToken(
  config: OAuthConfig,
  refreshToken: string,
  redirectUri: string,
  fetcher: typeof fetch = fetch
) {
  return requestToken(
    config,
    { refresh_token: refreshToken, redirect_uri: redirectUri, grant_type: 'refresh_token' },
    fetcher
  );
}
