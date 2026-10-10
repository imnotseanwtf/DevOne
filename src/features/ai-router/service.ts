import { UserRole, type Prisma } from '@/generated/prisma/client';
import { AUTO_MODEL } from '@/lib/ai-router/routing';
import {
  cooldownMs,
  normalizeBaseUrl,
  parseModelList,
  providerUrl,
  type ComboStep,
  type RouterCombo,
  type RouterProvider
} from '@/lib/ai-router/routing';
import { createAiApiKey, hashAiApiKey } from '@/lib/ai-router/keys';
import type { AttemptFailure, ForwardOutcome } from '@/lib/ai-router/forward';
import type { RouteTarget } from '@/lib/ai-router/routing';
import { openCodeFreeModels } from '@/lib/ai-router/opencode-free';
import { getProviderDefinition } from '@/lib/ai-router/registry';
import { createCredentialManager } from '@/lib/ai-router/credentials';
import { assertGatewayUrl } from '@/lib/ai-router/security';
import { safeGatewayFetch } from '@/lib/ai-router/outbound';
import { selectConnections } from '@/lib/ai-router/selection';
import type { ProviderAuthType, ProviderFormat } from '@/lib/ai-router/types';
import type {
  AiProviderSummary,
  AiConnectionSummary,
  AiRouterSettings,
  ConnectionInput
} from './api/types';
import { createConnectionRepository } from './connection-repository';
import { recordAudit } from '@/lib/audit/record';
import { getPrisma } from '@/lib/db/prisma';
import { decryptSecret, encryptSecret, getEncryptionKey } from '@/lib/encryption/secrets';
import { comboStepSchema, type ComboInput, type ProviderInput } from './schema';

export class AiRouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiRouterError';
  }
}

export async function requireAiAdmin(userId: string): Promise<void> {
  const user = await getPrisma().user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role !== UserRole.ADMIN) throw new AiRouterError('Administrators only');
}

const requireAdmin = requireAiAdmin;

export const gatewayFetch: typeof fetch = async (input, init) => {
  return safeGatewayFetch(input, init);
};

function readSteps(value: Prisma.JsonValue): ComboStep[] {
  const parsed = comboStepSchema.array().safeParse(value);
  return parsed.success ? parsed.data : [];
}

// ---------------------------------------------------------------------------
// The router itself

export interface RouterState {
  providers: RouterProvider[];
  combos: RouterCombo[];
  apiKeyFor: (providerId: string) => string | null;
  settings: AiRouterSettings;
  targetsFor: (targets: RouteTarget[]) => RouteTarget[];
  credentialFor: NonNullable<import('@/lib/ai-router/forward').ForwardOptions['credentialFor']>;
  refreshCredential: NonNullable<
    import('@/lib/ai-router/forward').ForwardOptions['refreshCredential']
  >;
}

/** Everything one request needs, keys decrypted only when that provider is tried. */
export async function loadRouterState(): Promise<RouterState> {
  const [providers, combos, settings] = await Promise.all([
    getPrisma().aiProvider.findMany({ include: { connections: true } }),
    getPrisma().aiCombo.findMany({ select: { name: true, steps: true } }),
    getPrisma().aiRouterSettings.findUnique({ where: { id: 'default' } })
  ]);
  const encrypted = new Map(providers.map((provider) => [provider.id, provider.encryptedApiKey]));
  const definitions = new Map(
    providers.map((provider) => [provider.id, getProviderDefinition(provider.providerType)])
  );
  const manager = createCredentialManager(
    createConnectionRepository(),
    (id) => definitions.get(id)?.oauth,
    gatewayFetch
  );
  return {
    providers: providers.map((provider) => {
      const definition = definitions.get(provider.id);
      const format = provider.format as ProviderFormat;
      return {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        models: provider.models,
        priority: provider.priority,
        enabled: provider.enabled,
        // Account cooldowns are enforced below; a single failing account doesn't rest its siblings.
        cooldownUntil: null,
        alias:
          provider.alias ?? (provider.providerType !== 'custom' ? definition?.alias : undefined),
        providerType: provider.providerType,
        format,
        authType: provider.authType as ProviderAuthType,
        upstreamPath:
          definition?.transport.format === format
            ? definition.transport.path
            : format === 'claude'
              ? '/messages'
              : format === 'openai-responses'
                ? '/responses'
                : '/chat/completions',
        forceStream: definition?.transport.forceStream,
        headers: {
          ...definition?.transport.headers,
          ...(format === 'claude' ? { 'anthropic-version': '2023-06-01' } : {})
        },
        authHeader: format === 'claude' ? 'x-api-key' : definition?.transport.auth.header,
        authScheme: format === 'claude' ? 'raw' : definition?.transport.auth.scheme
      };
    }),
    combos: combos.map((combo) => ({ name: combo.name, steps: readSteps(combo.steps) })),
    apiKeyFor: (providerId) => {
      const value = encrypted.get(providerId);
      return value ? decryptSecret(value, getEncryptionKey()) : null;
    },
    settings: settings ?? {
      defaultModel: null,
      compressToolOutput: true,
      maxToolOutputChars: 30000
    },
    targetsFor: (targets) => {
      const excluded = new Set<string>();
      return targets.flatMap((target) => {
        const provider = providers.find((candidate) => candidate.id === target.provider.id);
        if (!provider) return [];
        return selectConnections(provider.connections, target.model).flatMap((connection) => {
          const key = `${connection.id}:${target.model}`;
          if (excluded.has(key)) return [];
          excluded.add(key);
          const upstreamModel = definitions
            .get(provider.id)
            ?.models.find((model) => model.id === target.model)?.upstreamModelId;
          return [{ ...target, model: upstreamModel ?? target.model, connectionId: connection.id }];
        });
      });
    },
    credentialFor: (target) =>
      target.connectionId ? manager.ensureFresh(target.connectionId) : Promise.resolve(null),
    refreshCredential: (target, token) =>
      target.connectionId ? manager.forceRefresh(target.connectionId, token) : Promise.resolve(null)
  };
}

export interface RouterCaller {
  userId: string;
  apiKeyId: string | null;
}

/** The person behind a personal AI key, if the key exists and they may still sign in. */
export async function findCallerByKey(key: string): Promise<RouterCaller | null> {
  const record = await getPrisma().aiApiKey.findUnique({
    where: { tokenHash: hashAiApiKey(key) },
    include: { user: { select: { disabledAt: true, demoExpiresAt: true } } }
  });
  if (!record || record.user.disabledAt) return null;
  if (record.user.demoExpiresAt && record.user.demoExpiresAt <= new Date()) return null;
  // Touch at most once a minute: every request would otherwise write here.
  if (!record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > 60_000) {
    await getPrisma()
      .aiApiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
  return { userId: record.userId, apiKeyId: record.id };
}

/** Rests a provider after a failure so the next requests go elsewhere first. */
export async function recordProviderFailure(failure: AttemptFailure): Promise<void> {
  const rest = cooldownMs(failure.status, failure.retryAfter);
  const label = failure.status ? `HTTP ${failure.status}: ${failure.error}` : failure.error;
  if (failure.target.connectionId) {
    const connection = await getPrisma().aiConnection.findUnique({
      where: { id: failure.target.connectionId }
    });
    if (!connection) return;
    const locks =
      connection.modelLocks &&
      typeof connection.modelLocks === 'object' &&
      !Array.isArray(connection.modelLocks)
        ? (connection.modelLocks as Record<string, Prisma.JsonValue>)
        : {};
    await getPrisma()
      .aiConnection.update({
        where: { id: connection.id },
        data: {
          lastError: label.slice(0, 500),
          lastErrorAt: new Date(),
          rateLimitedUntil: rest > 0 ? new Date(Date.now() + rest) : undefined,
          ...(failure.status === 404
            ? {
                modelLocks: {
                  ...locks,
                  [failure.target.model]: new Date(Date.now() + 60000).toISOString()
                }
              }
            : {})
        }
      })
      .catch(() => undefined);
    return;
  }
  await getPrisma()
    .aiProvider.update({
      where: { id: failure.target.provider.id },
      data: {
        lastError: label.slice(0, 500),
        cooldownUntil: rest > 0 ? new Date(Date.now() + rest) : undefined
      }
    })
    .catch(() => undefined);
}

export async function recordUsage(
  caller: RouterCaller,
  requestedModel: string,
  startedAt: number,
  outcome: ForwardOutcome,
  savedChars = 0
): Promise<void> {
  const provider = outcome.target?.provider ?? null;
  const prisma = getPrisma();
  await Promise.all([
    prisma.aiUsage
      .create({
        data: {
          userId: caller.userId,
          apiKeyId: caller.apiKeyId,
          providerId: provider?.id ?? null,
          connectionId: outcome.target?.connectionId ?? null,
          providerName: provider?.name ?? null,
          requestedModel: requestedModel.slice(0, 200),
          model: outcome.target?.model.slice(0, 200) ?? null,
          status: outcome.status,
          attempts: outcome.attempts,
          promptTokens: outcome.usage.promptTokens,
          completionTokens: outcome.usage.completionTokens,
          latencyMs: Date.now() - startedAt,
          savedChars,
          error: outcome.error?.slice(0, 500) ?? null
        }
      })
      .catch(() => undefined),
    // An answer means the provider is healthy again.
    outcome.target?.connectionId && outcome.status < 400 && !outcome.error
      ? prisma.aiConnection
          .update({
            where: { id: outcome.target.connectionId },
            data: { rateLimitedUntil: null, lastError: null, lastErrorAt: null }
          })
          .catch(() => undefined)
      : undefined
  ]);
}

// ---------------------------------------------------------------------------
// Administration

export async function listProviders(adminId: string): Promise<AiProviderSummary[]> {
  await requireAdmin(adminId);
  const providers = await getPrisma().aiProvider.findMany({
    orderBy: [{ priority: 'asc' }, { name: 'asc' }]
  });
  return providers.map(({ encryptedApiKey, ...provider }) => ({
    ...provider,
    format: provider.format as ProviderFormat,
    authType: provider.authType as ProviderAuthType,
    hasApiKey: encryptedApiKey !== null,
    oauthConfigured: Boolean(getProviderDefinition(provider.providerType)?.oauth)
  }));
}

export type { AiProviderSummary } from './api/types';

export async function saveProvider(adminId: string, input: ProviderInput): Promise<string> {
  await requireAdmin(adminId);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!baseUrl) throw new AiRouterError('Enter an http:// or https:// base URL');
  await assertGatewayUrl(baseUrl);
  const definition = getProviderDefinition(input.providerType);
  if (!definition || !definition.authTypes?.includes(input.authType))
    throw new AiRouterError('Unsupported provider authentication mode');
  if (input.name.trim().toLowerCase() === AUTO_MODEL) {
    throw new AiRouterError(`"${AUTO_MODEL}" is reserved`);
  }
  const prisma = getPrisma();
  const effectiveAlias = input.alias ?? (input.providerType !== 'custom' ? definition.alias : null);
  const identifiers = new Set([
    input.name.toLowerCase(),
    ...(effectiveAlias ? [effectiveAlias.toLowerCase()] : [])
  ]);
  if (effectiveAlias?.toLowerCase() === AUTO_MODEL)
    throw new AiRouterError(`"${AUTO_MODEL}" is reserved`);

  const models = [...new Set(input.models)];
  if (
    input.providerType === 'opencode' &&
    (input.format !== 'openai' || openCodeFreeModels(models).length !== models.length)
  ) {
    throw new AiRouterError('OpenCode Free supports its free Chat models only');
  }
  const apiKey = input.apiKey
    ? encryptSecret(input.apiKey, getEncryptionKey())
    : input.clearApiKey
      ? null
      : undefined;
  const data = {
    name: input.name,
    providerType: input.providerType,
    alias: effectiveAlias,
    format: input.format,
    authType: input.authType,
    baseUrl,
    models,
    priority: input.priority,
    enabled: input.enabled
  };

  const providerId = await prisma.$transaction(async (transaction) => {
    // Names and aliases share one routing namespace. Serialize the check and write together.
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('devone-ai-provider-namespace', 0))`;
    const others = await transaction.aiProvider.findMany({
      where: { NOT: { id: input.id ?? '' } },
      select: { name: true, alias: true, providerType: true }
    });
    for (const other of others) {
      const alias =
        other.alias ??
        (other.providerType !== 'custom' ? getProviderDefinition(other.providerType)?.alias : null);
      if (
        identifiers.has(other.name.toLowerCase()) ||
        (alias && identifiers.has(alias.toLowerCase()))
      )
        throw new AiRouterError('Another provider uses that name or alias');
    }
    const existing = input.id
      ? await transaction.aiProvider.findUnique({
          where: { id: input.id },
          include: { connections: true }
        })
      : null;
    if (input.id && !existing) throw new AiRouterError('Provider not found');
    const primary = existing?.connections.find(
      (account) => account.id === `${existing.id}-primary`
    );
    const savedSecret =
      input.authType === 'access_token' ? primary?.encryptedAccessToken : primary?.encryptedApiKey;
    const encryptedValue =
      apiKey === undefined ? (savedSecret ?? existing?.encryptedApiKey ?? null) : apiKey;
    if (
      input.authType !== 'oauth' &&
      input.authType !== 'none' &&
      !encryptedValue &&
      !existing?.connections.length
    ) {
      throw new AiRouterError('Enter a provider API key or access token');
    }
    const provider = existing
      ? await transaction.aiProvider.update({
          where: { id: existing.id },
          data: {
            ...data,
            ...(apiKey !== undefined ? { encryptedApiKey: apiKey } : {}),
            cooldownUntil: null,
            lastError: null
          }
        })
      : await transaction.aiProvider.create({ data: { ...data, encryptedApiKey: apiKey ?? null } });
    if (
      existing &&
      (existing.providerType !== input.providerType ||
        existing.baseUrl !== baseUrl ||
        existing.format !== input.format ||
        existing.authType !== input.authType)
    ) {
      await transaction.aiOAuthSession.deleteMany({ where: { providerId: existing.id } });
    }
    if (
      existing &&
      (existing.providerType !== input.providerType || existing.baseUrl !== baseUrl)
    ) {
      await transaction.aiConnection.updateMany({
        where: { providerId: existing.id, authType: 'oauth' },
        data: {
          isActive: false,
          lastError: 'Provider configuration changed. Connect this account again.',
          lastErrorAt: new Date()
        }
      });
    }
    if (input.authType !== 'oauth' && (encryptedValue || input.authType === 'none' || primary)) {
      const primaryId = `${provider.id}-primary`;
      const credentialData = {
        authType: input.authType,
        encryptedApiKey: input.authType === 'api_key' ? encryptedValue : null,
        encryptedAccessToken: input.authType === 'access_token' ? encryptedValue : null,
        encryptedRefreshToken: null,
        encryptedIdToken: null,
        expiresAt: null,
        lastRefreshAt: null,
        rateLimitedUntil: null,
        modelLocks: {},
        lastError: null,
        lastErrorAt: null
      };
      if (input.authType !== 'none' && !encryptedValue)
        throw new AiRouterError('Enter a provider key, or select No authentication');
      await transaction.aiConnection.upsert({
        where: { id: primaryId },
        create: { id: primaryId, providerId: provider.id, name: 'Primary', ...credentialData },
        update: credentialData
      });
    }
    return provider.id;
  });
  await recordAudit({
    actorId: adminId,
    action: input.id ? 'admin.ai.provider.update' : 'admin.ai.provider.add',
    target: input.name
  });
  return providerId;
}

export async function setProviderEnabled(adminId: string, providerId: string, enabled: boolean) {
  await requireAdmin(adminId);
  const provider = await getPrisma().aiProvider.update({
    where: { id: providerId },
    data: { enabled, cooldownUntil: null }
  });
  await recordAudit({
    actorId: adminId,
    action: 'admin.ai.provider.update',
    target: provider.name,
    details: { enabled }
  });
}

export async function clearProviderCooldown(adminId: string, providerId: string) {
  await requireAdmin(adminId);
  await getPrisma().aiProvider.update({
    where: { id: providerId },
    data: { cooldownUntil: null, lastError: null }
  });
  await getPrisma().aiConnection.updateMany({
    where: { providerId },
    data: { rateLimitedUntil: null, modelLocks: {}, lastError: null, lastErrorAt: null }
  });
}

export async function deleteProvider(adminId: string, providerId: string) {
  await requireAdmin(adminId);
  const prisma = getPrisma();
  const provider = await prisma.aiProvider.delete({ where: { id: providerId } });
  // Drop the provider from every combo that used it.
  const combos = await prisma.aiCombo.findMany();
  await Promise.all(
    combos.map((combo) => {
      const steps = readSteps(combo.steps);
      const kept = steps.filter((step) => step.providerId !== providerId);
      return kept.length === steps.length
        ? undefined
        : prisma.aiCombo.update({ where: { id: combo.id }, data: { steps: kept } });
    })
  );
  await recordAudit({
    actorId: adminId,
    action: 'admin.ai.provider.delete',
    target: provider.name
  });
}

/**
 * Lists the models a provider offers, to fill the form. A saved provider's
 * key is used when the form leaves the key empty.
 */
export async function fetchProviderModels(
  adminId: string,
  input: {
    providerId?: string;
    baseUrl: string;
    apiKey?: string;
    providerType?: string;
    format?: ProviderFormat;
    authType?: ProviderAuthType;
  },
  fetchImpl: typeof fetch = gatewayFetch
): Promise<string[]> {
  await requireAdmin(adminId);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!baseUrl) throw new AiRouterError('Enter an http:// or https:// base URL');
  await assertGatewayUrl(baseUrl);
  let apiKey = input.apiKey || null;
  let providerType = input.providerType ?? 'custom';
  let format = input.format ?? 'openai';
  let authType = input.authType ?? 'api_key';
  if (!apiKey && input.providerId) {
    const saved = await getPrisma().aiProvider.findUnique({
      where: { id: input.providerId },
      select: {
        encryptedApiKey: true,
        baseUrl: true,
        format: true,
        providerType: true,
        authType: true,
        connections: { where: { isActive: true }, orderBy: { priority: 'asc' } }
      }
    });
    if (!saved || saved.baseUrl !== baseUrl)
      throw new AiRouterError('Saved credentials can only be used with the saved provider URL');
    providerType = input.providerType ?? saved.providerType;
    format = input.format ?? (saved.format as ProviderFormat);
    authType = saved.authType as ProviderAuthType;
    const account = saved.connections.find(
      (connection) => !connection.rateLimitedUntil || connection.rateLimitedUntil <= new Date()
    );
    if (account) {
      const manager = createCredentialManager(
        createConnectionRepository(),
        () => getProviderDefinition(saved.providerType)?.oauth,
        gatewayFetch
      );
      const credential = await manager.ensureFresh(account.id);
      if (!credential) throw new AiRouterError('Reconnect the provider account');
      authType = credential.authType;
      apiKey =
        authType === 'api_key' ? (credential.apiKey ?? null) : (credential.accessToken ?? null);
    } else {
      apiKey = saved.encryptedApiKey
        ? decryptSecret(saved.encryptedApiKey, getEncryptionKey())
        : null;
    }
  }
  const definition = getProviderDefinition(providerType);
  const tokenAuth = authType === 'oauth' || authType === 'access_token';
  const headers = new Headers({ ...definition?.transport.headers, accept: 'application/json' });
  if (format === 'claude') headers.set('anthropic-version', '2023-06-01');
  if (apiKey) {
    const authHeader = tokenAuth
      ? 'authorization'
      : format === 'claude'
        ? 'x-api-key'
        : (definition?.transport.auth.header ?? 'authorization');
    const scheme = tokenAuth
      ? 'bearer'
      : format === 'claude'
        ? 'raw'
        : (definition?.transport.auth.scheme ?? 'bearer');
    headers.set(authHeader, scheme === 'bearer' ? `Bearer ${apiKey}` : apiKey);
  }
  let response: Response;
  try {
    response = await fetchImpl(providerUrl(baseUrl, 'models'), {
      headers,
      signal: AbortSignal.timeout(15_000),
      redirect: 'error'
    });
  } catch {
    throw new AiRouterError('Could not reach the provider');
  }
  if (response.status === 401 || response.status === 403) {
    throw new AiRouterError('The provider refused the API key');
  }
  if (!response.ok) throw new AiRouterError(`The provider answered HTTP ${response.status}`);
  const listed = parseModelList(await response.json().catch(() => null));
  const models = providerType === 'opencode' ? openCodeFreeModels(listed) : listed;
  if (models.length === 0) throw new AiRouterError('The provider listed no models');
  return models;
}

/** Create the anonymous free provider only when explicitly selected in the catalog. */
export async function connectFreeProvider(adminId: string): Promise<string> {
  await requireAdmin(adminId);
  const existing = await getPrisma().aiProvider.findFirst({
    where: { providerType: 'opencode' },
    orderBy: { priority: 'asc' },
    select: { id: true }
  });
  if (existing) return existing.id;
  const definition = getProviderDefinition('opencode')!;
  const models = await fetchProviderModels(adminId, {
    providerType: 'opencode',
    baseUrl: definition.transport.baseUrl,
    authType: 'none',
    format: 'openai'
  });
  return saveProvider(adminId, {
    name: definition.name,
    providerType: 'opencode',
    alias: definition.alias,
    baseUrl: definition.transport.baseUrl,
    authType: 'none',
    format: 'openai',
    models,
    priority: 40,
    enabled: true
  });
}

export async function listCombos(adminId: string) {
  await requireAdmin(adminId);
  const combos = await getPrisma().aiCombo.findMany({ orderBy: { name: 'asc' } });
  return combos.map((combo) => ({ id: combo.id, name: combo.name, steps: readSteps(combo.steps) }));
}

export type AiComboSummary = Awaited<ReturnType<typeof listCombos>>[number];

export async function saveCombo(adminId: string, input: ComboInput) {
  await requireAdmin(adminId);
  const prisma = getPrisma();
  if (input.name === AUTO_MODEL) throw new AiRouterError(`"${AUTO_MODEL}" is reserved`);
  const clash = await prisma.aiCombo.findFirst({
    where: { name: input.name, NOT: { id: input.id ?? '' } },
    select: { id: true }
  });
  if (clash) throw new AiRouterError('Another combo has that name');
  const providerIds = new Set(
    (await prisma.aiProvider.findMany({ select: { id: true } })).map((provider) => provider.id)
  );
  if (input.steps.some((step) => !providerIds.has(step.providerId))) {
    throw new AiRouterError('A step uses a provider that no longer exists');
  }
  const data = { name: input.name, steps: input.steps };
  if (input.id) await prisma.aiCombo.update({ where: { id: input.id }, data });
  else await prisma.aiCombo.create({ data });
  await recordAudit({
    actorId: adminId,
    action: input.id ? 'admin.ai.combo.update' : 'admin.ai.combo.add',
    target: input.name
  });
}

export async function deleteCombo(adminId: string, comboId: string) {
  await requireAdmin(adminId);
  const combo = await getPrisma().aiCombo.delete({ where: { id: comboId } });
  await recordAudit({ actorId: adminId, action: 'admin.ai.combo.delete', target: combo.name });
}

/** Requests, tokens and failures per provider over the last day, and the latest requests. */
export async function usageOverview(adminId: string) {
  await requireAdmin(adminId);
  const prisma = getPrisma();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [grouped, failed, recent] = await Promise.all([
    prisma.aiUsage.groupBy({
      by: ['providerName'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true },
      _avg: { latencyMs: true }
    }),
    prisma.aiUsage.groupBy({
      by: ['providerName'],
      where: { createdAt: { gte: since }, status: { gte: 400 } },
      _count: { _all: true }
    }),
    prisma.aiUsage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { username: true } } }
    })
  ]);
  const failures = new Map(failed.map((row) => [row.providerName, row._count._all]));
  const byProvider = grouped
    .map((row) => ({
      providerName: row.providerName,
      requests: row._count._all,
      failures: failures.get(row.providerName) ?? 0,
      promptTokens: row._sum.promptTokens ?? 0,
      completionTokens: row._sum.completionTokens ?? 0,
      averageLatencyMs: Math.round(row._avg.latencyMs ?? 0)
    }))
    .toSorted((a, b) => b.requests - a.requests);
  return { byProvider, recent };
}

export type AiUsageOverview = Awaited<ReturnType<typeof usageOverview>>;

// ---------------------------------------------------------------------------
// Personal keys

export async function listApiKeys(userId: string) {
  return getPrisma().aiApiKey.findMany({
    where: { userId },
    select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' }
  });
}

export type AiApiKeySummary = Awaited<ReturnType<typeof listApiKeys>>[number];

const MAX_KEYS = 20;

/** Returns the key itself, which is never shown again. */
export async function createApiKey(userId: string, name: string): Promise<string> {
  const prisma = getPrisma();
  if ((await prisma.aiApiKey.count({ where: { userId } })) >= MAX_KEYS) {
    throw new AiRouterError(`You can have at most ${MAX_KEYS} keys`);
  }
  const { key, hash, prefix } = createAiApiKey();
  await prisma.aiApiKey.create({ data: { userId, name, tokenHash: hash, prefix } });
  await recordAudit({ actorId: userId, action: 'account.ai_key.create', target: name });
  return key;
}

export async function deleteApiKey(userId: string, keyId: string) {
  const { count } = await getPrisma().aiApiKey.deleteMany({ where: { id: keyId, userId } });
  if (count === 0) throw new AiRouterError('Key not found');
  await recordAudit({ actorId: userId, action: 'account.ai_key.delete' });
}

// Account and installation settings used by the admin service layer.
export async function listConnections(adminId: string): Promise<AiConnectionSummary[]> {
  await requireAdmin(adminId);
  const accounts = await getPrisma().aiConnection.findMany({
    orderBy: [{ providerId: 'asc' }, { priority: 'asc' }]
  });
  return accounts.map((account) => ({
    id: account.id,
    providerId: account.providerId,
    name: account.name,
    authType: account.authType as ProviderAuthType,
    priority: account.priority,
    isActive: account.isActive,
    allowedModels: account.allowedModels,
    expiresAt: account.expiresAt,
    rateLimitedUntil: account.rateLimitedUntil,
    lastError: account.lastError,
    hasApiKey: Boolean(account.encryptedApiKey),
    hasAccessToken: Boolean(account.encryptedAccessToken),
    hasRefreshToken: Boolean(account.encryptedRefreshToken)
  }));
}

export async function saveConnection(adminId: string, input: ConnectionInput): Promise<void> {
  await requireAdmin(adminId);
  const prisma = getPrisma();
  const provider = await prisma.aiProvider.findUnique({ where: { id: input.providerId } });
  if (!provider) throw new AiRouterError('Provider not found');
  const existing = input.id
    ? await prisma.aiConnection.findUnique({ where: { id: input.id } })
    : null;
  if (input.id && (!existing || existing.providerId !== input.providerId))
    throw new AiRouterError('Account not found');
  if (input.authType === 'oauth' && (!existing || existing.authType !== 'oauth' || input.apiKey)) {
    throw new AiRouterError('Use Connect to add an OAuth account');
  }
  if (!getProviderDefinition(provider.providerType)?.authTypes?.includes(input.authType))
    throw new AiRouterError('Unsupported provider authentication mode');
  const secret = input.apiKey ? encryptSecret(input.apiKey, getEncryptionKey()) : undefined;
  const preserved =
    input.authType === 'api_key' ? existing?.encryptedApiKey : existing?.encryptedAccessToken;
  if ((input.authType === 'api_key' || input.authType === 'access_token') && !secret && !preserved)
    throw new AiRouterError('Enter a provider key or access token');
  const data = {
    name: input.name,
    authType: input.authType,
    priority: input.priority,
    isActive: input.isActive,
    allowedModels: input.allowedModels,
    ...(input.authType === 'oauth'
      ? {}
      : {
          encryptedApiKey:
            input.authType === 'api_key' ? (secret ?? existing?.encryptedApiKey ?? null) : null,
          encryptedAccessToken:
            input.authType === 'access_token'
              ? (secret ?? existing?.encryptedAccessToken ?? null)
              : null,
          encryptedRefreshToken: null,
          encryptedIdToken: null,
          expiresAt: null,
          lastRefreshAt: null
        }),
    rateLimitedUntil: null,
    modelLocks: {},
    lastError: null,
    lastErrorAt: null
  };
  if (existing) await prisma.aiConnection.update({ where: { id: existing.id }, data });
  else await prisma.aiConnection.create({ data: { ...data, providerId: provider.id } });
  await recordAudit({ actorId: adminId, action: 'admin.ai.account.save', target: input.name });
}

export async function deleteConnection(adminId: string, connectionId: string): Promise<void> {
  await requireAdmin(adminId);
  const account = await getPrisma().aiConnection.delete({ where: { id: connectionId } });
  // The legacy key is never a fallback after its primary account is removed.
  if (account.id === `${account.providerId}-primary`) {
    await getPrisma().aiProvider.update({
      where: { id: account.providerId },
      data: { encryptedApiKey: null }
    });
  }
  await recordAudit({ actorId: adminId, action: 'admin.ai.account.delete', target: account.name });
}

export async function setConnectionEnabled(
  adminId: string,
  connectionId: string,
  isActive: boolean
): Promise<void> {
  await requireAdmin(adminId);
  const account = await getPrisma().aiConnection.update({
    where: { id: connectionId },
    data: { isActive }
  });
  await recordAudit({
    actorId: adminId,
    action: 'admin.ai.account.update',
    target: account.name,
    details: { isActive }
  });
}

export async function clearConnectionCooldown(
  adminId: string,
  connectionId: string
): Promise<void> {
  await requireAdmin(adminId);
  await getPrisma().aiConnection.update({
    where: { id: connectionId },
    data: { rateLimitedUntil: null, modelLocks: {}, lastError: null, lastErrorAt: null }
  });
}

export async function getRouterSettings(adminId: string): Promise<AiRouterSettings> {
  await requireAdmin(adminId);
  return (
    (await getPrisma().aiRouterSettings.findUnique({ where: { id: 'default' } })) ?? {
      defaultModel: null,
      compressToolOutput: true,
      maxToolOutputChars: 30000
    }
  );
}

export async function saveRouterSettings(
  adminId: string,
  settings: AiRouterSettings
): Promise<void> {
  await requireAdmin(adminId);
  const data = { ...settings, defaultModel: settings.defaultModel?.trim() || null };
  await getPrisma().aiRouterSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...data },
    update: data
  });
  await recordAudit({ actorId: adminId, action: 'admin.ai.settings.update', target: 'AI router' });
}
