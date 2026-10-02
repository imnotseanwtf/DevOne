'use server';

import { IssueFieldKind } from '@/generated/prisma/client';
import {
  addComment,
  archiveIssue,
  createBoard,
  createBoardColumn,
  createIssue,
  createIssueFieldOption,
  createSprint,
  deleteBoard,
  deleteArchivedIssue,
  deleteBoardColumn,
  deleteIssueFieldOption,
  IssueAccessError,
  moveIssueBefore,
  reorderBoardColumns,
  renameBoardColumn,
  renameIssueFieldOption,
  restoreIssue,
  syncIssueLinks,
  updateIssue,
  listIssueHistory,
  listIssueGit,
  listIssueRepositoryBranches,
  listProjectRepositoryBranches,
  linkIssueBranch,
  createIssueBranch,
  unlinkIssueGitLink
} from '@/features/issues/service';
import { ProviderAuthenticationError, ProviderConflictError } from '@/lib/git/provider';
import { linkDrawingToIssue } from '@/features/drawings/service';
import { linkDocToIssue } from '@/features/platform/service';
import { listProjectRepositories } from '@/features/git/service';
import { requireUser } from '@/lib/auth/session';
import { suggestBranchName } from '@/lib/issues/branch-name';
import { revalidatePath } from 'next/cache';
import { STATUS_ICON_NAMES } from '@/features/issues/status-icons';
import { z } from 'zod';

export interface IssueActionResult {
  ok: boolean;
  error?: string;
  detail?: string;
}

function fail(error: unknown, fallback: string): IssueActionResult {
  if (error instanceof IssueAccessError) return { ok: false, error: error.message };
  return { ok: false, error: fallback };
}

/**
 * An optional YYYY-MM-DD target date. Empty or null clears it; left out, it's
 * unchanged. Stored as that day at midnight UTC (the column has no time).
 */
const targetDateSchema = z
  .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date')])
  .nullish()
  .transform((value) =>
    value === undefined ? undefined : value ? new Date(`${value}T00:00:00Z`) : null
  )
  .refine((value) => !value || !Number.isNaN(value.getTime()), 'Pick a valid date');

const branchNameSchema = z
  .string()
  .trim()
  .min(1, 'Name the branch')
  .max(200)
  .regex(/^[\w.-]+(?:\/[\w.-]+)*$/, 'Use letters, numbers, ".", "-", "_" and "/"')
  .refine(
    (name) => !name.includes('..') && !name.startsWith('.') && !name.endsWith('.lock'),
    'That is not a valid branch name'
  );

/** A branch to link, or create and link, once a new task exists. */
const newTaskBranchSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('existing'),
    repositoryId: z.string().min(1, 'Pick a repository'),
    name: z.string().min(1, 'Pick a branch')
  }),
  z.object({
    mode: z.literal('new'),
    repositoryId: z.string().min(1, 'Pick a repository'),
    /** Empty uses the suggested "<KEY>-<title>" name. */
    name: z.union([z.literal(''), branchNameSchema]),
    from: z.string().min(1, 'Pick a branch to start from')
  })
]);

const createIssueSchema = z.object({
  projectId: z.string().min(1),
  boardId: z.string().min(1).optional(),
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().trim().max(10_000).optional(),
  type: z.string().min(1).default('TASK'),
  status: z.string().min(1).default('BACKLOG'),
  priority: z.string().min(1).default('MEDIUM'),
  assigneeId: z.string().min(1).nullish(),
  sprintId: z.string().min(1).nullish(),
  targetDate: targetDateSchema,
  /** Docs to link as soon as the task exists. */
  docIds: z.array(z.string().min(1)).max(50).default([]),
  drawingIds: z.array(z.string().min(1)).max(50).default([]),
  branch: newTaskBranchSchema.nullish()
});

export async function createBoardAction(
  input: unknown
): Promise<IssueActionResult & { boardId?: string }> {
  const user = await requireUser();
  const parsed = z
    .object({
      projectId: z.string().min(1),
      name: z.string().trim().min(2).max(80)
    })
    .safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid board'
    };
  try {
    const board = await createBoard(user.id, parsed.data.projectId, parsed.data.name);
    revalidatePath(`/projects/${parsed.data.projectId}/issues`);
    return { ok: true, boardId: board.id };
  } catch {
    return {
      ok: false,
      error: 'Could not create the board (name may already exist)'
    };
  }
}

export async function createIssueAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = createIssueSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid issue'
    };
  }

  const { docIds, drawingIds, branch, ...issue } = parsed.data;
  let issueId: string;
  let issueKey: string;
  try {
    ({ id: issueId, issueKey } = await createIssue(user.id, issue.projectId, issue));
  } catch (error) {
    return fail(error, 'Could not create the issue');
  }

  // Like doc links, a branch that can't be linked leaves the task created.
  let branchProblem: string | null = null;
  if (branch) {
    const name =
      branch.mode === 'new' && !branch.name
        ? suggestBranchName(issueKey, issue.title)
        : branch.name;
    try {
      if (branch.mode === 'existing') {
        await linkIssueBranch(user.id, issueId, branch.repositoryId, name);
      } else {
        await createIssueBranch(user.id, issueId, branch.repositoryId, name, branch.from);
      }
    } catch (error) {
      branchProblem =
        error instanceof ProviderConflictError
          ? `a branch named ${name} already exists`
          : error instanceof ProviderAuthenticationError
            ? 'your git token can’t push to that repository'
            : error instanceof IssueAccessError
              ? error.message.toLowerCase()
              : `${name} could not be ${branch.mode === 'new' ? 'created' : 'linked'}`;
    }
  }

  // The task exists now; a doc that can't be linked shouldn't make it look failed.
  const unlinked = (
    await Promise.all(
      [
        ...docIds.map((docId) => linkDocToIssue(user.id, issue.projectId, docId, issueId)),
        ...drawingIds.map((drawingId) =>
          linkDrawingToIssue(user.id, issue.projectId, drawingId, issueId)
        )
      ].map((link) =>
        link.then(
          () => 0,
          () => 1
        )
      )
    )
  ).reduce((sum: number, failed) => sum + failed, 0);

  revalidatePath(`/projects/${issue.projectId}/issues`);
  if (docIds.length > 0) revalidatePath(`/projects/${issue.projectId}/docs`);
  if (drawingIds.length > 0) revalidatePath(`/projects/${issue.projectId}/drawings`);
  const problems = [
    ...(unlinked > 0 ? [`${unlinked} link${unlinked === 1 ? '' : 's'} could not be added`] : []),
    ...(branchProblem ? [`the branch wasn’t linked: ${branchProblem}`] : [])
  ];
  return problems.length > 0
    ? { ok: true, detail: `Task created, but ${problems.join(' and ')}.` }
    : { ok: true };
}

const statusSchema = z.object({
  issueId: z.string().min(1),
  status: z.string().min(1),
  beforeId: z.string().min(1).nullish()
});

export async function moveIssueAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid status' };

  try {
    const moved = await moveIssueBefore(
      user.id,
      parsed.data.issueId,
      { status: parsed.data.status },
      parsed.data.beforeId ?? null
    );
    revalidatePath(`/projects/${moved.projectId}/issues`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not move the task');
  }
}

const columnSchema = z.object({
  projectId: z.string().min(1),
  boardId: z.string().min(1),
  name: z.string().trim().min(2, 'Name the status').max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color')
    .nullish(),
  icon: z.enum(STATUS_ICON_NAMES).nullish()
});

export async function deleteBoardAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = z.object({ boardId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid board' };
  try {
    const board = await deleteBoard(user.id, parsed.data.boardId);
    revalidatePath(`/projects/${board.projectId}/issues`);
    revalidatePath(`/projects/${board.projectId}/docs`);
    revalidatePath(`/projects/${board.projectId}/drawings`);
    revalidatePath(`/projects/${board.projectId}`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not delete the board');
  }
}

export async function createBoardColumnAction(
  input: unknown
): Promise<IssueActionResult & { columnId?: string }> {
  const user = await requireUser();
  const parsed = columnSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid status'
    };

  try {
    const column = await createBoardColumn(
      user.id,
      parsed.data.boardId,
      parsed.data.name,
      parsed.data.color,
      parsed.data.icon
    );
    revalidatePath(`/projects/${parsed.data.projectId}/issues`);
    return { ok: true, columnId: column.id };
  } catch (error) {
    return fail(error, 'Could not add the status');
  }
}

const reorderColumnsSchema = z.object({
  projectId: z.string().min(1),
  boardId: z.string().min(1),
  columnIds: z.array(z.string().min(1)).min(1).max(100)
});

export async function reorderBoardColumnsAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = reorderColumnsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid status order' };

  try {
    await reorderBoardColumns(user.id, parsed.data.boardId, parsed.data.columnIds);
    revalidatePath(`/projects/${parsed.data.projectId}/issues`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not reorder the statuses');
  }
}

const renameColumnSchema = columnSchema.extend({
  columnId: z.string().min(1)
});

export async function renameBoardColumnAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = renameColumnSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid status'
    };

  try {
    await renameBoardColumn(
      user.id,
      parsed.data.boardId,
      parsed.data.columnId,
      parsed.data.name,
      parsed.data.color,
      parsed.data.icon
    );
    revalidatePath(`/projects/${parsed.data.projectId}/issues`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not edit the status');
  }
}

const deleteColumnSchema = z.object({
  projectId: z.string().min(1),
  boardId: z.string().min(1),
  columnId: z.string().min(1)
});

export async function deleteBoardColumnAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = deleteColumnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid status' };

  try {
    await deleteBoardColumn(user.id, parsed.data.boardId, parsed.data.columnId);
    revalidatePath(`/projects/${parsed.data.projectId}/issues`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not remove the status');
  }
}

const fieldOptionSchema = z.object({
  projectId: z.string().min(1),
  kind: z.enum(IssueFieldKind),
  name: z.string().trim().min(1, 'Name it first').max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color')
    .nullish()
});

export async function createIssueFieldOptionAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = fieldOptionSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid option'
    };

  try {
    await createIssueFieldOption(
      user.id,
      parsed.data.projectId,
      parsed.data.kind,
      parsed.data.name,
      parsed.data.color
    );
    revalidatePath(`/projects/${parsed.data.projectId}/issues`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not add it');
  }
}

const renameFieldOptionSchema = fieldOptionSchema.extend({
  optionId: z.string().min(1)
});

export async function renameIssueFieldOptionAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = renameFieldOptionSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid option'
    };

  try {
    await renameIssueFieldOption(
      user.id,
      parsed.data.projectId,
      parsed.data.kind,
      parsed.data.optionId,
      parsed.data.name,
      parsed.data.color
    );
    revalidatePath(`/projects/${parsed.data.projectId}/issues`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not edit it');
  }
}

const deleteFieldOptionSchema = z.object({
  projectId: z.string().min(1),
  kind: z.enum(IssueFieldKind),
  optionId: z.string().min(1)
});

export async function deleteIssueFieldOptionAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = deleteFieldOptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid option' };

  try {
    await deleteIssueFieldOption(
      user.id,
      parsed.data.projectId,
      parsed.data.kind,
      parsed.data.optionId
    );
    revalidatePath(`/projects/${parsed.data.projectId}/issues`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not remove it');
  }
}

const updateSchema = z.object({
  issueId: z.string().min(1),
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(10_000).optional(),
  type: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  priority: z.string().min(1).optional(),
  assigneeId: z.string().min(1).nullish(),
  sprintId: z.string().min(1).nullish(),
  targetDate: targetDateSchema
});

export async function updateIssueAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid issue'
    };
  }

  const { issueId, ...data } = parsed.data;
  try {
    const updated = await updateIssue(user.id, issueId, data);
    revalidatePath(`/projects/${updated.projectId}/issues`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not update the issue');
  }
}

const issueTarget = z.object({ issueId: z.string().min(1) });

/** "Delete" on the board: the task moves to the archive and can be restored. */
export async function archiveIssueAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = issueTarget.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid task' };
  try {
    const issue = await archiveIssue(user.id, parsed.data.issueId);
    revalidateIssueViews(issue.projectId);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not delete the task');
  }
}

export async function restoreIssueAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = issueTarget.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid task' };
  try {
    const issue = await restoreIssue(user.id, parsed.data.issueId);
    revalidateIssueViews(issue.projectId);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not restore the task');
  }
}

export async function deleteArchivedIssueAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = issueTarget.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid task' };
  try {
    const issue = await deleteArchivedIssue(user.id, parsed.data.issueId);
    revalidateIssueViews(issue.projectId);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not delete the task');
  }
}

/** The board plus the pages that show linked tasks. */
function revalidateIssueViews(projectId: string) {
  revalidatePath(`/projects/${projectId}/issues`);
  revalidatePath(`/projects/${projectId}/docs`);
  revalidatePath(`/projects/${projectId}/drawings`);
  revalidatePath(`/projects/${projectId}`);
}

const commentSchema = z.object({
  issueId: z.string().min(1),
  body: z.string().trim().min(1, 'Write something first').max(10_000)
});

export async function addCommentAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid comment'
    };
  }

  try {
    const { projectId } = await addComment(user.id, parsed.data.issueId, parsed.data.body);
    revalidatePath(`/projects/${projectId}/issues`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not add the comment');
  }
}

const sprintSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(2, 'Name the sprint').max(80),
  goal: z.string().trim().max(500).optional()
});

export async function createSprintAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = sprintSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid sprint'
    };
  }

  try {
    await createSprint(user.id, parsed.data.projectId, parsed.data.name, parsed.data.goal);
    revalidatePath(`/projects/${parsed.data.projectId}/issues`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not create the sprint');
  }
}

const syncSchema = z.object({
  projectId: z.string().min(1),
  repositoryId: z.string().min(1)
});

export async function syncIssueLinksAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = syncSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a repository' };

  try {
    const { linked, advanced } = await syncIssueLinks(
      user.id,
      parsed.data.projectId,
      parsed.data.repositoryId
    );
    revalidatePath(`/projects/${parsed.data.projectId}/issues`);
    return {
      ok: true,
      detail: `${linked} new link${linked === 1 ? '' : 's'}, ${advanced} issue${advanced === 1 ? '' : 's'} advanced`
    };
  } catch (error) {
    return fail(error, 'Could not read the repository');
  }
}

export interface IssueHistoryEntry {
  id: string;
  type: 'CREATED' | 'STATUS' | 'ASSIGNEE' | 'PRIORITY' | 'TARGET_DATE' | 'ARCHIVED' | 'RESTORED';
  fromValue: string | null;
  toValue: string | null;
  viaGit: boolean;
  actor: string | null;
  createdAt: string;
}

export interface IssueHistoryResult extends IssueActionResult {
  history?: IssueHistoryEntry[];
}

/** A task's history for its dialog, oldest first. */
export async function getIssueHistoryAction(input: unknown): Promise<IssueHistoryResult> {
  const user = await requireUser();
  const parsed = z.object({ issueId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid task' };

  try {
    const events = await listIssueHistory(user.id, parsed.data.issueId);
    return {
      ok: true,
      history: events.map((event) => ({
        id: event.id,
        type: event.type,
        fromValue: event.fromValue,
        toValue: event.toValue,
        viaGit: event.viaGit,
        actor: event.actor ? (event.actor.name ?? event.actor.username) : null,
        createdAt: event.createdAt.toISOString()
      }))
    };
  } catch (error) {
    return fail(error, 'Could not load the history');
  }
}

export interface IssueGitLinkView {
  id: string;
  linkType: 'BRANCH' | 'COMMIT' | 'MERGE_REQUEST';
  reference: string;
  title: string | null;
  repository: string;
  url: string;
}

export interface IssueGitResult extends IssueActionResult {
  issueKey?: string;
  title?: string;
  repositories?: { id: string; fullName: string; defaultBranch: string }[];
  links?: IssueGitLinkView[];
}

/** A task's linked branches, commits and pull requests, for its dialog. */
export async function getIssueGitAction(input: unknown): Promise<IssueGitResult> {
  const user = await requireUser();
  const parsed = z.object({ issueId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid task' };

  try {
    return { ok: true, ...(await listIssueGit(user.id, parsed.data.issueId)) };
  } catch (error) {
    return fail(error, 'Could not load the linked branches');
  }
}

const issueRepositorySchema = z.object({
  issueId: z.string().min(1),
  repositoryId: z.string().min(1, 'Pick a repository')
});

export interface IssueBranchesResult extends IssueActionResult {
  branches?: string[];
}

export async function listIssueBranchesAction(input: unknown): Promise<IssueBranchesResult> {
  const user = await requireUser();
  const parsed = issueRepositorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Pick a repository' };

  try {
    const branches = await listIssueRepositoryBranches(
      user.id,
      parsed.data.issueId,
      parsed.data.repositoryId
    );
    return { ok: true, branches };
  } catch (error) {
    if (error instanceof ProviderAuthenticationError) {
      return { ok: false, error: 'Your git token can’t read this repository.' };
    }
    return fail(error, 'Could not load the branches');
  }
}

export async function linkIssueBranchAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = issueRepositorySchema
    .extend({ branch: z.string().min(1, 'Pick a branch') })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Pick a branch' };
  }

  try {
    const { issueId, repositoryId, branch } = parsed.data;
    await linkIssueBranch(user.id, issueId, repositoryId, branch);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not link the branch');
  }
}

export async function createIssueBranchAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = issueRepositorySchema
    .extend({ name: branchNameSchema, from: z.string().min(1, 'Pick a branch to start from') })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid branch' };
  }

  const { issueId, repositoryId, name, from } = parsed.data;
  try {
    await createIssueBranch(user.id, issueId, repositoryId, name, from);
    return { ok: true };
  } catch (error) {
    if (error instanceof ProviderConflictError) {
      return { ok: false, error: `A branch named ${name} already exists. Link it instead.` };
    }
    if (error instanceof ProviderAuthenticationError) {
      return { ok: false, error: 'Your git token can’t push to this repository.' };
    }
    return fail(error, `Could not create ${name}`);
  }
}

export async function unlinkIssueGitAction(input: unknown): Promise<IssueActionResult> {
  const user = await requireUser();
  const parsed = z.object({ linkId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid link' };

  try {
    await unlinkIssueGitLink(user.id, parsed.data.linkId);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not remove the link');
  }
}

export interface ProjectBranchesResult extends IssueActionResult {
  repositories?: { id: string; fullName: string; defaultBranch: string }[];
  branches?: string[];
}

/** The project's repositories, for picking a branch before a task exists. */
export async function listProjectRepositoriesAction(
  input: unknown
): Promise<ProjectBranchesResult> {
  const user = await requireUser();
  const parsed = z.object({ projectId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid project' };

  try {
    const repositories = await listProjectRepositories(user.id, parsed.data.projectId);
    return {
      ok: true,
      repositories: repositories.map(({ id, fullName, defaultBranch }) => ({
        id,
        fullName,
        defaultBranch
      }))
    };
  } catch {
    return { ok: false, error: 'Could not load the repositories' };
  }
}

export async function listProjectBranchesAction(input: unknown): Promise<ProjectBranchesResult> {
  const user = await requireUser();
  const parsed = z
    .object({ projectId: z.string().min(1), repositoryId: z.string().min(1) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Pick a repository' };

  try {
    const branches = await listProjectRepositoryBranches(
      user.id,
      parsed.data.projectId,
      parsed.data.repositoryId
    );
    return { ok: true, branches };
  } catch (error) {
    if (error instanceof ProviderAuthenticationError) {
      return { ok: false, error: 'Your git token can’t read this repository.' };
    }
    return fail(error, 'Could not load the branches');
  }
}
