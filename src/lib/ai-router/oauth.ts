import { createHash, randomBytes } from 'node:crypto';
import type { ProviderOAuthConfig } from './types';

export interface ProviderTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: Date | null;
}

export interface OAuthProvider {
  flowType: 'authorization_code_pkce';
  buildAuthUrl(redirectUri: string, state: string, challenge: string): string;
  exchangeToken(
    code: string,
    redirectUri: string,
    verifier: string,
    state?: string
  ): Promise<ProviderTokens>;
  mapTokens(value: unknown): ProviderTokens;
  postExchange?(tokens: ProviderTokens): Promise<ProviderTokens>;
}

export function generatePkce(): { state: string; codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  return {
    state: randomBytes(32).toString('base64url'),
    codeVerifier,
    codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url')
  };
}

function oauthUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid OAuth endpoint');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('OAuth endpoints must use HTTPS without credentials or fragments');
  return url;
}

export function buildProviderAuthorizeUrl(
  config: ProviderOAuthConfig,
  redirectUri: string,
  state: string,
  challenge: string
): string {
  const url = oauthUrl(config.authorizeUrl);
  for (const [key, value] of Object.entries(config.authorizeParams ?? {}))
    url.searchParams.set(key, value);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (config.scope) url.searchParams.set('scope', config.scope);
  return url.toString();
}

/** Only known token fields are persisted; upstream errors never enter error messages. */
export function parseProviderTokens(value: unknown, now: number = Date.now()): ProviderTokens {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid OAuth token response');
  const record = value as Record<string, unknown>;
  const accessToken = record.access_token;
  if (typeof accessToken !== 'string' || !accessToken.trim())
    throw new Error('OAuth response did not include an access token');
  const result: ProviderTokens = { accessToken, expiresAt: null };
  for (const [source, target] of [
    ['refresh_token', 'refreshToken'],
    ['id_token', 'idToken']
  ] as const) {
    const token = record[source];
    if (token === undefined || token === null) continue;
    if (typeof token !== 'string' || !token.trim()) throw new Error('Invalid OAuth token response');
    result[target] = token;
  }
  if (record.expires_in !== undefined) {
    const seconds =
      typeof record.expires_in === 'number' ||
      (typeof record.expires_in === 'string' && record.expires_in.trim())
        ? Number(record.expires_in)
        : NaN;
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid OAuth token expiry');
    result.expiresAt = new Date(now + seconds * 1000);
  } else if (record.expires_at !== undefined) {
    const expiry = record.expires_at;
    const numeric =
      typeof expiry === 'number' || (typeof expiry === 'string' && /^\d+(\.\d+)?$/.test(expiry));
    result.expiresAt = new Date(
      numeric ? Number(expiry) * 1000 : typeof expiry === 'string' ? expiry : NaN
    );
  }
  if (result.expiresAt && !Number.isFinite(result.expiresAt.getTime()))
    throw new Error('Invalid OAuth token expiry');
  return result;
}

async function requestTokens(
  config: ProviderOAuthConfig,
  fields: Record<string, string>,
  fetchImpl: typeof fetch
): Promise<unknown> {
  const endpoint = oauthUrl(config.tokenUrl);
  const payload = {
    ...fields,
    client_id: config.clientId,
    ...(config.clientSecret ? { client_secret: config.clientSecret } : {})
  };
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type':
          config.encoding === 'json' ? 'application/json' : 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body:
        config.encoding === 'json'
          ? JSON.stringify(payload)
          : new URLSearchParams(payload).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error('OAuth token request failed');
    return await response.json();
  } catch {
    throw new Error('OAuth token request failed');
  }
}

export function exchangeProviderCode(
  config: ProviderOAuthConfig,
  code: string,
  redirectUri: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
  state?: string
): Promise<ProviderTokens> {
  return createOAuthProvider(config, fetchImpl).exchangeToken(code, redirectUri, verifier, state);
}

export async function refreshProviderToken(
  config: ProviderOAuthConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderTokens> {
  return parseProviderTokens(
    await requestTokens(
      config,
      { grant_type: 'refresh_token', refresh_token: refreshToken },
      fetchImpl
    )
  );
}

export function createOAuthProvider(
  config: ProviderOAuthConfig,
  fetchImpl: typeof fetch = fetch,
  postExchange?: OAuthProvider['postExchange']
): OAuthProvider {
  const adapter: OAuthProvider = {
    flowType: 'authorization_code_pkce',
    buildAuthUrl: (redirectUri, state, challenge) =>
      buildProviderAuthorizeUrl(config, redirectUri, state, challenge),
    mapTokens: parseProviderTokens,
    postExchange,
    async exchangeToken(code, redirectUri, verifier, state) {
      try {
        if (config.includeStateInToken && state && code.includes('#')) {
          const [authorizationCode, returnedState, extra] = code.split('#');
          if (!authorizationCode || returnedState !== state || extra !== undefined)
            throw new Error('Invalid authorization code state');
          code = authorizationCode;
        }
        const response = await requestTokens(
          config,
          {
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            code_verifier: verifier,
            ...(config.includeStateInToken && state ? { state } : {})
          },
          fetchImpl
        );
        const tokens = adapter.mapTokens(response);
        return adapter.postExchange ? await adapter.postExchange(tokens) : tokens;
      } catch {
        throw new Error('OAuth token exchange failed');
      }
    }
  };
  return adapter;
}
