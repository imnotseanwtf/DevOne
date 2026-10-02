'use server';

import { AdminError, setUserDisabled, setUserRole } from '@/features/admin/service';
import { UserRole } from '@/generated/prisma/client';
import { requireUser } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

export type AdminResult = { ok: true } | { ok: false; error: string };

function fail(error: unknown, fallback: string): AdminResult {
  return { ok: false, error: error instanceof AdminError ? error.message : fallback };
}

export async function setUserRoleAction(input: unknown): Promise<AdminResult> {
  const admin = await requireUser();
  const parsed = z.object({ userId: z.string().min(1), role: z.enum(UserRole) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid role' };
  try {
    await setUserRole(admin.id, parsed.data.userId, parsed.data.role);
    revalidatePath('/admin');
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not change the role');
  }
}

export async function setUserDisabledAction(input: unknown): Promise<AdminResult> {
  const admin = await requireUser();
  const parsed = z.object({ userId: z.string().min(1), disabled: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid user' };
  try {
    await setUserDisabled(admin.id, parsed.data.userId, parsed.data.disabled);
    revalidatePath('/admin');
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not update the user');
  }
}
