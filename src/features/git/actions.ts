'use server';

import {
  getRepositoryFile,
  getRepositoryTree,
  linkRepositoryToNewProject,
  linkRepositoryToProject,
  listConnectionsForUser,
  listProviderRepositories,
  RepositoryAccessError,
  unlinkRepositoryFromProject,
  createRepositoryBranch,
  createRepositoryFile,
  deleteRepositoryFile,
  updateRepositoryFile
} from '@/features/git/service';
import type { LinkableRepository } from '@/features/git/components/link-repository-form';
import { recordAudit } from '@/lib/audit/record';
import { requireUser } from '@/lib/auth/session';
import {
  ProviderAuthenticationError,
  ProviderConflictError,
  type GitFileContent,
  type GitTreeEntry
} from '@/lib/git/provider';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

export interface GitActionResult {
  ok: boolean;
  error?: string;
  projectId?: string;
  /** True when an existing project already had this repo — the caller was
   * added to it as a member instead of a new project being created. */
  joined?: boolean;
}

const linkSchema = z.object({
  projectId: z.string().min(1),
  connectionId: z.string().min(1),
  providerRepositoryId: z.string().min(1)
});

export async function linkRepositoryAction(input: unknown): Promise<GitActionResult> {
  const user = await requireUser();
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a repository to link' };

  try {
    await linkRepositoryToProject(
      user.id,
      parsed.data.projectId,
      parsed.data.connectionId,
      parsed.data.providerRepositoryId
    );
    revalidatePath(`/projects/${parsed.data.projectId}/git`);
    revalidatePath('/projects');
    return { ok: true };
  } catch (error) {
    if (error instanceof RepositoryAccessError) return { ok: false, error: 'Repository not found' };
    if (error instanceof ProviderAuthenticationError) {
      return { ok: false, error: 'Your stored token was rejected. Sign in again.' };
    }
    return { ok: false, error: 'Could not link the repository' };
  }
}

const unlinkSchema = z.object({
  projectId: z.string().min(1),
  repositoryId: z.string().min(1)
});

export async function unlinkRepositoryAction(input: unknown): Promise<GitActionResult> {
  const user = await requireUser();
  const parsed = unlinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a repository to remove' };

  try {
    const fullName = await unlinkRepositoryFromProject(
      user.id,
      parsed.data.projectId,
      parsed.data.repositoryId
    );
    await recordAudit({
      actorId: user.id,
      projectId: parsed.data.projectId,
      action: 'project.repository.unlink',
      target: fullName
    });
    revalidatePath(`/projects/${parsed.data.projectId}/git`);
    revalidatePath('/projects');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not remove the repository' };
  }
}

const linkNewProjectSchema = z.object({
  connectionId: z.string().min(1),
  providerRepositoryId: z.string().min(1),
  projectName: z.string().trim().min(2).max(80).optional()
});

export async function linkRepositoryToNewProjectAction(input: unknown): Promise<GitActionResult> {
  const user = await requireUser();
  const parsed = linkNewProjectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a repository to link' };

  try {
    const { project, joined } = await linkRepositoryToNewProject(
      user.id,
      parsed.data.connectionId,
      parsed.data.providerRepositoryId,
      parsed.data.projectName
    );
    revalidatePath('/projects');
    revalidatePath('/dashboard/overview');
    revalidatePath(`/projects/${project.id}/git`);
    revalidatePath(`/projects/${project.id}/issues`);
    return { ok: true, projectId: project.id, joined };
  } catch (error) {
    if (error instanceof RepositoryAccessError) return { ok: false, error: 'Repository not found' };
    if (error instanceof ProviderAuthenticationError) {
      return { ok: false, error: 'Your stored token was rejected. Sign in again.' };
    }
    return { ok: false, error: 'Could not create the project from this repository' };
  }
}

export type LinkableReposResult =
  | { ok: true; repositories: LinkableRepository[] }
  | { ok: false; error: string };

/** Every repository the user's tokens can reach, for pickers and dialogs. */
export async function listAllProviderRepositoriesAction(): Promise<LinkableReposResult> {
  const user = await requireUser();
  try {
    const connections = await listConnectionsForUser(user.id);
    const repositories = (
      await Promise.all(
        connections.map(async (connection) => {
          const repos = await listProviderRepositories(user.id, connection.id).catch(() => []);
          return repos.map((repository) => ({
            connectionId: connection.id,
            providerRepositoryId: repository.providerRepositoryId,
            fullName: repository.fullName
          }));
        })
      )
    ).flat();
    return { ok: true, repositories };
  } catch {
    return { ok: false, error: 'Could not reach the Git provider' };
  }
}

const treeSchema = z.object({
  repositoryId: z.string().min(1),
  path: z.string().max(1000),
  ref: z.string().min(1).max(255)
});

export type RepositoryTreeResult =
  | { ok: true; entries: GitTreeEntry[] }
  | { ok: false; error: string };

/** One directory level, loaded lazily as the workbench explorer expands. */
export async function listRepositoryTreeAction(input: unknown): Promise<RepositoryTreeResult> {
  const user = await requireUser();
  const parsed = treeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid folder' };

  try {
    const entries = await getRepositoryTree(
      user.id,
      parsed.data.repositoryId,
      parsed.data.path,
      parsed.data.ref
    );
    return { ok: true, entries };
  } catch (error) {
    if (error instanceof ProviderAuthenticationError) {
      return { ok: false, error: 'Your stored token was rejected. Sign in again.' };
    }
    return { ok: false, error: 'Could not read this folder' };
  }
}

const fileSchema = treeSchema.extend({ path: z.string().min(1).max(1000) });

export type RepositoryFileResult =
  | { ok: true; file: GitFileContent }
  | { ok: false; error: string };

export async function readRepositoryFileAction(input: unknown): Promise<RepositoryFileResult> {
  const user = await requireUser();
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid file' };

  try {
    const file = await getRepositoryFile(
      user.id,
      parsed.data.repositoryId,
      parsed.data.path,
      parsed.data.ref
    );
    return { ok: true, file };
  } catch (error) {
    if (error instanceof ProviderAuthenticationError) {
      return { ok: false, error: 'Your stored token was rejected. Sign in again.' };
    }
    return { ok: false, error: 'Could not open this file on this branch' };
  }
}

const commitMessage = z.string().trim().min(1).max(500);
const branchName = z.string().min(1).max(255);

const saveFileSchema = z.object({
  repositoryId: z.string().min(1),
  path: z.string().min(1).max(1000),
  branch: branchName,
  revision: z.string().min(1).max(255),
  content: z.string().max(512 * 1024),
  message: commitMessage
});

const createFileSchema = saveFileSchema.omit({ revision: true });
const deleteFileSchema = saveFileSchema.omit({ content: true });

export interface SaveRepositoryFileResult {
  ok: boolean;
  revision?: string;
  error?: string;
}

/** Maps a failed write to a message the workbench can show as-is. */
function writeError(error: unknown, path: string, branch: string): SaveRepositoryFileResult {
  if (error instanceof ProviderConflictError) {
    return { ok: false, error: `${path} changed on ${branch} or already exists. Reopen it first.` };
  }
  if (error instanceof ProviderAuthenticationError) {
    return { ok: false, error: 'Your token cannot push to this repository.' };
  }
  if (error instanceof RepositoryAccessError) {
    return { ok: false, error: `${branch} is not writable.` };
  }
  return { ok: false, error: `Could not commit ${path}` };
}

export async function saveRepositoryFileAction(input: unknown): Promise<SaveRepositoryFileResult> {
  const user = await requireUser();
  const parsed = saveFileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Write a commit message first' };

  const { repositoryId, ...update } = parsed.data;
  try {
    const result = await updateRepositoryFile(user.id, repositoryId, update);
    return { ok: true, revision: result.revision };
  } catch (error) {
    return writeError(error, update.path, update.branch);
  }
}

export async function createRepositoryFileAction(
  input: unknown
): Promise<SaveRepositoryFileResult> {
  const user = await requireUser();
  const parsed = createFileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Write a commit message first' };

  const { repositoryId, ...create } = parsed.data;
  try {
    const result = await createRepositoryFile(user.id, repositoryId, create);
    return { ok: true, revision: result.revision };
  } catch (error) {
    return writeError(error, create.path, create.branch);
  }
}

export async function deleteRepositoryFileAction(
  input: unknown
): Promise<SaveRepositoryFileResult> {
  const user = await requireUser();
  const parsed = deleteFileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Write a commit message first' };

  const { repositoryId, ...remove } = parsed.data;
  try {
    await deleteRepositoryFile(user.id, repositoryId, remove);
    return { ok: true };
  } catch (error) {
    return writeError(error, remove.path, remove.branch);
  }
}

const createBranchSchema = z.object({
  repositoryId: z.string().min(1),
  from: branchName,
  // A conservative subset of git's ref-name rules.
  name: z
    .string()
    .trim()
    .min(1, 'Name the branch')
    .max(200)
    .regex(/^[\w.-]+(?:\/[\w.-]+)*$/, 'Use letters, numbers, ".", "-", "_" and "/"')
    .refine(
      (name) => !name.includes('..') && !name.startsWith('.') && !name.endsWith('.lock'),
      'That is not a valid branch name'
    )
});

export async function createRepositoryBranchAction(input: unknown): Promise<GitActionResult> {
  const user = await requireUser();
  const parsed = createBranchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid branch' };
  }

  const { repositoryId, name, from } = parsed.data;
  try {
    await createRepositoryBranch(user.id, repositoryId, name, from);
    return { ok: true };
  } catch (error) {
    if (error instanceof ProviderConflictError) {
      return { ok: false, error: `A branch named ${name} already exists` };
    }
    if (error instanceof ProviderAuthenticationError) {
      return { ok: false, error: 'Your token cannot push to this repository.' };
    }
    return { ok: false, error: `Could not create ${name}` };
  }
}
