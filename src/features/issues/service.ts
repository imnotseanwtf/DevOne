import { GitProvider, IssueFieldKind, IssueLinkType, Prisma } from '@/generated/prisma/client';
import { getPrisma } from '@/lib/db/prisma';
import { createRepositoryBranch, openRepository } from '@/features/git/service';
import { formatIssueKey, issueKeysForPrefix } from '@/lib/issues/keys';

export class IssueAccessError extends Error {
  constructor(message = 'Issue not found') {
    super(message);
    this.name = 'IssueAccessError';
  }
}

/** Every board is seeded with these workflow stages; all are then equally
 * rename-/removable `BoardColumn` rows, same as anything added later. */
const DEFAULT_BOARD_COLUMNS = [
  { name: 'To Do', color: '#64748b' },
  { name: 'In Progress', color: '#3b82f6' },
  { name: 'In Review', color: '#8b5cf6' },
  { name: 'Ready for QA', color: '#f59e0b' },
  { name: 'Done', color: '#22c55e' }
];
const [, inProgress, inReview, readyForQa] = DEFAULT_BOARD_COLUMNS;
const STAGE_IN_PROGRESS = inProgress.name;
const STAGE_IN_REVIEW = inReview.name;
const STAGE_READY_FOR_QA = readyForQa.name;

/** The one reserved status not backed by a `BoardColumn` row: issues land
 * here when their column is deleted, or before they join a board. */
const BACKLOG_STATUS = 'BACKLOG';

async function requireProjectMembership(userId: string, projectId: string) {
  const membership = await getPrisma().projectMember.findFirst({
    where: { projectId, userId },
    select: { id: true }
  });
  if (!membership) throw new IssueAccessError();
}

/** Case-insensitive duplicate check, since the DB unique index is case-sensitive. */
async function assertNameAvailable(find: () => Promise<unknown>, label: string) {
  if (await find()) {
    throw new IssueAccessError(`That ${label} name is already taken`);
  }
}

export async function listBoards(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().board.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' }
  });
}

export async function createBoard(userId: string, projectId: string, name: string) {
  await requireProjectMembership(userId, projectId);
  await assertNameAvailable(
    () =>
      getPrisma().board.findFirst({
        where: { projectId, name: { equals: name, mode: 'insensitive' } },
        select: { id: true }
      }),
    'board'
  );
  return getPrisma().board.create({
    data: {
      projectId,
      name,
      columns: {
        createMany: {
          data: DEFAULT_BOARD_COLUMNS.map((column, position) => ({
            ...column,
            position
          }))
        }
      }
    }
  });
}

async function requireBoard(userId: string, boardId: string) {
  const board = await getPrisma().board.findFirst({
    where: { id: boardId, project: { members: { some: { userId } } } }
  });
  if (!board) throw new IssueAccessError('Board not found');
  return board;
}

/**
 * Deletes a board with its statuses and every task on it (archived ones too); their
 * comments and links go with them.
 */
export async function deleteBoard(userId: string, boardId: string) {
  const board = await requireBoard(userId, boardId);
  await getPrisma().board.delete({ where: { id: boardId } });
  return board;
}

export async function listBoardColumns(userId: string, boardId: string) {
  await requireBoard(userId, boardId);
  return getPrisma().boardColumn.findMany({
    where: { boardId },
    orderBy: { position: 'asc' }
  });
}

/** Adds a workflow stage to the board, after any existing ones. */
export async function createBoardColumn(
  userId: string,
  boardId: string,
  name: string,
  color?: string | null,
  icon?: string | null
) {
  await requireBoard(userId, boardId);
  await assertNameAvailable(
    () =>
      getPrisma().boardColumn.findFirst({
        where: { boardId, name: { equals: name, mode: 'insensitive' } },
        select: { id: true }
      }),
    'status'
  );
  const last = await getPrisma().boardColumn.findFirst({
    where: { boardId },
    orderBy: { position: 'desc' },
    select: { position: true }
  });
  return getPrisma().boardColumn.create({
    data: {
      boardId,
      name,
      color: color || null,
      icon: icon || null,
      position: (last?.position ?? -1) + 1
    }
  });
}

/**
 * Saves the left-to-right order of a board's stages. `columnIds` must list every
 * column exactly once; auto-advancing issues follows this order too.
 */
export async function reorderBoardColumns(userId: string, boardId: string, columnIds: string[]) {
  await requireBoard(userId, boardId);
  const columns = await getPrisma().boardColumn.findMany({
    where: { boardId },
    select: { id: true }
  });
  const known = new Set(columns.map((column) => column.id));
  if (
    columnIds.length !== known.size ||
    new Set(columnIds).size !== columnIds.length ||
    columnIds.some((id) => !known.has(id))
  ) {
    throw new IssueAccessError('The statuses changed. Refresh and try again.');
  }

  await getPrisma().$transaction(
    columnIds.map((id, position) =>
      getPrisma().boardColumn.update({ where: { id }, data: { position } })
    )
  );
}

async function requireBoardColumn(userId: string, boardId: string, id: string) {
  await requireBoard(userId, boardId);
  const column = await getPrisma().boardColumn.findFirst({
    where: { id, boardId }
  });
  if (!column) throw new IssueAccessError('Status not found');
  return column;
}

/** Renames a stage and carries every issue sitting in it along with it. */
export async function renameBoardColumn(
  userId: string,
  boardId: string,
  id: string,
  name: string,
  color?: string | null,
  icon?: string | null
) {
  const column = await requireBoardColumn(userId, boardId, id);
  // undefined leaves a field as it is; null or '' clears it.
  const appearance = {
    color: color === undefined ? undefined : color || null,
    icon: icon === undefined ? undefined : icon || null
  };
  if (column.name === name) {
    return getPrisma().boardColumn.update({ where: { id }, data: appearance });
  }
  await assertNameAvailable(
    () =>
      getPrisma().boardColumn.findFirst({
        where: {
          boardId,
          name: { equals: name, mode: 'insensitive' },
          NOT: { id }
        },
        select: { id: true }
      }),
    'status'
  );

  return getPrisma().$transaction(async (transaction) => {
    const updated = await transaction.boardColumn.update({
      where: { id },
      data: { name, ...appearance }
    });
    await transaction.issue.updateMany({
      where: { boardId, status: column.name },
      data: { status: name }
    });
    return updated;
  });
}

/**
 * Removes a workflow stage. Cards in it fall back to the reserved BACKLOG
 * status — same as if they had not joined a board column yet.
 */
export async function deleteBoardColumn(userId: string, boardId: string, id: string) {
  const column = await requireBoardColumn(userId, boardId, id);
  await getPrisma().$transaction(async (transaction) => {
    const moved = await transaction.issue.findMany({
      where: { boardId, status: column.name },
      select: { id: true }
    });
    await transaction.issue.updateMany({
      where: { boardId, status: column.name },
      data: { status: BACKLOG_STATUS }
    });
    await transaction.issueEvent.createMany({
      data: moved.map((issue) => ({
        issueId: issue.id,
        actorId: userId,
        type: 'STATUS' as const,
        fromValue: column.name,
        toValue: BACKLOG_STATUS
      }))
    });
    await transaction.boardColumn.delete({ where: { id } });
  });
}

export async function listIssues(userId: string, projectId: string, boardId?: string) {
  await requireProjectMembership(userId, projectId);
  const issues = await getPrisma().issue.findMany({
    where: { projectId, archivedAt: null, ...(boardId ? { boardId } : {}) },
    include: {
      assignee: { select: { id: true, username: true, name: true } },
      creator: { select: { id: true, username: true, name: true } },
      sprint: { select: { id: true, name: true } },
      docLinks: {
        include: { doc: { select: { id: true, slug: true, title: true } } }
      },
      drawingLinks: {
        include: { drawing: { select: { id: true, title: true } } }
      },
      _count: { select: { gitLinks: true, comments: true } }
    },
    orderBy: [{ status: 'asc' }, { position: 'asc' }, { number: 'desc' }]
  });

  return issues.map(({ _count, docLinks, drawingLinks, ...issue }) => ({
    ...issue,
    gitLinkCount: _count.gitLinks,
    commentCount: _count.comments,
    linkedDocs: docLinks.map((link) => link.doc),
    linkedDrawings: drawingLinks.map((link) => link.drawing)
  }));
}

/** Lightweight doc list for the "link a doc" picker. */
export async function listDocsForLinking(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().docPage.findMany({
    where: { projectId },
    select: { id: true, slug: true, title: true },
    orderBy: { updatedAt: 'desc' },
    take: 200
  });
}

export async function getIssue(userId: string, issueKey: string) {
  const issue = await getPrisma().issue.findFirst({
    where: { issueKey, project: { members: { some: { userId } } } },
    include: {
      project: { select: { id: true, name: true, issuePrefix: true } },
      assignee: { select: { id: true, username: true } },
      creator: { select: { id: true, username: true } },
      sprint: true,
      comments: {
        include: { author: { select: { id: true, username: true } } },
        orderBy: { createdAt: 'asc' }
      },
      gitLinks: {
        include: { repository: { select: { id: true, fullName: true } } },
        orderBy: { detectedAt: 'desc' }
      }
    }
  });
  if (!issue) throw new IssueAccessError();
  return issue;
}

export interface CreateIssueInput {
  boardId?: string;
  title: string;
  description?: string;
  type: string;
  status: string;
  priority: string;
  assigneeId?: string | null;
  sprintId?: string | null;
  /** Optional due date; null clears it. */
  targetDate?: Date | null;
}

export async function listIssueFieldOptions(
  userId: string,
  projectId: string,
  kind: IssueFieldKind
) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().issueFieldOption.findMany({
    where: { projectId, kind },
    orderBy: { position: 'asc' }
  });
}

/** Adds a type/priority option to the project, after any existing ones. */
export async function createIssueFieldOption(
  userId: string,
  projectId: string,
  kind: IssueFieldKind,
  name: string,
  color?: string | null
) {
  await requireProjectMembership(userId, projectId);
  await assertNameAvailable(
    () =>
      getPrisma().issueFieldOption.findFirst({
        where: { projectId, kind, name: { equals: name, mode: 'insensitive' } },
        select: { id: true }
      }),
    kind === IssueFieldKind.TYPE ? 'type' : 'priority'
  );
  const last = await getPrisma().issueFieldOption.findFirst({
    where: { projectId, kind },
    orderBy: { position: 'desc' },
    select: { position: true }
  });
  return getPrisma().issueFieldOption.create({
    data: {
      projectId,
      kind,
      name,
      color: color || null,
      position: (last?.position ?? -1) + 1
    }
  });
}

async function requireIssueFieldOption(
  userId: string,
  projectId: string,
  kind: IssueFieldKind,
  id: string
) {
  await requireProjectMembership(userId, projectId);
  const option = await getPrisma().issueFieldOption.findFirst({
    where: { id, projectId, kind }
  });
  if (!option) throw new IssueAccessError('Option not found');
  return option;
}

/** Renames an option and carries every issue using the old name along with it. */
export async function renameIssueFieldOption(
  userId: string,
  projectId: string,
  kind: IssueFieldKind,
  id: string,
  name: string,
  color?: string | null
) {
  const option = await requireIssueFieldOption(userId, projectId, kind, id);
  if (option.name === name) {
    return getPrisma().issueFieldOption.update({
      where: { id },
      data: { color: color === undefined ? undefined : color || null }
    });
  }
  const field = kind === IssueFieldKind.TYPE ? 'type' : 'priority';
  await assertNameAvailable(
    () =>
      getPrisma().issueFieldOption.findFirst({
        where: {
          projectId,
          kind,
          name: { equals: name, mode: 'insensitive' },
          NOT: { id }
        },
        select: { id: true }
      }),
    field
  );

  return getPrisma().$transaction(async (transaction) => {
    const updated = await transaction.issueFieldOption.update({
      where: { id },
      data: {
        name,
        color: color === undefined ? undefined : color || null
      }
    });
    await transaction.issue.updateMany({
      where: { projectId, [field]: option.name },
      data: { [field]: name }
    });
    return updated;
  });
}

/**
 * Removes a type/priority option. Refused while any issue still uses it, or
 * if it is the last option left for that kind — an issue always needs one.
 */
export async function deleteIssueFieldOption(
  userId: string,
  projectId: string,
  kind: IssueFieldKind,
  id: string
) {
  const option = await requireIssueFieldOption(userId, projectId, kind, id);
  const field = kind === IssueFieldKind.TYPE ? 'type' : 'priority';

  const [inUse, total] = await Promise.all([
    getPrisma().issue.count({ where: { projectId, [field]: option.name } }),
    getPrisma().issueFieldOption.count({ where: { projectId, kind } })
  ]);
  if (total <= 1) {
    throw new IssueAccessError(`At least one ${field} option is required`);
  }
  if (inUse > 0) {
    throw new IssueAccessError(
      `${inUse} task${inUse === 1 ? '' : 's'} still ${inUse === 1 ? 'uses' : 'use'} this ${field}`
    );
  }
  await getPrisma().issueFieldOption.delete({ where: { id } });
}

/**
 * Allocates the next issue number by incrementing the project counter inside a
 * transaction, so two concurrent creates cannot claim the same key.
 */
export async function createIssue(userId: string, projectId: string, input: CreateIssueInput) {
  await requireProjectMembership(userId, projectId);

  return getPrisma().$transaction(async (transaction) => {
    const board = input.boardId
      ? await transaction.board.findFirst({
          where: { id: input.boardId, projectId }
        })
      : await transaction.board.findFirst({
          where: { projectId },
          orderBy: { createdAt: 'asc' }
        });
    if (!board) throw new IssueAccessError('Board not found');
    const project = await transaction.project.update({
      where: { id: projectId },
      data: { issueCounter: { increment: 1 } },
      select: { issuePrefix: true, issueCounter: true }
    });

    return transaction.issue.create({
      data: {
        projectId,
        boardId: board.id,
        issueKey: formatIssueKey(project.issuePrefix, project.issueCounter),
        number: project.issueCounter,
        title: input.title,
        description: input.description,
        type: input.type,
        status: input.status,
        priority: input.priority,
        assigneeId: input.assigneeId ?? null,
        sprintId: input.sprintId ?? null,
        targetDate: input.targetDate ?? null,
        createdById: userId,
        events: { create: { actorId: userId, type: 'CREATED', toValue: input.status } }
      }
    });
  });
}

async function requireIssue(userId: string, issueId: string) {
  const issue = await getPrisma().issue.findFirst({
    where: { id: issueId, project: { members: { some: { userId } } } }
  });
  if (!issue) throw new IssueAccessError();
  return issue;
}

export interface ColumnTarget {
  /** A board column's name, or the reserved "BACKLOG" sentinel. */
  status: string;
}

/**
 * Moves an issue into a column, optionally before another issue already in
 * it. Positions are compacted 0..n so drag order survives refreshes.
 */
export async function moveIssueBefore(
  userId: string,
  issueId: string,
  target: ColumnTarget,
  beforeId: string | null
) {
  const issue = await requireIssue(userId, issueId);
  if (beforeId === issueId) return issue;

  return getPrisma().$transaction(async (transaction) => {
    const siblings = await transaction.issue.findMany({
      where: {
        boardId: issue.boardId,
        status: target.status,
        archivedAt: null,
        NOT: { id: issueId }
      },
      orderBy: [{ position: 'asc' }, { number: 'asc' }],
      select: { id: true }
    });

    let insertAt = siblings.length;
    if (beforeId) {
      const found = siblings.findIndex((entry) => entry.id === beforeId);
      if (found === -1) throw new IssueAccessError();
      insertAt = found;
    }

    const ordered = [...siblings.slice(0, insertAt), { id: issueId }, ...siblings.slice(insertAt)];

    if (target.status !== issue.status) {
      await transaction.issueEvent.create({
        data: {
          issueId,
          actorId: userId,
          type: 'STATUS',
          fromValue: issue.status,
          toValue: target.status
        }
      });
    }

    for (let index = 0; index < ordered.length; index += 1) {
      const entry = ordered[index];
      if (entry.id === issueId) {
        await transaction.issue.update({
          where: { id: entry.id },
          data: { status: target.status, position: index }
        });
      } else {
        await transaction.issue.update({
          where: { id: entry.id },
          data: { position: index }
        });
      }
    }

    return transaction.issue.findUniqueOrThrow({ where: { id: issueId } });
  });
}

/** A target date as the YYYY-MM-DD it is stored as (it has no time of day). */
function dayString(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** The history entries an edit produces: one per tracked field that changed. */
async function describeChanges(
  before: {
    status: string;
    priority: string;
    assigneeId: string | null;
    targetDate: Date | null;
  },
  data: Partial<CreateIssueInput>
) {
  const events: {
    type: 'STATUS' | 'ASSIGNEE' | 'PRIORITY' | 'TARGET_DATE';
    fromValue: string | null;
    toValue: string | null;
  }[] = [];

  if (data.status !== undefined && data.status !== before.status) {
    events.push({ type: 'STATUS', fromValue: before.status, toValue: data.status });
  }
  if (data.priority !== undefined && data.priority !== before.priority) {
    events.push({ type: 'PRIORITY', fromValue: before.priority, toValue: data.priority });
  }
  if (data.assigneeId !== undefined && (data.assigneeId ?? null) !== before.assigneeId) {
    // Usernames, so the log still reads right if someone later leaves the project.
    const ids = [before.assigneeId, data.assigneeId].filter((id): id is string => !!id);
    const users = await getPrisma().user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true }
    });
    const name = (id: string | null | undefined) =>
      id ? (users.find((user) => user.id === id)?.username ?? null) : null;
    events.push({
      type: 'ASSIGNEE',
      fromValue: name(before.assigneeId),
      toValue: name(data.assigneeId)
    });
  }
  if (
    data.targetDate !== undefined &&
    dayString(data.targetDate) !== dayString(before.targetDate)
  ) {
    events.push({
      type: 'TARGET_DATE',
      fromValue: dayString(before.targetDate),
      toValue: dayString(data.targetDate)
    });
  }
  return events;
}

/** A task's history, oldest first, with who made each change. */
export async function listIssueHistory(userId: string, issueId: string) {
  await requireIssue(userId, issueId);
  return getPrisma().issueEvent.findMany({
    where: { issueId },
    include: { actor: { select: { username: true, name: true } } },
    orderBy: { createdAt: 'asc' }
  });
}

export async function updateIssue(
  userId: string,
  issueId: string,
  data: Partial<CreateIssueInput>
) {
  const before = await requireIssue(userId, issueId);
  const events = await describeChanges(before, data);
  return getPrisma().$transaction(async (transaction) => {
    const updated = await transaction.issue.update({
      where: { id: issueId },
      data: {
        title: data.title,
        description: data.description,
        type: data.type,
        status: data.status,
        priority: data.priority,
        assigneeId: data.assigneeId,
        sprintId: data.sprintId,
        targetDate: data.targetDate
      }
    });
    if (events.length > 0) {
      await transaction.issueEvent.createMany({
        data: events.map((event) => ({ ...event, issueId, actorId: userId }))
      });
    }
    return updated;
  });
}

// Archive ---------------------------------------------------------------------

/** Deleting a task from the board archives it; it can be restored or deleted for good. */
export async function archiveIssue(userId: string, issueId: string) {
  const issue = await requireIssue(userId, issueId);
  return getPrisma().issue.update({
    where: { id: issueId },
    data: {
      archivedAt: new Date(),
      events: { create: { actorId: userId, type: 'ARCHIVED', fromValue: issue.status } }
    }
  });
}

/**
 * Puts an archived task back at the end of its column, or in the backlog when
 * that column no longer exists.
 */
export async function restoreIssue(userId: string, issueId: string) {
  const issue = await requireIssue(userId, issueId);
  if (!issue.archivedAt) return issue;
  const column = await getPrisma().boardColumn.findFirst({
    where: { boardId: issue.boardId, name: issue.status },
    select: { id: true }
  });
  const status = column ? issue.status : BACKLOG_STATUS;
  const last = await getPrisma().issue.aggregate({
    where: { boardId: issue.boardId, status, archivedAt: null },
    _max: { position: true }
  });
  return getPrisma().issue.update({
    where: { id: issueId },
    data: {
      archivedAt: null,
      status,
      position: (last._max.position ?? -1) + 1,
      events: { create: { actorId: userId, type: 'RESTORED', toValue: status } }
    }
  });
}

/** Only archived tasks can be deleted for good, so nothing disappears in one click. */
export async function deleteArchivedIssue(userId: string, issueId: string) {
  const issue = await requireIssue(userId, issueId);
  if (!issue.archivedAt) throw new IssueAccessError('Archive the task before deleting it');
  await getPrisma().issue.delete({ where: { id: issueId } });
  return issue;
}

export async function listArchivedIssues(userId: string, projectId: string, boardId: string) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().issue.findMany({
    where: { projectId, boardId, archivedAt: { not: null } },
    select: {
      id: true,
      issueKey: true,
      title: true,
      type: true,
      status: true,
      archivedAt: true
    },
    orderBy: { archivedAt: 'desc' }
  });
}

export async function addComment(userId: string, issueId: string, body: string) {
  const issue = await requireIssue(userId, issueId);
  const comment = await getPrisma().issueComment.create({
    data: { issueId, authorId: userId, body }
  });
  return { ...comment, projectId: issue.projectId };
}
export async function listSprints(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().sprint.findMany({
    where: { projectId },
    include: { _count: { select: { issues: true } } },
    orderBy: { createdAt: 'desc' }
  });
}

// ponytail: "open" means "not in a column named DONE" — a literal string
// match, not derived from a per-column flag. Renaming/removing the DONE
// stage silently stops this count from excluding it; add an `isDone` flag on
// BoardColumn if that starts to matter.
export function countOpenIssuesForUser(userId: string): Promise<number> {
  return getPrisma().issue.count({
    where: {
      project: { members: { some: { userId } } },
      status: { not: 'DONE' },
      archivedAt: null
    }
  });
}

export async function createSprint(userId: string, projectId: string, name: string, goal?: string) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().sprint.create({ data: { projectId, name, goal } });
}

interface DetectedLink {
  issueKey: string;
  linkType: IssueLinkType;
  reference: string;
  title: string | null;
  webUrl: string | null;
  /** Status this activity implies, if the issue has not already moved past it. */
  implies: string | null;
}

/**
 * Reads a linked repository and records every issue key it finds in branches,
 * commits, and merge requests. Idempotent: re-running only adds what is new,
 * which is what makes it safe to call from a webhook later.
 */
export async function syncIssueLinks(userId: string, projectId: string, repositoryId: string) {
  await requireProjectMembership(userId, projectId);

  const project = await getPrisma().project.findUnique({
    where: { id: projectId },
    select: { issuePrefix: true }
  });
  if (!project) throw new IssueAccessError();

  const { client, token, repository } = await openRepository(userId, repositoryId);
  const prefix = project.issuePrefix;
  const detected: DetectedLink[] = [];

  const branches = await client.getBranches(token, repository.providerRepositoryId).catch(() => []);

  // Commits are scanned across every branch — not just the default — so work
  // on feature branches links its issue the moment it is pushed. Bounded and
  // deduplicated by sha since branches share most of their history.
  const MAX_SYNC_BRANCHES = 30;
  const [commitLists, mergeRequests] = await Promise.all([
    Promise.all(
      branches
        .slice(0, MAX_SYNC_BRANCHES)
        .map((branch) =>
          client.getCommits(token, repository.providerRepositoryId, branch.name).catch(() => [])
        )
    ),
    client.getMergeRequests(token, repository.providerRepositoryId).catch(() => [])
  ]);
  const commits = [...new Map(commitLists.flat().map((commit) => [commit.sha, commit])).values()];

  for (const branch of branches) {
    for (const issueKey of issueKeysForPrefix(branch.name, prefix)) {
      detected.push({
        issueKey,
        linkType: IssueLinkType.BRANCH,
        reference: branch.name,
        title: null,
        webUrl: null,
        implies: STAGE_IN_PROGRESS
      });
    }
  }

  for (const commit of commits) {
    for (const issueKey of issueKeysForPrefix(commit.message, prefix)) {
      detected.push({
        issueKey,
        linkType: IssueLinkType.COMMIT,
        reference: commit.sha,
        title: commit.message.split('\n')[0],
        webUrl: null,
        implies: STAGE_IN_PROGRESS
      });
    }
  }

  // Branches linked by hand needn't carry the task key; their pull requests
  // still belong to the task they were linked to.
  const manualBranches = await getPrisma().issueGitLink.findMany({
    where: { repositoryId, linkType: IssueLinkType.BRANCH, issue: { projectId } },
    select: { reference: true, issue: { select: { issueKey: true } } }
  });
  const keysByBranch = new Map<string, string[]>();
  for (const link of manualBranches) {
    keysByBranch.set(link.reference, [
      ...(keysByBranch.get(link.reference) ?? []),
      link.issue.issueKey
    ]);
  }

  for (const request of mergeRequests) {
    const text = `${request.title} ${request.sourceBranch}`;
    const keys = new Set([
      ...issueKeysForPrefix(text, prefix),
      ...(keysByBranch.get(request.sourceBranch) ?? [])
    ]);
    for (const issueKey of keys) {
      detected.push({
        issueKey,
        linkType: IssueLinkType.MERGE_REQUEST,
        reference: String(request.number),
        title: request.title,
        webUrl: request.webUrl,
        implies: request.state === 'merged' ? STAGE_READY_FOR_QA : STAGE_IN_REVIEW
      });
    }
  }

  if (detected.length === 0) return { linked: 0, advanced: 0 };

  const issues = await getPrisma().issue.findMany({
    where: {
      projectId,
      archivedAt: null,
      issueKey: { in: [...new Set(detected.map((d) => d.issueKey))] }
    },
    select: { id: true, issueKey: true, status: true, boardId: true }
  });
  const byKey = new Map(issues.map((issue) => [issue.issueKey, issue]));

  // Git activity "implies" a fixed stage name (IN_PROGRESS, IN_REVIEW, …).
  // Advancing only makes sense forward, so positions are read per board from
  // its current columns; a renamed/removed stage just can't be advanced to.
  const boardIds = [...new Set(issues.map((issue) => issue.boardId))];
  const columns = await getPrisma().boardColumn.findMany({
    where: { boardId: { in: boardIds } },
    select: { boardId: true, name: true, position: true }
  });
  const positionOf = new Map(
    columns.map((column) => [`${column.boardId}:${column.name}`, column.position])
  );
  function stagePosition(boardId: string, status: string): number {
    if (status === BACKLOG_STATUS) return -1;
    return positionOf.get(`${boardId}:${status}`) ?? -1;
  }

  let linked = 0;
  const nextStatus = new Map<string, string>();

  for (const link of detected) {
    const issue = byKey.get(link.issueKey);
    if (!issue) continue;

    try {
      await getPrisma().issueGitLink.create({
        data: {
          issueId: issue.id,
          repositoryId,
          linkType: link.linkType,
          reference: link.reference,
          title: link.title,
          webUrl: link.webUrl
        }
      });
      linked += 1;
    } catch (error) {
      // Already recorded: the sync is meant to be safe to repeat.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
    }

    if (link.implies) {
      const targetPosition = positionOf.get(`${issue.boardId}:${link.implies}`);
      if (targetPosition === undefined) continue; // stage renamed/removed
      const current = nextStatus.get(issue.id) ?? issue.status;
      const currentPosition = stagePosition(issue.boardId, current);
      if (targetPosition > currentPosition) {
        nextStatus.set(issue.id, link.implies);
      }
    }
  }

  let advanced = 0;
  for (const [issueId, status] of nextStatus) {
    const issue = issues.find((entry) => entry.id === issueId);
    if (!issue || issue.status === status) continue;
    await getPrisma().issue.update({
      where: { id: issueId },
      data: {
        status,
        events: {
          create: { type: 'STATUS', fromValue: issue.status, toValue: status, viaGit: true }
        }
      }
    });
    advanced += 1;
  }

  return { linked, advanced };
}

/**
 * Webhook entry point: resyncs every DevOne project tracking the repository
 * named in the payload (`full_name` / `path_with_namespace`). Each sync runs
 * as the connection owner, whose stored token authorizes the provider calls.
 * Safe to repeat — links are idempotent and statuses only advance forward.
 */
export async function syncIssuesForRepositoryFullName(provider: GitProvider, fullName: string) {
  const repositories = await getPrisma().repository.findMany({
    where: { fullName, connection: { provider } },
    include: {
      connection: { select: { userId: true } },
      projects: { select: { projectId: true } }
    }
  });

  const results: {
    projectId: string;
    linked: number;
    advanced: number;
    skipped?: string;
  }[] = [];
  for (const repository of repositories) {
    for (const link of repository.projects) {
      try {
        const { linked, advanced } = await syncIssueLinks(
          repository.connection.userId,
          link.projectId,
          repository.id
        );
        results.push({ projectId: link.projectId, linked, advanced });
      } catch {
        results.push({
          projectId: link.projectId,
          linked: 0,
          advanced: 0,
          skipped: 'sync failed'
        });
      }
    }
  }

  return { repositories: repositories.length, results };
}

/** A link's page on the provider: the branch, commit or pull request itself. */
function gitLinkUrl(
  provider: GitProvider,
  repositoryUrl: string,
  link: { linkType: IssueLinkType; reference: string; webUrl: string | null }
): string {
  if (link.webUrl) return link.webUrl;
  const gitlab = provider === GitProvider.GITLAB;
  const base = `${repositoryUrl.replace(/\/$/, '')}${gitlab ? '/-' : ''}`;
  switch (link.linkType) {
    case IssueLinkType.BRANCH:
      return `${base}/tree/${link.reference.split('/').map(encodeURIComponent).join('/')}`;
    case IssueLinkType.COMMIT:
      return `${base}/commit/${link.reference}`;
    case IssueLinkType.MERGE_REQUEST:
      return `${base}/${gitlab ? 'merge_requests' : 'pull'}/${link.reference}`;
  }
}

/** The repositories linked to the issue's project; only these can be linked from. */
async function requireIssueRepository(userId: string, issueId: string, repositoryId: string) {
  const issue = await requireIssue(userId, issueId);
  const linked = await getPrisma().projectRepository.findFirst({
    where: { projectId: issue.projectId, repositoryId },
    select: { id: true }
  });
  if (!linked) throw new IssueAccessError('That repository is not linked to this project');
  return issue;
}

/** A task's branches, commits and pull requests, plus the repositories it can link from. */
export async function listIssueGit(userId: string, issueId: string) {
  const issue = await requireIssue(userId, issueId);
  const [links, repositories] = await Promise.all([
    getPrisma().issueGitLink.findMany({
      where: { issueId },
      include: {
        repository: {
          select: { fullName: true, webUrl: true, connection: { select: { provider: true } } }
        }
      },
      orderBy: [{ linkType: 'asc' }, { detectedAt: 'desc' }]
    }),
    getPrisma().repository.findMany({
      where: { projects: { some: { projectId: issue.projectId } } },
      select: { id: true, fullName: true, defaultBranch: true },
      orderBy: { fullName: 'asc' }
    })
  ]);

  return {
    issueKey: issue.issueKey,
    title: issue.title,
    repositories,
    links: links.map((link) => ({
      id: link.id,
      linkType: link.linkType,
      reference: link.reference,
      title: link.title,
      repository: link.repository.fullName,
      url: gitLinkUrl(link.repository.connection.provider, link.repository.webUrl, link)
    }))
  };
}

/** Branch names in a repository linked to the task's project. */
/** Branch names in a repository linked to the project. */
export async function listProjectRepositoryBranches(
  userId: string,
  projectId: string,
  repositoryId: string
) {
  await requireProjectMembership(userId, projectId);
  const linked = await getPrisma().projectRepository.findFirst({
    where: { projectId, repositoryId },
    select: { id: true }
  });
  if (!linked) throw new IssueAccessError('That repository is not linked to this project');
  const { client, token, repository } = await openRepository(userId, repositoryId);
  const branches = await client.getBranches(token, repository.providerRepositoryId);
  return branches.map((branch) => branch.name);
}

/** Branch names in a repository linked to the task's project. */
export async function listIssueRepositoryBranches(
  userId: string,
  issueId: string,
  repositoryId: string
) {
  const issue = await requireIssueRepository(userId, issueId, repositoryId);
  return listProjectRepositoryBranches(userId, issue.projectId, repositoryId);
}

async function saveBranchLink(issueId: string, repositoryId: string, branch: string) {
  try {
    await getPrisma().issueGitLink.create({
      data: { issueId, repositoryId, linkType: IssueLinkType.BRANCH, reference: branch }
    });
  } catch (error) {
    // Already linked: nothing to do.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
  }
}

/** Links an existing branch to the task, whatever it is named. */
export async function linkIssueBranch(
  userId: string,
  issueId: string,
  repositoryId: string,
  branch: string
) {
  const branches = await listIssueRepositoryBranches(userId, issueId, repositoryId);
  if (!branches.includes(branch)) throw new IssueAccessError(`There is no branch named ${branch}`);
  await saveBranchLink(issueId, repositoryId, branch);
}

/** Creates a branch off `from` on the provider and links it to the task. */
export async function createIssueBranch(
  userId: string,
  issueId: string,
  repositoryId: string,
  name: string,
  from: string
) {
  await requireIssueRepository(userId, issueId, repositoryId);
  await createRepositoryBranch(userId, repositoryId, name, from);
  await saveBranchLink(issueId, repositoryId, name);
}

/** Removes one branch, commit or pull request link from a task. */
export async function unlinkIssueGitLink(userId: string, linkId: string) {
  const link = await getPrisma().issueGitLink.findFirst({
    where: { id: linkId, issue: { project: { members: { some: { userId } } } } },
    select: { id: true }
  });
  if (!link) throw new IssueAccessError('Link not found');
  await getPrisma().issueGitLink.delete({ where: { id: link.id } });
}
