'use server';

import {
  AiRouterError,
  clearProviderCooldown,
  createApiKey,
  deleteApiKey,
  deleteCombo,
  deleteProvider,
  fetchProviderModels,
  saveCombo,
  saveRouterSettings,
  saveProvider,
  setProviderEnabled
} from '@/features/ai-router/service';
import {
  comboSchema,
  fetchModelsSchema,
  providerSchema,
  routerSettingsSchema
} from '@/features/ai-router/schema';
import { requireUser } from '@/lib/auth/session';
import { DEMO_DISABLED_MESSAGE, isDemoMode } from '@/lib/demo';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

export type AiRouterResult = { ok: true } | { ok: false; error: string };

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof AiRouterError ? error.message : fallback
  };
}

const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? 'Check the form';

async function run(
  work: (userId: string) => Promise<unknown>,
  fallback: string,
  path = '/admin'
): Promise<AiRouterResult> {
  const user = await requireUser();
  if (isDemoMode()) return { ok: false, error: DEMO_DISABLED_MESSAGE };
  try {
    await work(user.id);
    revalidatePath(path);
    return { ok: true };
  } catch (error) {
    return fail(error, fallback);
  }
}

export async function saveProviderAction(input: unknown): Promise<AiRouterResult> {
  const parsed = providerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  return run((userId) => saveProvider(userId, parsed.data), 'Could not save the provider');
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
    return {
      ok: true,
      models: await fetchProviderModels(user.id, parsed.data)
    };
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
    revalidatePath('/account');
    return { ok: true, key };
  } catch (error) {
    return fail(error, 'Could not create the key');
  }
}

export async function deleteApiKeyAction(input: unknown): Promise<AiRouterResult> {
  const parsed = z.object({ keyId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid key' };
  return run(
    (userId) => deleteApiKey(userId, parsed.data.keyId),
    'Could not delete the key',
    '/account'
  );
}

export async function saveRouterSettingsAction(input: unknown): Promise<AiRouterResult> {
  const parsed = routerSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  return run((userId) => saveRouterSettings(userId, parsed.data), 'Could not save the settings');
}
