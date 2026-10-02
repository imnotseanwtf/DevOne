'use server';

import { devopsSettingsSchema, generalSchema } from '@/features/project-settings/schema';
import {
  leaveProject,
  PrefixTakenError,
  setProductionBranch,
  updateDevopsSettings,
  updateGeneralSettings
} from '@/features/project-settings/service';
import { ProjectAccessError } from '@/features/projects/service';
import { requireUser } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

export type SettingsResult = { ok: true } | { ok: false; error: string };

function fail(error: unknown, fallback: string): SettingsResult {
  if (error instanceof ProjectAccessError || error instanceof PrefixTakenError) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: fallback };
}

const projectId = z.string().min(1);

export async function updateGeneralSettingsAction(input: unknown): Promise<SettingsResult> {
  const user = await requireUser();
  const parsed = generalSchema.extend({ projectId }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  const { projectId: id, ...data } = parsed.data;
  try {
    await updateGeneralSettings(user.id, id, data);
    revalidatePath(`/projects/${id}`, 'layout');
    revalidatePath('/projects');
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not save the project');
  }
}

export async function updateDevopsSettingsAction(input: unknown): Promise<SettingsResult> {
  const user = await requireUser();
  const parsed = devopsSettingsSchema.extend({ projectId }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the patterns' };
  const { projectId: id, ...data } = parsed.data;
  try {
    await updateDevopsSettings(user.id, id, data);
    revalidatePath(`/projects/${id}`, 'layout');
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not save the DevOps settings');
  }
}

export async function leaveProjectAction(input: unknown): Promise<SettingsResult> {
  const user = await requireUser();
  const parsed = z.object({ projectId }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid project' };
  try {
    await leaveProject(user.id, parsed.data.projectId);
    revalidatePath('/projects');
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not leave the project');
  }
}

export async function setProductionBranchAction(input: unknown): Promise<SettingsResult> {
  const user = await requireUser();
  const parsed = z
    .object({
      projectId,
      repositoryId: z.string().min(1),
      branch: z.string().trim().max(255).nullable()
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid branch' };
  try {
    await setProductionBranch(
      user.id,
      parsed.data.projectId,
      parsed.data.repositoryId,
      parsed.data.branch || null
    );
    revalidatePath(`/projects/${parsed.data.projectId}`, 'layout');
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not save the production branch');
  }
}
