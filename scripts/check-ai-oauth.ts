import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type {
  CredentialRepository,
  ProviderCredential,
  ProviderOAuthConfig
} from '../src/lib/ai-router/types';

const registry = await import('../src/lib/ai-router/registry').catch(() => null);
const oauth = await import('../src/lib/ai-router/oauth').catch(() => null);
const credentials = await import('../src/lib/ai-router/credentials').catch(() => null);
assert.ok(registry && oauth && credentials, 'registry, OAuth and credential primitives must exist');

const config: ProviderOAuthConfig = {
  clientId: 'devone-client',
  authorizeUrl: 'https://provider.example/authorize?audience=api',
  tokenUrl: 'https://provider.example/token',
  scope: 'openid offline_access',
  encoding: 'form',
  refreshLeadMs: 60_000
};

assert.equal(registry.getProviderDefinition('cc', {})?.id, 'claude');
assert.equal(registry.getProviderDefinition('an', {})?.transport.auth.header, 'x-api-key');
assert.equal(registry.getProviderDefinition('cx', {})?.transport.format, 'openai-responses');
assert.equal(registry.getProviderDefinition('cx', {})?.transport.forceStream, true);
assert.equal(
  registry.getProviderDefinition('ol', {})?.transport.baseUrl,
  'http://localhost:11434/v1'
);
assert.ok(
  registry.getProviderDefinition('ollama', {})?.authTypes?.includes('none'),
  'local providers support unauthenticated connections'
);
assert.ok(registry.getProviderDefinition('claude', {})?.authTypes?.includes('api_key'));
assert.deepEqual(registry.getProviderDefinition('custom', {})?.authTypes, [
  'api_key',
  'oauth',
  'access_token',
  'none'
]);
assert.equal(registry.getProviderDefinition('claude', {})?.oauth, undefined);
assert.equal(registry.getProviderDefinition('missing', {}), null);
const isolated = registry.getProviderDefinition('anthropic', {})!;
isolated.transport.headers!['anthropic-version'] = 'mutated';
isolated.models[0].id = 'mutated';
isolated.authTypes!.push('none');
assert.equal(
  registry.getProviderDefinition('anthropic', {})?.transport.headers?.['anthropic-version'],
  '2023-06-01'
);
assert.notEqual(registry.getProviderDefinition('anthropic', {})?.models[0].id, 'mutated');
assert.ok(!registry.getProviderDefinition('anthropic', {})?.authTypes?.includes('none'));
const configured = registry.getProviderDefinition('custom', {
  DEVONE_AI_CUSTOM_CLIENT_ID: 'installed-client',
  DEVONE_AI_CUSTOM_AUTHORIZE_URL: config.authorizeUrl,
  DEVONE_AI_CUSTOM_TOKEN_URL: config.tokenUrl,
  DEVONE_AI_CUSTOM_FORMAT: 'claude',
  DEVONE_AI_CUSTOM_BASE_URL: 'https://custom.example/v1'
});
assert.equal(configured?.oauth?.clientId, 'installed-client');
assert.equal(configured?.transport.format, 'claude');
assert.equal(configured?.transport.baseUrl, 'https://custom.example/v1');
assert.throws(() =>
  registry.getProviderDefinition('custom', { DEVONE_AI_CUSTOM_FORMAT: 'invalid' })
);
assert.equal(
  registry.getProviderDefinition('claude', { DEVONE_AI_CLAUDE_CLIENT_ID: 'own' })?.oauth?.encoding,
  'json'
);

const pkce = oauth.generatePkce();
assert.match(pkce.state, /^[A-Za-z0-9_-]{43}$/);
assert.match(pkce.codeVerifier, /^[A-Za-z0-9_-]{43,128}$/);
assert.equal(
  pkce.codeChallenge,
  createHash('sha256').update(pkce.codeVerifier).digest('base64url')
);
assert.notEqual(oauth.generatePkce().state, pkce.state);
const authUrl = new URL(
  oauth.buildProviderAuthorizeUrl(
    config,
    'https://devone.example/callback',
    pkce.state,
    pkce.codeChallenge
  )
);
assert.equal(authUrl.searchParams.get('audience'), 'api');
assert.equal(authUrl.searchParams.get('response_type'), 'code');
assert.equal(authUrl.searchParams.get('redirect_uri'), 'https://devone.example/callback');
assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
assert.equal(authUrl.searchParams.get('state'), pkce.state);
assert.equal(authUrl.searchParams.get('scope'), config.scope);

const now = 1_700_000_000_000;
const tokens = oauth.parseProviderTokens(
  { access_token: 'access', refresh_token: 'rotated', id_token: 'identity', expires_in: 3600 },
  now
);
assert.equal(tokens.accessToken, 'access');
assert.equal(tokens.refreshToken, 'rotated');
assert.equal(tokens.idToken, 'identity');
assert.equal(tokens.expiresAt?.getTime(), now + 3_600_000);
assert.equal(oauth.parseProviderTokens({ access_token: 'access' }, now).refreshToken, undefined);
assert.equal(
  oauth
    .parseProviderTokens({ access_token: 'access', expires_at: 1_700_000_005 }, now)
    .expiresAt?.getTime(),
  now + 5000
);
assert.throws(() => oauth.parseProviderTokens({ access_token: 'access', expires_in: -1 }));
assert.throws(() => oauth.parseProviderTokens({ access_token: 'access', expires_in: 'garbage' }));
assert.throws(
  () => oauth.parseProviderTokens({ error: 'bad', error_description: 'secret-value' }),
  (error: unknown) => error instanceof Error && !error.message.includes('secret-value')
);
assert.throws(() =>
  oauth.buildProviderAuthorizeUrl(
    { ...config, authorizeUrl: 'http://provider.example/authorize' },
    'https://devone.example/callback',
    pkce.state,
    pkce.codeChallenge
  )
);

const requests: RequestInit[] = [];
const tokenFetch = (async (_input: unknown, init?: RequestInit) => {
  requests.push(init ?? {});
  return Response.json({ access_token: 'access', refresh_token: 'rotation', expires_in: 3600 });
}) as typeof fetch;
await oauth.exchangeProviderCode(
  config,
  'code',
  'https://devone.example/callback',
  pkce.codeVerifier,
  tokenFetch
);
let body = new URLSearchParams(String(requests[0].body));
assert.equal(body.get('grant_type'), 'authorization_code');
assert.equal(body.get('code_verifier'), pkce.codeVerifier);
assert.equal(body.get('client_id'), config.clientId);
assert.equal(requests[0].redirect, 'error');
assert.ok(requests[0].signal);
await oauth.refreshProviderToken(
  { ...config, encoding: 'json', clientSecret: 'installed-secret' },
  'old-refresh',
  tokenFetch
);
assert.deepEqual(JSON.parse(String(requests[1].body)), {
  grant_type: 'refresh_token',
  refresh_token: 'old-refresh',
  client_id: config.clientId,
  client_secret: 'installed-secret'
});
assert.equal(typeof oauth.createOAuthProvider, 'function', 'OAuth adapter factory must exist');
const adapter = oauth.createOAuthProvider(config, tokenFetch, async (tokens) => ({
  ...tokens,
  idToken: 'post-exchange-identity'
}));
assert.equal(adapter.flowType, 'authorization_code_pkce');
assert.equal(
  adapter.buildAuthUrl('https://devone.example/callback', pkce.state, pkce.codeChallenge),
  authUrl.toString()
);
assert.equal(adapter.mapTokens({ access_token: 'mapped-access' }).accessToken, 'mapped-access');
assert.equal(
  (await adapter.exchangeToken('code', 'https://devone.example/callback', pkce.codeVerifier))
    .idToken,
  'post-exchange-identity'
);
const errorFetch = (async () =>
  Response.json(
    { error_description: 'never reflect token-secret' },
    { status: 400 }
  )) as typeof fetch;
await assert.rejects(
  oauth.refreshProviderToken(config, 'token-secret', errorFetch),
  (error: unknown) => error instanceof Error && !error.message.includes('token-secret')
);

function connection(id: string, patch: Partial<ProviderCredential> = {}): ProviderCredential {
  return {
    id,
    providerId: 'custom',
    authType: 'oauth',
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: new Date(Date.now() - 1000),
    ...patch
  };
}

function memoryRepository(initial: ProviderCredential[]): CredentialRepository & {
  rows: Map<string, ProviderCredential>;
  writes: Partial<ProviderCredential>[];
} {
  const rows = new Map(initial.map((value) => [value.id, value]));
  const writes: Partial<ProviderCredential>[] = [];
  return {
    rows,
    writes,
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async update(id, patch) {
      writes.push(patch);
      const value = { ...rows.get(id)!, ...patch };
      rows.set(id, value);
      return value;
    }
  };
}

let refreshCount = 0;
const rotationFetch = (async () => {
  refreshCount++;
  await new Promise((resolve) => setTimeout(resolve, 10));
  return Response.json({
    access_token: `new-access-${refreshCount}`,
    refresh_token: 'new-refresh',
    expires_in: 3600
  });
}) as typeof fetch;
const repository = memoryRepository([connection('same')]);
const manager = credentials.createCredentialManager(repository, () => config, rotationFetch);
const refreshed = await Promise.all(Array.from({ length: 20 }, () => manager.ensureFresh('same')));
assert.equal(refreshCount, 1, 'concurrent requests rotate only once');
assert.ok(refreshed.every((value) => value?.accessToken === 'new-access-1'));
assert.equal(repository.rows.get('same')?.refreshToken, 'new-refresh');
assert.equal(repository.writes.length, 1, 'rotation persists together in one write');
assert.ok(repository.rows.get('same')?.lastRefreshAt instanceof Date);
assert.equal(await manager.ensureFresh('unknown'), null);

await Promise.all(Array.from({ length: 10 }, () => manager.forceRefresh('same', 'old-access')));
assert.equal(refreshCount, 1, 'late 401 responses reuse the already rotated credential');
await Promise.all(Array.from({ length: 10 }, () => manager.forceRefresh('same', 'new-access-1')));
assert.equal(refreshCount, 2, 'concurrent forced refresh calls rotate once');

let shortRefreshes = 0;
const shortFetch = (async () => {
  shortRefreshes++;
  await new Promise((resolve) => setTimeout(resolve, 10));
  return Response.json({
    access_token: `short-${shortRefreshes}`,
    refresh_token: `short-refresh-${shortRefreshes}`,
    expires_in: 30
  });
}) as typeof fetch;
const shortRepository = memoryRepository([connection('short')]);
const shortManager = credentials.createCredentialManager(shortRepository, () => config, shortFetch);
await Promise.all(Array.from({ length: 10 }, () => shortManager.ensureFresh('short')));
assert.equal(
  shortRefreshes,
  1,
  'concurrent refreshes reuse a newly issued token even within the proactive lead'
);

const preservedRepository = memoryRepository([
  connection('preserved', { idToken: 'existing-identity' })
]);
const preserveFetch = (async () =>
  Response.json({ access_token: 'next-access', expires_in: 3600 })) as typeof fetch;
await credentials
  .createCredentialManager(preservedRepository, () => config, preserveFetch)
  .ensureFresh('preserved');
assert.equal(preservedRepository.rows.get('preserved')?.refreshToken, 'old-refresh');
assert.equal(preservedRepository.rows.get('preserved')?.idToken, 'existing-identity');

const failures = memoryRepository([connection('failed')]);
const failureManager = credentials.createCredentialManager(failures, () => config, errorFetch);
assert.equal(await failureManager.ensureFresh('failed'), null);
assert.equal(failures.writes.length, 0);
assert.equal(failures.rows.get('failed')?.refreshToken, 'old-refresh');
failures.rows.set('failed', connection('failed', { expiresAt: new Date(Date.now() + 10_000) }));
assert.equal(
  (await failureManager.ensureFresh('failed'))?.accessToken,
  'old-access',
  'proactive failure can keep an unexpired token'
);
assert.equal(
  await failureManager.forceRefresh('failed', 'old-access'),
  null,
  'a rejected token cannot be reused after refresh fails'
);
failures.rows.set('failed', connection('failed', { refreshToken: null }));
assert.equal(
  await failureManager.ensureFresh('failed'),
  null,
  'expired unrefreshable tokens are unusable'
);
const noConfigManager = credentials.createCredentialManager(
  memoryRepository([connection('unconfigured')]),
  () => undefined,
  rotationFetch
);
assert.equal(await noConfigManager.ensureFresh('unconfigured'), null);
const nativeRepository = memoryRepository([
  connection('key', { authType: 'api_key', apiKey: 'key-value' }),
  connection('local', { authType: 'none' }),
  connection('fresh', { expiresAt: new Date(Date.now() + 3_600_000) })
]);
const nativeManager = credentials.createCredentialManager(
  nativeRepository,
  () => config,
  errorFetch
);
assert.equal((await nativeManager.ensureFresh('key'))?.apiKey, 'key-value');
assert.equal((await nativeManager.ensureFresh('local'))?.authType, 'none');
assert.equal((await nativeManager.ensureFresh('fresh'))?.accessToken, 'old-access');
assert.equal(nativeRepository.writes.length, 0);

let lockCalls = 0;
const lockedRepository = memoryRepository([connection('locked')]);
const alreadyRotated = connection('locked', {
  accessToken: 'external-access',
  refreshToken: 'external-refresh',
  expiresAt: new Date(Date.now() + 3_600_000)
});
lockedRepository.withLock = async (_id, work) => {
  lockCalls++;
  lockedRepository.rows.set('locked', alreadyRotated);
  return work(lockedRepository);
};
refreshCount = 0;
assert.equal(
  (
    await credentials
      .createCredentialManager(lockedRepository, () => config, rotationFetch)
      .ensureFresh('locked')
  )?.accessToken,
  'external-access'
);
assert.equal(lockCalls, 1);
assert.equal(refreshCount, 0, 'reload within database lock sees another worker rotation');

let active = 0;
let maxActive = 0;
const parallelFetch = (async () => {
  active++;
  maxActive = Math.max(active, maxActive);
  await new Promise((resolve) => setTimeout(resolve, 10));
  active--;
  return Response.json({ access_token: 'parallel', expires_in: 3600 });
}) as typeof fetch;
const parallelManager = credentials.createCredentialManager(
  memoryRepository([connection('a'), connection('b')]),
  () => config,
  parallelFetch
);
await Promise.all([parallelManager.ensureFresh('a'), parallelManager.ensureFresh('b')]);
assert.equal(maxActive, 2, 'unrelated accounts refresh independently');

console.log(
  'AI OAuth checks passed: registry, PKCE, token exchange, expiry, rotation and refresh concurrency.'
);
