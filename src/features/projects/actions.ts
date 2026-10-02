'use server';

import {
  projectSchema,
  type ProjectActionResult,
  type ProjectInput
} from '@/features/projects/schema';
import {
  addProjectMemberByUsername,
  createProjectForUser,
  deleteProjectForUser,
  getProjectPanelInfo,
  ProjectAccessError,
  removeProjectMember,
  updateProjectForUser,
  updateProjectMemberRole,
  type ProjectPanelInfo
} from '@/features/projects/service';
import { ProjectRole } from '@/generated/prisma/client';
import { recordAudit } from '@/lib/audit/record';
import { requireUser } from '@/lib/auth/session';
import { getPrisma } from '@/lib/db/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

function fail(error: unknown, fallback: string): ProjectActionResult {
  if (error instanceof ProjectAccessError) return { ok: false, error: error.message };
  return { ok: false, error: fallback };
}

async function usernameOf(userId: string): Promise<string | null> {
  const user = await getPrisma().user.findUnique({
    where: { id: userId },
    select: { username: true }
  });
  return user?.username ?? null;
}

function refreshProjects() {
  revalidatePath('/dashboard/overview');
  revalidatePath('/projects');
}

export async function createProjectAction(input: ProjectInput): Promise<ProjectActionResult> {
  const user = await requireUser();
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid project' };
  }

  try {
    await createProjectForUser(user.id, parsed.data);
    refreshProjects();
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not create the project' };
  }
}

const updateProjectSchema = projectSchema.extend({ projectId: z.string().min(1) });

export async function updateProjectAction(input: unknown): Promise<ProjectActionResult> {
  const user = await requireUser();
  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid project' };
  }
  const { projectId, ...data } = parsed.data;
  try {
    await updateProjectForUser(user.id, projectId, data);
    await recordAudit({ actorId: user.id, projectId, action: 'project.update', target: data.name });
    refreshProjects();
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not update the project');
  }
}

export async function deleteProjectAction(input: unknown): Promise<ProjectActionResult> {
  const user = await requireUser();
  const parsed = z.object({ projectId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid project' };
  try {
    const deleted = await deleteProjectForUser(user.id, parsed.data.projectId);
    // Recorded without the project: its own events went with it.
    await recordAudit({ actorId: user.id, action: 'project.delete', target: deleted.name });
    refreshProjects();
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not delete the project');
  }
}

const memberSchema = z.object({
  projectId: z.string().min(1),
  username: z.string().trim().min(1, 'Enter a username').max(80),
  role: z.enum(ProjectRole).default(ProjectRole.MEMBER)
});

export async function addProjectMemberAction(input: unknown): Promise<ProjectActionResult> {
  const user = await requireUser();
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid member' };
  }
  try {
    await addProjectMemberByUsername(
      user.id,
      parsed.data.projectId,
      parsed.data.username,
      parsed.data.role
    );
    await recordAudit({
      actorId: user.id,
      projectId: parsed.data.projectId,
      action: 'project.member.add',
      target: parsed.data.username,
      details: { role: parsed.data.role }
    });
    refreshProjects();
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not add the member');
  }
}

const roleSchema = z.object({
  projectId: z.string().min(1),
  memberUserId: z.string().min(1),
  role: z.enum(ProjectRole)
});

export async function updateProjectMemberRoleAction(input: unknown): Promise<ProjectActionResult> {
  const user = await requireUser();
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid role' };
  try {
    await updateProjectMemberRole(
      user.id,
      parsed.data.projectId,
      parsed.data.memberUserId,
      parsed.data.role
    );
    await recordAudit({
      actorId: user.id,
      projectId: parsed.data.projectId,
      action: 'project.member.role',
      target: await usernameOf(parsed.data.memberUserId),
      details: { role: parsed.data.role }
    });
    refreshProjects();
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not update the role');
  }
}

const removeMemberSchema = z.object({
  projectId: z.string().min(1),
  memberUserId: z.string().min(1)
});

export async function removeProjectMemberAction(input: unknown): Promise<ProjectActionResult> {
  const user = await requireUser();
  const parsed = removeMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid member' };
  try {
    const target = await usernameOf(parsed.data.memberUserId);
    await removeProjectMember(user.id, parsed.data.projectId, parsed.data.memberUserId);
    await recordAudit({
      actorId: user.id,
      projectId: parsed.data.projectId,
      action: 'project.member.remove',
      target
    });
    refreshProjects();
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not remove the member');
  }
}

export type ProjectPanelResult =
  | { ok: true; info: ProjectPanelInfo }
  | { ok: false; error: string };

/** Sidebar details panel: only the selected project, membership-checked. */
export async function getProjectPanelInfoAction(projectId: unknown): Promise<ProjectPanelResult> {
  const user = await requireUser();
  const parsed = z.string().min(1).safeParse(projectId);
  if (!parsed.success) return { ok: false, error: 'Invalid project' };
  try {
    const info = await getProjectPanelInfo(user.id, parsed.data);
    return { ok: true, info };
  } catch (error) {
    return fail(error, 'Could not load the project') as { ok: false; error: string };
  }
}
