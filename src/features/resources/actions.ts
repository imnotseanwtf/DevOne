'use server';

import {
  accountIdSchema,
  headerIdSchema,
  providerBranchesSchema,
  resourceAccountSchema,
  resourceAuthSchema,
  resourceHeaderSchema,
  resourceIdSchema,
  createResourceSchema,
  resourceVariableSchema,
  updateResourceSchema,
  variableIdSchema,
  type ResourceActionResult
} from '@/features/resources/schema';
import {
  createResource,
  deleteResource,
  deleteResourceAccount,
  deleteResourceHeader,
  deleteResourceVariable,
  exportResourceEnv,
  ResourceAccessError,
  revealResourceAccountPassword,
  revealResourceVariable,
  saveResourceAccount,
  setResourceAuth,
  setResourceHeader,
  setResourceVariable,
  updateResource
} from '@/features/resources/service';
import { listProviderBranches } from '@/features/git/service';
import { requireUser } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';

function describe(error: unknown, fallback: string): string {
  return error instanceof ResourceAccessError ? error.message : fallback;
}

/** Resources are the environments of the API client and databases too. */
function revalidateProject(projectId: string) {
  revalidatePath(`/projects/${projectId}/resources`);
  revalidatePath(`/projects/${projectId}/api`);
  revalidatePath(`/projects/${projectId}/database`);
}

export async function createResourceAction(input: unknown): Promise<ResourceActionResult> {
  const user = await requireUser();
  const parsed = createResourceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid resource' };
  }

  try {
    await createResource(user.id, parsed.data);
    revalidateProject(parsed.data.projectId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not save the resource') };
  }
}

export async function updateResourceAction(input: unknown): Promise<ResourceActionResult> {
  const user = await requireUser();
  const parsed = updateResourceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid resource' };
  }

  try {
    const resource = await updateResource(user.id, parsed.data);
    revalidateProject(resource.projectId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not save the resource') };
  }
}

export async function deleteResourceAction(input: unknown): Promise<ResourceActionResult> {
  const user = await requireUser();
  const parsed = resourceIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a resource' };

  try {
    const projectId = await deleteResource(user.id, parsed.data.resourceId);
    revalidateProject(projectId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not remove the resource') };
  }
}

export async function setResourceVariableAction(input: unknown): Promise<ResourceActionResult> {
  const user = await requireUser();
  const parsed = resourceVariableSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid key' };
  }

  try {
    const projectId = await setResourceVariable(user.id, parsed.data);
    revalidateProject(projectId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not save the key') };
  }
}

export async function deleteResourceVariableAction(input: unknown): Promise<ResourceActionResult> {
  const user = await requireUser();
  const parsed = variableIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a key' };

  try {
    const projectId = await deleteResourceVariable(user.id, parsed.data.variableId);
    revalidateProject(projectId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not delete the key') };
  }
}

export interface RevealResult extends ResourceActionResult {
  value?: string;
}

export async function revealResourceVariableAction(input: unknown): Promise<RevealResult> {
  const user = await requireUser();
  const parsed = variableIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a key' };

  try {
    return { ok: true, value: await revealResourceVariable(user.id, parsed.data.variableId) };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not read the key') };
  }
}

export async function exportResourceEnvAction(input: unknown): Promise<RevealResult> {
  const user = await requireUser();
  const parsed = resourceIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a resource' };

  try {
    return { ok: true, value: await exportResourceEnv(user.id, parsed.data.resourceId) };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not export the keys') };
  }
}

export async function setResourceHeaderAction(input: unknown): Promise<ResourceActionResult> {
  const user = await requireUser();
  const parsed = resourceHeaderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid header' };
  }

  try {
    const projectId = await setResourceHeader(user.id, parsed.data);
    revalidateProject(projectId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not save the header') };
  }
}

export async function deleteResourceHeaderAction(input: unknown): Promise<ResourceActionResult> {
  const user = await requireUser();
  const parsed = headerIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a header' };

  try {
    const projectId = await deleteResourceHeader(user.id, parsed.data.headerId);
    revalidateProject(projectId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not delete the header') };
  }
}

export async function setResourceAuthAction(input: unknown): Promise<ResourceActionResult> {
  const user = await requireUser();
  const parsed = resourceAuthSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid auth' };

  try {
    const projectId = await setResourceAuth(user.id, parsed.data.resourceId, parsed.data.auth);
    revalidateProject(projectId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not save the auth') };
  }
}

export async function saveResourceAccountAction(input: unknown): Promise<ResourceActionResult> {
  const user = await requireUser();
  const parsed = resourceAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid account' };
  }
  if (!parsed.data.accountId && !parsed.data.password) {
    return { ok: false, error: 'Enter the password' };
  }

  try {
    const projectId = await saveResourceAccount(user.id, {
      ...parsed.data,
      notes: parsed.data.notes ?? null
    });
    revalidateProject(projectId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not save the account') };
  }
}

export async function deleteResourceAccountAction(input: unknown): Promise<ResourceActionResult> {
  const user = await requireUser();
  const parsed = accountIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select an account' };

  try {
    const projectId = await deleteResourceAccount(user.id, parsed.data.accountId);
    revalidateProject(projectId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not delete the account') };
  }
}

export async function revealResourceAccountPasswordAction(input: unknown): Promise<RevealResult> {
  const user = await requireUser();
  const parsed = accountIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select an account' };

  try {
    return { ok: true, value: await revealResourceAccountPassword(user.id, parsed.data.accountId) };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not read the password') };
  }
}

export interface BranchesResult extends ResourceActionResult {
  branches?: string[];
}

/** Branches of one of the person's repositories that isn't in the project yet. */
export async function listProviderBranchesAction(input: unknown): Promise<BranchesResult> {
  const user = await requireUser();
  const parsed = providerBranchesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a repository' };

  try {
    const branches = await listProviderBranches(
      user.id,
      parsed.data.connectionId,
      parsed.data.providerRepositoryId
    );
    return { ok: true, branches: branches.map((branch) => branch.name) };
  } catch {
    return { ok: false, error: 'Could not read the branches' };
  }
}
