'use server';

import {
  AiRouterError,
  connectFreeProvider,
  clearProviderCooldown,
  createApiKey,
  deleteApiKey,
  deleteCombo,
  deleteProvider,
  fetchProviderModels,
  saveCombo,
  saveProvider,
  setProviderEnabled,
  saveConnection,
  deleteConnection,
  setConnectionEnabled,
  clearConnectionCooldown,
  saveRouterSettings
} from '@/features/ai-router/service';
import {
  comboSchema,
  fetchModelsSchema,
  providerSchema,
  connectionSchema,
  routerSettingsSchema
} from '@/features/ai-router/schema';
import { requireUser } from '@/lib/auth/session';
import { DEMO_DISABLED_MESSAGE, isDemoMode } from '@/lib/demo';
import { z } from 'zod';
import { connectOAuthProvider } from './oauth-service';

export type AiRouterResult = { ok: true; providerId?: string } | { ok: false; error: string };

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  return { ok: false, error: error instanceof AiRouterError ? error.message : fallback };
}

const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? 'Check the form';

export async function connectOAuthProviderAction(
  input: unknown
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const parsed = z.enum(['claude', 'codex']).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid OAuth provider' };
  const user = await requireUser();
  if (isDemoMode()) return { ok: false, error: DEMO_DISABLED_MESSAGE };
  try {
    const url = await connectOAuthProvider(user.id, parsed.data);
    return { ok: true, url };
  } catch (error) {
    return fail(error, 'Could not start provider sign-in');
  }
}

export async function connectFreeProviderAction(): Promise<AiRouterResult> {
  const user = await requireUser();
  if (isDemoMode()) return { ok: false, error: DEMO_DISABLED_MESSAGE };
  try {
    return { ok: true, providerId: await connectFreeProvider(user.id) };
  } catch (error) {
    return fail(error, 'Could not set up OpenCode Free');
  }
}

async function run(
  work: (userId: string) => Promise<unknown>,
  fallback: string
): Promise<AiRouterResult> {
  const user = await requireUser();
  if (isDemoMode()) return { ok: false, error: DEMO_DISABLED_MESSAGE };
  try {
    await work(user.id);
    // Gateway mutations invalidate their queries; avoid racing tab navigation with RSC refreshes.
    return { ok: true };
  } catch (error) {
    return fail(error, fallback);
  }
}

export async function saveProviderAction(input: unknown): Promise<AiRouterResult> {
  const parsed = providerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const user = await requireUser();
  if (isDemoMode()) return { ok: false, error: DEMO_DISABLED_MESSAGE };
  try {
    const providerId = await saveProvider(user.id, parsed.data);
    return { ok: true, providerId };
  } catch (error) {
    return fail(error, 'Could not save the provider');
  }
}

export async function setProviderEnabledAction(input: unknown): Promise<AiRouterResult> {
  const parsed = z.object({ providerId: z.string().min(1), enabled: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid provider' };
  const { providerId, enabled } = parsed.data;
  return run(
    (userId) => setProviderEnabled(userId, providerId, enabled),
    'Could not update the provider'
  );
}

export async function clearProviderCooldownAction(input: unknown): Promise<AiRouterResult> {
  const parsed = z.object({ providerId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid provider' };
  return run(
    (userId) => clearProviderCooldown(userId, parsed.data.providerId),
    'Could not update the provider'
  );
}

export async function deleteProviderAction(input: unknown): Promise<AiRouterResult> {
  const parsed = z.object({ providerId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid provider' };
  return run(
    (userId) => deleteProvider(userId, parsed.data.providerId),
    'Could not remove the provider'
  );
}

export async function fetchProviderModelsAction(
  input: unknown
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  const user = await requireUser();
  if (isDemoMode()) return { ok: false, error: DEMO_DISABLED_MESSAGE };
  const parsed = fetchModelsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Enter the base URL' };
  try {
    return { ok: true, models: await fetchProviderModels(user.id, parsed.data) };
  } catch (error) {
    return fail(error, 'Could not list the models');
  }
}

export async function saveComboAction(input: unknown): Promise<AiRouterResult> {
  const parsed = comboSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  return run((userId) => saveCombo(userId, parsed.data), 'Could not save the combo');
}

export async function deleteComboAction(input: unknown): Promise<AiRouterResult> {
  const parsed = z.object({ comboId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid combo' };
  return run((userId) => deleteCombo(userId, parsed.data.comboId), 'Could not remove the combo');
}

export async function createApiKeyAction(
  input: unknown
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (isDemoMode()) return { ok: false, error: DEMO_DISABLED_MESSAGE };
  const parsed = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Enter a name of at most 60 characters' };
  try {
    const key = await createApiKey(user.id, parsed.data.name);
    return { ok: true, key };
  } catch (error) {
    return fail(error, 'Could not create the key');
  }
}

export async function deleteApiKeyAction(input: unknown): Promise<AiRouterResult> {
  const parsed = z.object({ keyId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid key' };
  return run((userId) => deleteApiKey(userId, parsed.data.keyId), 'Could not delete the key');
}

export async function saveConnectionAction(input: unknown): Promise<AiRouterResult> {
  const parsed = connectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  return run((userId) => saveConnection(userId, parsed.data), 'Could not save the account');
}

export async function deleteConnectionAction(input: unknown): Promise<AiRouterResult> {
  const parsed = z.object({ connectionId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid account' };
  return run(
    (userId) => deleteConnection(userId, parsed.data.connectionId),
    'Could not remove the account'
  );
}

export async function setConnectionEnabledAction(input: unknown): Promise<AiRouterResult> {
  const parsed = z
    .object({ connectionId: z.string().min(1), isActive: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid account' };
  return run(
    (userId) => setConnectionEnabled(userId, parsed.data.connectionId, parsed.data.isActive),
    'Could not update the account'
  );
}

export async function clearConnectionCooldownAction(input: unknown): Promise<AiRouterResult> {
  const parsed = z.object({ connectionId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid account' };
  return run(
    (userId) => clearConnectionCooldown(userId, parsed.data.connectionId),
    'Could not update the account'
  );
}

export async function saveRouterSettingsAction(input: unknown): Promise<AiRouterResult> {
  const parsed = routerSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  return run((userId) => saveRouterSettings(userId, parsed.data), 'Could not save router settings');
}
