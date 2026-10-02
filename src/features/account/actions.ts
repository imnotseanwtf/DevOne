'use server';

import { preferencesSchema } from '@/features/account/preferences';
import {
  AccountError,
  connectAccount,
  removeConnection,
  revokeOtherSessions,
  revokeSession,
  savePreferences
} from '@/features/account/service';
import {
  deleteSshHost,
  renameSshHost,
  resetSshHostKey,
  SshHostAccessError
} from '@/features/devops/ssh-service';
import { getCurrentSessionId, requireUser, setLocaleCookie } from '@/lib/auth/session';
import { SshConnectError } from '@/lib/ssh/connection';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';

export type AccountResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (
    error instanceof AccountError ||
    error instanceof SshHostAccessError ||
    error instanceof SshConnectError
  ) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: fallback };
}

const refresh = () => revalidatePath('/account');

export async function savePreferencesAction(input: unknown): Promise<AccountResult> {
  const user = await requireUser();
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid preferences' };
  await savePreferences(user.id, parsed.data);
  setLocaleCookie(await cookies(), parsed.data.locale);
  // The language changes every page, not just this one.
  revalidatePath('/', 'layout');
  return { ok: true };
}

const connectSchema = z.object({
  provider: z.enum(['github', 'gitlab']),
  token: z.string().trim().min(1, 'Enter a token').max(1000),
  gitlabBaseUrl: z.string().trim().max(300).optional()
});

export async function connectAccountAction(
  input: unknown
): Promise<AccountResult<{ username: string; replaced: boolean }>> {
  const user = await requireUser();
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  try {
    const result = await connectAccount(user.id, parsed.data);
    refresh();
    return { ok: true, ...result };
  } catch (error) {
    return fail(error, 'Could not connect the account');
  }
}

export async function removeConnectionAction(input: unknown): Promise<AccountResult> {
  const user = await requireUser();
  const parsed = z.object({ connectionId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid connection' };
  try {
    await removeConnection(user.id, parsed.data.connectionId);
    refresh();
    revalidatePath('/projects', 'layout');
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not remove the connection');
  }
}

const hostSchema = z.object({ hostId: z.string().min(1) });

export async function renameSshHostAction(input: unknown): Promise<AccountResult> {
  const user = await requireUser();
  const parsed = hostSchema.extend({ name: z.string().trim().min(1).max(80) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Enter a name' };
  try {
    await renameSshHost(user.id, parsed.data.hostId, parsed.data.name);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not rename the server');
  }
}

export async function resetSshHostKeyAction(input: unknown): Promise<AccountResult> {
  const user = await requireUser();
  const parsed = hostSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid server' };
  try {
    await resetSshHostKey(user.id, parsed.data.hostId);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not reset the host key');
  }
}

export async function deleteSavedSshHostAction(input: unknown): Promise<AccountResult> {
  const user = await requireUser();
  const parsed = hostSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid server' };
  try {
    await deleteSshHost(user.id, parsed.data.hostId);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not remove the server');
  }
}

export async function revokeSessionAction(input: unknown): Promise<AccountResult> {
  const user = await requireUser();
  const parsed = z.object({ sessionId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid session' };
  if (parsed.data.sessionId === (await getCurrentSessionId())) {
    return { ok: false, error: 'Use Sign out for this device' };
  }
  try {
    await revokeSession(user.id, parsed.data.sessionId);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not sign out that session');
  }
}

export async function revokeOtherSessionsAction(): Promise<AccountResult<{ count: number }>> {
  const user = await requireUser();
  const current = await getCurrentSessionId();
  if (!current) return { ok: false, error: 'Sign in again' };
  const count = await revokeOtherSessions(user.id, current);
  refresh();
  return { ok: true, count };
}
