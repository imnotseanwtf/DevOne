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
import { assertSafeProviderUrl, UnsafeProviderUrlError } from '@/lib/ai-router/safe-url';
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

async function assertSafeUrl(baseUrl: string) {
  try {
    await assertSafeProviderUrl(baseUrl);
  } catch (error) {
    if (error instanceof UnsafeProviderUrlError) throw new AiRouterError(error.message);
    throw error;
  }
}

async function requireAdmin(userId: string) {
  const user = await getPrisma().user.findUnique({
    where: { id: userId },
    select: { role: true }
  });
  if (user?.role !== UserRole.ADMIN) throw new AiRouterError('Administrators only');
}

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
}

/** Everything one request needs, keys decrypted only when that provider is tried. */
export async function loadRouterState(): Promise<RouterState> {
  const [providers, combos] = await Promise.all([
    getPrisma().aiProvider.findMany(),
    getPrisma().aiCombo.findMany({ select: { name: true, steps: true } })
  ]);
  const encrypted = new Map(providers.map((provider) => [provider.id, provider.encryptedApiKey]));
  return {
    providers: providers.map(({ id, name, baseUrl, models, priority, enabled, cooldownUntil }) => ({
      id,
      name,
      baseUrl,
      models,
      priority,
      enabled,
      cooldownUntil
    })),
    combos: combos.map((combo) => ({
      name: combo.name,
      steps: readSteps(combo.steps)
    })),
    apiKeyFor: (providerId) => {
      const value = encrypted.get(providerId);
      return value ? decryptSecret(value, getEncryptionKey()) : null;
    }
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
      .aiApiKey.update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() }
      })
      .catch(() => undefined);
  }
  return { userId: record.userId, apiKeyId: record.id };
}

/** Rests a provider after a failure so the next requests go elsewhere first. */
export async function recordProviderFailure(failure: AttemptFailure): Promise<void> {
  const rest = cooldownMs(failure.status, failure.retryAfter);
  const label = failure.status ? `HTTP ${failure.status}: ${failure.error}` : failure.error;
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
          providerName: provider?.name ?? null,
          requestedModel: requestedModel.slice(0, 200),
          model: outcome.target?.model.slice(0, 200) ?? null,
          status: outcome.status,
          attempts: outcome.attempts,
          promptTokens: outcome.usage.promptTokens,
          completionTokens: outcome.usage.completionTokens,
          latencyMs: Date.now() - startedAt,
          savedChars: savedChars > 0 ? savedChars : null,
          error: outcome.error?.slice(0, 500) ?? null
        }
      })
      .catch(() => undefined),
    // An answer means the provider is healthy again.
    provider && outcome.status < 400
      ? prisma.aiProvider
          .update({
            where: { id: provider.id },
            data: { cooldownUntil: null, lastError: null }
          })
          .catch(() => undefined)
      : undefined
  ]);
}

// ---------------------------------------------------------------------------
// Router settings

export interface RouterSettings {
  defaultModel: string | null;
  compressToolOutput: boolean;
  maxToolOutputChars: number;
}

const DEFAULT_SETTINGS: RouterSettings = {
  defaultModel: null,
  compressToolOutput: true,
  maxToolOutputChars: 30_000
};

export async function loadRouterSettings(): Promise<RouterSettings> {
  const row = await getPrisma().aiRouterSettings.findUnique({
    where: { id: 'default' }
  });
  return row
    ? {
        defaultModel: row.defaultModel,
        compressToolOutput: row.compressToolOutput,
        maxToolOutputChars: row.maxToolOutputChars
      }
    : DEFAULT_SETTINGS;
}

export async function saveRouterSettings(adminId: string, input: RouterSettings) {
  await requireAdmin(adminId);
  const data = { ...input, defaultModel: input.defaultModel?.trim() || null };
  await getPrisma().aiRouterSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...data },
    update: data
  });
  await recordAudit({
    actorId: adminId,
    action: 'admin.ai.settings',
    target: 'default'
  });
}

// ---------------------------------------------------------------------------
// Administration

export async function listProviders(adminId: string) {
  await requireAdmin(adminId);
  const providers = await getPrisma().aiProvider.findMany({
    orderBy: [{ priority: 'asc' }, { name: 'asc' }]
  });
  return providers.map(({ encryptedApiKey, ...provider }) => ({
    ...provider,
    hasApiKey: encryptedApiKey !== null
  }));
}

export type AiProviderSummary = Awaited<ReturnType<typeof listProviders>>[number];

export async function saveProvider(adminId: string, input: ProviderInput) {
  await requireAdmin(adminId);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!baseUrl) throw new AiRouterError('Enter an http:// or https:// base URL');
  await assertSafeUrl(baseUrl);
  if (input.name.trim().toLowerCase() === AUTO_MODEL) {
    throw new AiRouterError(`"${AUTO_MODEL}" is reserved`);
  }
  const prisma = getPrisma();
  const clash = await prisma.aiProvider.findFirst({
    where: {
      name: { equals: input.name, mode: 'insensitive' },
      NOT: { id: input.id ?? '' }
    },
    select: { id: true }
  });
  if (clash) throw new AiRouterError('Another provider has that name');

  const models = [...new Set(input.models)];
  const apiKey = input.apiKey
    ? encryptSecret(input.apiKey, getEncryptionKey())
    : input.clearApiKey
      ? null
      : undefined;
  const data = {
    name: input.name,
    baseUrl,
    models,
    priority: input.priority,
    enabled: input.enabled
  };

  if (input.id) {
    const existing = await prisma.aiProvider.findUnique({
      where: { id: input.id }
    });
    if (!existing) throw new AiRouterError('Provider not found');
    await prisma.aiProvider.update({
      where: { id: input.id },
      data: {
        ...data,
        ...(apiKey !== undefined ? { encryptedApiKey: apiKey } : {}),
        // New settings deserve a fresh try.
        cooldownUntil: null,
        lastError: null
      }
    });
  } else {
    await prisma.aiProvider.create({
      data: { ...data, encryptedApiKey: apiKey ?? null }
    });
  }
  await recordAudit({
    actorId: adminId,
    action: input.id ? 'admin.ai.provider.update' : 'admin.ai.provider.add',
    target: input.name
  });
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
}

export async function deleteProvider(adminId: string, providerId: string) {
  await requireAdmin(adminId);
  const prisma = getPrisma();
  const provider = await prisma.aiProvider.delete({
    where: { id: providerId }
  });
  // Drop the provider from every combo that used it.
  const combos = await prisma.aiCombo.findMany();
  await Promise.all(
    combos.map((combo) => {
      const steps = readSteps(combo.steps);
      const kept = steps.filter((step) => step.providerId !== providerId);
      return kept.length === steps.length
        ? undefined
        : prisma.aiCombo.update({
            where: { id: combo.id },
            data: { steps: kept }
          });
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
  input: { providerId?: string; baseUrl: string; apiKey?: string },
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  await requireAdmin(adminId);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!baseUrl) throw new AiRouterError('Enter an http:// or https:// base URL');
  await assertSafeUrl(baseUrl);
  let apiKey = input.apiKey || null;
  if (!apiKey && input.providerId) {
    const saved = await getPrisma().aiProvider.findUnique({
      where: { id: input.providerId },
      select: { encryptedApiKey: true }
    });
    apiKey = saved?.encryptedApiKey
      ? decryptSecret(saved.encryptedApiKey, getEncryptionKey())
      : null;
  }
  let response: Response;
  try {
    response = await fetchImpl(providerUrl(baseUrl, 'models'), {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new AiRouterError('Could not reach the provider');
  }
  if (response.status === 401 || response.status === 403) {
    throw new AiRouterError('The provider refused the API key');
  }
  if (!response.ok) throw new AiRouterError(`The provider answered HTTP ${response.status}`);
  const models = parseModelList(await response.json().catch(() => null));
  if (models.length === 0) throw new AiRouterError('The provider listed no models');
  return models;
}

export async function listCombos(adminId: string) {
  await requireAdmin(adminId);
  const combos = await getPrisma().aiCombo.findMany({
    orderBy: { name: 'asc' }
  });
  return combos.map((combo) => ({
    id: combo.id,
    name: combo.name,
    steps: readSteps(combo.steps)
  }));
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
  await recordAudit({
    actorId: adminId,
    action: 'admin.ai.combo.delete',
    target: combo.name
  });
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
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      createdAt: true
    },
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
  await prisma.aiApiKey.create({
    data: { userId, name, tokenHash: hash, prefix }
  });
  await recordAudit({
    actorId: userId,
    action: 'account.ai_key.create',
    target: name
  });
  return key;
}

export async function deleteApiKey(userId: string, keyId: string) {
  const { count } = await getPrisma().aiApiKey.deleteMany({
    where: { id: keyId, userId }
  });
  if (count === 0) throw new AiRouterError('Key not found');
  await recordAudit({ actorId: userId, action: 'account.ai_key.delete' });
}
