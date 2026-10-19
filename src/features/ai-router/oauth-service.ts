import { createHash } from 'node:crypto';
import { getPrisma } from '@/lib/db/prisma';
import { getAppUrl } from '@/lib/auth/oauth';
import { encryptSecret, decryptSecret, getEncryptionKey } from '@/lib/encryption/secrets';
import {
  CLAUDE_CODE_REDIRECT_URI,
  CLAUDE_DEFAULT_CLIENT_ID,
  CODEX_DEFAULT_CLIENT_ID,
  getProviderDefinition
} from '@/lib/ai-router/registry';
import {
  requestCodexDeviceCode,
  pollCodexDeviceCode,
  type CodexDeviceCode
} from '@/lib/ai-router/device-auth';
import type { AiProvider } from '@/generated/prisma/client';
import type { AiOAuthConnection } from './api/types';
import {
  generatePkce,
  buildProviderAuthorizeUrl,
  exchangeProviderCode,
  parseOAuthCode,
  type ProviderTokens
} from '@/lib/ai-router/oauth';
import {
  assertGatewayUrl,
  validOAuthSession,
  oauthConfigFingerprint
} from '@/lib/ai-router/security';
import { recordAudit } from '@/lib/audit/record';
import { AiRouterError, requireAiAdmin, gatewayFetch, saveProvider } from './service';
import { CODEX_LOOPBACK_URI, ensureCodexLoopbackListener } from './codex-loopback';

function stateHash(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

function encrypt(value: string | undefined): string | null {
  return value ? encryptSecret(value, getEncryptionKey()) : null;
}

/** Selecting a built-in OAuth provider needs no intermediate provider or credential form. */
export async function connectOAuthProvider(
  userId: string,
  providerType: 'claude' | 'codex'
): Promise<string> {
  await requireAiAdmin(userId);
  const definition = getProviderDefinition(providerType);
  if (!definition?.authTypes?.includes('oauth'))
    throw new AiRouterError('This provider does not support OAuth sign-in');
  if (!definition.oauth)
    throw new AiRouterError(`${definition.name} sign-in is not configured for this installation.`);
  const existing = await getPrisma().aiProvider.findMany({
    where: { providerType },
    orderBy: { priority: 'asc' },
    select: { id: true }
  });
  const providerId =
    existing[0]?.id ??
    (await saveProvider(userId, {
      name: providerType === 'claude' ? 'Claude' : definition.name,
      providerType,
      alias: definition.alias,
      baseUrl: definition.transport.baseUrl,
      format: definition.transport.format,
      authType: 'oauth',
      models: definition.models.map((model) => model.id),
      priority: 100,
      enabled: true
    }));
  return startProviderOAuth(userId, providerId);
}

/** The installation's registered public URL supplies redirect URIs, never request headers. */
export async function startProviderOAuth(userId: string, providerId: string): Promise<string> {
  await requireAiAdmin(userId);
  const prisma = getPrisma();
  const provider = await prisma.aiProvider.findUnique({ where: { id: providerId } });
  if (!provider) throw new AiRouterError('Provider not found');
  const config = getProviderDefinition(provider.providerType)?.oauth;
  const appUrl = getAppUrl();
  if (!config || !appUrl) throw new AiRouterError('OAuth is not configured for this provider');
  const publicUrl = new URL(appUrl);
  if (
    publicUrl.protocol !== 'https:' &&
    !(publicUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(publicUrl.hostname))
  ) {
    throw new AiRouterError('OAuth requires an HTTPS public URL or localhost for development');
  }
  await Promise.all([assertGatewayUrl(config.authorizeUrl), assertGatewayUrl(config.tokenUrl)]);
  const providerCallback = `/api/ai/oauth/${encodeURIComponent(providerId)}/callback`;
  const local =
    ['localhost', '127.0.0.1'].includes(publicUrl.hostname) && process.env.VERCEL !== '1';
  if (
    provider.providerType === 'codex' &&
    config.clientId === CODEX_DEFAULT_CLIENT_ID &&
    config.redirectUri !== CODEX_LOOPBACK_URI
  )
    throw new AiRouterError(
      'The bundled Codex client uses its registered callback. Remove DEVONE_AI_CODEX_REDIRECT_URI and connect again.'
    );
  const codexDevice =
    provider.providerType === 'codex' &&
    config.clientId === CODEX_DEFAULT_CLIENT_ID &&
    config.redirectUri === CODEX_LOOPBACK_URI &&
    !local;
  const device = codexDevice
    ? await requestCodexDeviceCode(config, gatewayFetch).catch(() => {
        throw new AiRouterError('Could not start Codex device sign-in. Try again.');
      })
    : null;
  const redirectUri = device?.redirectUri ?? config.redirectUri ?? `${appUrl}${providerCallback}`;
  const redirect = new URL(redirectUri);
  const claudeCode =
    provider.providerType === 'claude' &&
    config.clientId === CLAUDE_DEFAULT_CLIENT_ID &&
    redirectUri === CLAUDE_CODE_REDIRECT_URI;
  if (
    provider.providerType === 'claude' &&
    config.clientId === CLAUDE_DEFAULT_CLIENT_ID &&
    !local &&
    !claudeCode
  )
    throw new AiRouterError(
      'Claude requires its registered code callback. Remove DEVONE_AI_CLAUDE_REDIRECT_URI and connect again.'
    );
  const codexLoopback = provider.providerType === 'codex' && redirectUri === CODEX_LOOPBACK_URI;
  if (codexLoopback && !local)
    throw new AiRouterError('Use the built-in Codex client for hosted device sign-in');
  if (
    !codexLoopback &&
    !claudeCode &&
    !device &&
    (redirect.origin !== publicUrl.origin ||
      redirect.username ||
      redirect.password ||
      redirect.search ||
      redirect.hash ||
      ![providerCallback, '/callback'].includes(redirect.pathname))
  )
    throw new AiRouterError('OAuth callback must use this installation’s callback address');
  if (codexLoopback) {
    try {
      await ensureCodexLoopbackListener(appUrl);
    } catch {
      throw new AiRouterError(
        'Could not open Codex callback port 1455. Finish any other Codex sign-in and retry.'
      );
    }
  }
  const pkce = generatePkce();
  const now = new Date();
  await prisma.aiOAuthSession.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { userId, providerId }] }
  });
  await prisma.aiOAuthSession.create({
    data: {
      providerId,
      userId,
      stateHash: stateHash(pkce.state),
      configHash: oauthConfigFingerprint(provider.providerType, config),
      // Device sessions keep their polling credential encrypted in the existing grant slot.
      encryptedCodeVerifier: encryptSecret(
        device ? JSON.stringify(device) : pkce.codeVerifier,
        getEncryptionKey()
      ),
      redirectUri,
      expiresAt: new Date(now.getTime() + (device ? 15 : 10) * 60_000)
    }
  });
  return device || claudeCode
    ? `${appUrl}/router/connect?state=${encodeURIComponent(pkce.state)}`
    : buildProviderAuthorizeUrl(config, redirectUri, pkce.state, pkce.codeChallenge);
}

async function pendingOAuth(userId: string, state: string) {
  await requireAiAdmin(userId);
  if (typeof state !== 'string' || !state || state.length > 256)
    throw new AiRouterError('Invalid connection link');
  const session = await getPrisma().aiOAuthSession.findUnique({
    where: { stateHash: stateHash(state) }
  });
  if (!session || !validOAuthSession(session, session.providerId, userId, stateHash(state)))
    throw new AiRouterError('That connection link expired. Try again.');
  const provider = await getPrisma().aiProvider.findUnique({ where: { id: session.providerId } });
  const config = provider ? getProviderDefinition(provider.providerType)?.oauth : undefined;
  if (
    !provider ||
    !config ||
    session.configHash !== oauthConfigFingerprint(provider.providerType, config)
  )
    throw new AiRouterError('Provider configuration changed. Connect again.');
  const device =
    provider.providerType === 'codex' &&
    config.clientId === CODEX_DEFAULT_CLIENT_ID &&
    session.redirectUri === `${new URL(config.authorizeUrl).origin}/deviceauth/callback`;
  const code =
    provider.providerType === 'claude' &&
    config.clientId === CLAUDE_DEFAULT_CLIENT_ID &&
    session.redirectUri === CLAUDE_CODE_REDIRECT_URI;
  if (!device && !code) throw new AiRouterError('Finish this connection through its callback');
  return { session, provider, config, device };
}

export async function getPendingOAuthConnection(
  userId: string,
  state: string
): Promise<AiOAuthConnection> {
  const { session, provider, config, device } = await pendingOAuth(userId, state);
  const verifier = decryptSecret(session.encryptedCodeVerifier, getEncryptionKey());
  const details = { providerId: provider.id, providerName: provider.name };
  if (device) {
    const data = JSON.parse(verifier) as CodexDeviceCode;
    return {
      ...details,
      flow: 'device',
      url: data.verificationUrl,
      userCode: data.userCode,
      intervalMs: data.intervalMs
    };
  }
  return {
    ...details,
    flow: 'code',
    url: buildProviderAuthorizeUrl(
      config,
      session.redirectUri,
      state,
      createHash('sha256').update(verifier).digest('base64url')
    )
  };
}

export async function completeHostedOAuth(
  userId: string,
  state: string,
  input = ''
): Promise<boolean> {
  const { session, provider, config, device } = await pendingOAuth(userId, state);
  if (!device) {
    let code: string;
    try {
      code = parseOAuthCode(input, session.redirectUri, state);
    } catch {
      throw new AiRouterError(
        'Invalid authorization code or state. Copy the full code and try again.'
      );
    }
    await finishProviderOAuth(userId, provider.id, state, code);
    return true;
  }
  const data = JSON.parse(
    decryptSecret(session.encryptedCodeVerifier, getEncryptionKey())
  ) as CodexDeviceCode;
  const grant = await pollCodexDeviceCode(config, data, gatewayFetch).catch(() => {
    throw new AiRouterError(
      'Could not complete Codex device sign-in. Start a new connection and try again.'
    );
  });
  if (!grant) return false;
  const claimed = await getPrisma().aiOAuthSession.deleteMany({
    where: { id: session.id, userId, providerId: provider.id, expiresAt: { gt: new Date() } }
  });
  if (claimed.count !== 1)
    throw new AiRouterError('That connection link expired or was already used');
  const tokens = await exchangeProviderCode(
    config,
    grant.code,
    session.redirectUri,
    grant.verifier,
    gatewayFetch
  );
  await saveOAuthConnection(userId, provider, session.configHash, tokens);
  return true;
}

export async function finishProviderOAuth(
  userId: string,
  providerId: string,
  state: string,
  code: string
): Promise<void> {
  await requireAiAdmin(userId);
  if (!state || state.length > 256 || !code || code.length > 10000)
    throw new AiRouterError('Invalid OAuth callback');
  const prisma = getPrisma();
  const session = await prisma.aiOAuthSession.findUnique({
    where: { stateHash: stateHash(state) }
  });
  if (!session || !validOAuthSession(session, providerId, userId, stateHash(state)))
    throw new AiRouterError('That connection link expired. Try again.');
  const provider = await prisma.aiProvider.findUnique({ where: { id: providerId } });
  const config = provider ? getProviderDefinition(provider.providerType)?.oauth : undefined;
  if (!provider || !config) throw new AiRouterError('OAuth is not configured for this provider');
  if (session.configHash !== oauthConfigFingerprint(provider.providerType, config))
    throw new AiRouterError('Provider configuration changed. Connect again.');
  if (provider.providerType === 'codex' && session.redirectUri.endsWith('/deviceauth/callback'))
    throw new AiRouterError('Finish this connection using device sign-in');
  // Conditional deletion claims the authorization exactly once across concurrent callbacks.
  const claimed = await prisma.aiOAuthSession.deleteMany({
    where: { id: session.id, userId, providerId, expiresAt: { gt: new Date() } }
  });
  if (claimed.count !== 1) throw new AiRouterError('That connection link was already used');
  const tokens = await exchangeProviderCode(
    config,
    code,
    session.redirectUri,
    decryptSecret(session.encryptedCodeVerifier, getEncryptionKey()),
    gatewayFetch,
    state
  );
  await saveOAuthConnection(userId, provider, session.configHash, tokens);
}

async function saveOAuthConnection(
  userId: string,
  provider: AiProvider,
  configHash: string,
  tokens: ProviderTokens
): Promise<void> {
  const metadata: Record<string, string> = {
    oauthConfigHash: configHash,
    upstreamBaseUrl: provider.baseUrl
  };
  if (tokens.idToken) {
    try {
      // Claims are display/provider metadata only; they never authorize a DevOne user.
      const claims = JSON.parse(
        Buffer.from(tokens.idToken.split('.')[1], 'base64url').toString('utf8')
      ) as Record<string, unknown>;
      if (typeof claims.email === 'string') metadata.email = claims.email.slice(0, 200);
      const auth = claims['https://api.openai.com/auth'];
      if (
        auth &&
        typeof auth === 'object' &&
        typeof (auth as Record<string, unknown>).chatgpt_account_id === 'string'
      )
        metadata.chatgptAccountId = (auth as Record<string, string>).chatgpt_account_id;
    } catch {
      /* Missing ID-token metadata does not invalidate a granted access token. */
    }
  }
  const prisma = getPrisma();
  const currentProvider = await prisma.aiProvider.findUnique({ where: { id: provider.id } });
  const currentConfig = currentProvider
    ? getProviderDefinition(currentProvider.providerType)?.oauth
    : undefined;
  if (
    !currentProvider ||
    !currentConfig ||
    configHash !== oauthConfigFingerprint(currentProvider.providerType, currentConfig)
  )
    throw new AiRouterError('Provider configuration changed. Connect again.');
  await prisma.aiConnection.create({
    data: {
      providerId: provider.id,
      name: metadata.email ?? `${provider.name} account`,
      authType: 'oauth',
      encryptedAccessToken: encrypt(tokens.accessToken),
      encryptedRefreshToken: encrypt(tokens.refreshToken),
      encryptedIdToken: encrypt(tokens.idToken),
      expiresAt: tokens.expiresAt,
      lastRefreshAt: new Date(),
      providerSpecificData: metadata
    }
  });
  await recordAudit({ actorId: userId, action: 'admin.ai.account.connect', target: provider.name });
}
