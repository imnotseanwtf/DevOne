import { createHash } from 'node:crypto';
import { getPrisma } from '@/lib/db/prisma';
import { getAppUrl } from '@/lib/auth/oauth';
import { encryptSecret, decryptSecret, getEncryptionKey } from '@/lib/encryption/secrets';
import { getProviderDefinition } from '@/lib/ai-router/registry';
import {
  generatePkce,
  buildProviderAuthorizeUrl,
  exchangeProviderCode
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
  const redirectUri = config.redirectUri ?? `${appUrl}${providerCallback}`;
  const redirect = new URL(redirectUri);
  const codexLoopback = provider.providerType === 'codex' && redirectUri === CODEX_LOOPBACK_URI;
  if (codexLoopback && !['localhost', '127.0.0.1'].includes(publicUrl.hostname))
    throw new AiRouterError('Codex loopback sign-in requires DevOne running locally');
  if (
    !codexLoopback &&
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
      encryptedCodeVerifier: encryptSecret(pkce.codeVerifier, getEncryptionKey()),
      redirectUri,
      expiresAt: new Date(now.getTime() + 10 * 60_000)
    }
  });
  return buildProviderAuthorizeUrl(config, redirectUri, pkce.state, pkce.codeChallenge);
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
  const metadata: Record<string, string> = {
    oauthConfigHash: session.configHash,
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
  const currentProvider = await prisma.aiProvider.findUnique({ where: { id: providerId } });
  const currentConfig = currentProvider
    ? getProviderDefinition(currentProvider.providerType)?.oauth
    : undefined;
  if (
    !currentProvider ||
    !currentConfig ||
    session.configHash !== oauthConfigFingerprint(currentProvider.providerType, currentConfig)
  )
    throw new AiRouterError('Provider configuration changed. Connect again.');
  await prisma.aiConnection.create({
    data: {
      providerId,
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
