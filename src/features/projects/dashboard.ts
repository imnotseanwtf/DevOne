import { getPrisma } from '@/lib/db/prisma';
import { ProjectAccessError } from '@/features/projects/service';

/** Column names that mean the work is finished, whatever the board calls it. */
const DONE_NAME = /^(done|closed|complete|completed|resolved|shipped|released)$/i;

/**
 * The column that counts as "done" on a board: one named like Done, else the
 * last column (boards read left to right, finished work on the right).
 */
function doneColumnName(columns: { name: string; position: number }[]): string | null {
  const named = columns.find((column) => DONE_NAME.test(column.name.trim()));
  if (named) return named.name;
  return columns.toSorted((a, b) => b.position - a.position)[0]?.name ?? null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Weeks of history in the throughput chart. */
const TREND_WEEKS = 8;
/** Open, started tasks untouched for this long count as stuck. */
const STUCK_DAYS = 7;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Today as a UTC date, the way target dates are stored. */
function startOfToday(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
}

function stageName(status: string | null): string {
  if (!status) return '—';
  return status === 'BACKLOG' ? 'Backlog' : status;
}

const dayFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
});

/** One line for a history entry, e.g. "In Progress → Done". */
function describeEvent(event: { type: string; fromValue: string | null; toValue: string | null }) {
  switch (event.type) {
    case 'CREATED':
      return `Created in ${stageName(event.toValue)}`;
    case 'STATUS':
      return `${stageName(event.fromValue)} → ${stageName(event.toValue)}`;
    case 'ASSIGNEE':
      return event.toValue ? `Assigned to ${event.toValue}` : 'Unassigned';
    case 'PRIORITY':
      return `Priority ${event.fromValue ?? '—'} → ${event.toValue ?? '—'}`;
    case 'TARGET_DATE':
      return event.toValue
        ? `Target date ${dayFormat.format(new Date(`${event.toValue}T00:00:00Z`))}`
        : 'Target date removed';
    case 'ARCHIVED':
      return 'Deleted to the archive';
    case 'RESTORED':
      return `Restored to ${stageName(event.toValue)}`;
    default:
      return 'Changed';
  }
}

/**
 * Everything the project dashboard shows that lives in DevOne's own database.
 * Git provider data (pull requests, pipelines) is loaded separately, so a slow
 * provider never holds the page up.
 */
export async function getProjectDashboard(userId: string, projectId: string) {
  const db = getPrisma();
  const membership = await db.projectMember.findFirst({
    where: { projectId, userId },
    select: { id: true }
  });
  if (!membership) throw new ProjectAccessError();

  const now = Date.now();
  const weekAgo = new Date(now - WEEK_MS);
  const windowStart = new Date(now - TREND_WEEKS * WEEK_MS);
  const today = startOfToday();
  const soon = new Date(today.getTime() + 14 * DAY_MS);

  const [
    project,
    boards,
    statusCounts,
    priorities,
    assigned,
    createdThisWeek,
    sprint,
    recentEvents,
    moves,
    dated,
    recentDocs,
    recentDrawings,
    createdRecently,
    openIssues,
    resources,
    members
  ] = await Promise.all([
    db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, name: true, description: true, issuePrefix: true }
    }),
    db.board.findMany({
      where: { projectId },
      include: { columns: { orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'asc' }
    }),
    db.issue.groupBy({
      by: ['boardId', 'status'],
      where: { projectId, archivedAt: null },
      _count: { _all: true }
    }),
    db.issueFieldOption.findMany({
      where: { projectId, kind: 'PRIORITY' },
      select: { name: true, color: true, position: true }
    }),
    db.issue.findMany({
      where: { projectId, archivedAt: null, assigneeId: userId },
      select: {
        id: true,
        issueKey: true,
        title: true,
        status: true,
        priority: true,
        boardId: true,
        targetDate: true,
        updatedAt: true
      },
      orderBy: { updatedAt: 'desc' },
      take: 100
    }),
    db.issue.count({ where: { projectId, archivedAt: null, createdAt: { gte: weekAgo } } }),
    db.sprint.findFirst({
      where: { projectId, status: 'ACTIVE' },
      include: { issues: { where: { archivedAt: null }, select: { status: true, boardId: true } } },
      orderBy: { startsAt: 'desc' }
    }),
    db.issueEvent.findMany({
      where: { issue: { projectId } },
      select: {
        id: true,
        type: true,
        fromValue: true,
        toValue: true,
        viaGit: true,
        createdAt: true,
        actor: { select: { username: true } },
        issue: { select: { issueKey: true, title: true, boardId: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    }),
    db.issueEvent.findMany({
      where: { type: 'STATUS', createdAt: { gte: windowStart }, issue: { projectId } },
      select: {
        issueId: true,
        toValue: true,
        createdAt: true,
        issue: { select: { boardId: true, createdAt: true } }
      }
    }),
    // Open tasks with a target date up to two weeks out, overdue ones included.
    db.issue.findMany({
      where: { projectId, archivedAt: null, targetDate: { not: null, lte: soon } },
      select: {
        id: true,
        issueKey: true,
        title: true,
        status: true,
        boardId: true,
        targetDate: true,
        assignee: { select: { username: true } }
      },
      orderBy: { targetDate: 'asc' },
      take: 100
    }),
    db.docPage.findMany({
      where: { projectId },
      select: { slug: true, title: true, updatedAt: true, author: { select: { username: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 5
    }),
    db.drawing.findMany({
      where: { projectId },
      select: { id: true, title: true, updatedAt: true, author: { select: { username: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 5
    }),
    db.issue.findMany({
      where: { projectId, createdAt: { gte: windowStart } },
      select: { createdAt: true }
    }),
    db.issue.findMany({
      where: { projectId, archivedAt: null },
      select: {
        id: true,
        issueKey: true,
        title: true,
        status: true,
        boardId: true,
        assigneeId: true,
        targetDate: true,
        updatedAt: true,
        assignee: { select: { username: true } }
      },
      take: 5000
    }),
    // Shared API and app resources only: personal notes stay on their owner's page.
    db.projectResource.findMany({
      where: { projectId, ownerId: null, kind: { in: ['API', 'APP'] } },
      select: {
        id: true,
        name: true,
        kind: true,
        environment: true,
        url: true,
        branch: true,
        repositoryId: true,
        repository: { select: { fullName: true, defaultBranch: true } }
      },
      orderBy: { createdAt: 'asc' }
    }),
    db.projectMember.findMany({
      where: { projectId },
      select: { user: { select: { id: true, username: true, name: true } } }
    })
  ]);

  // Board progress: how many tasks sit in each column, and which one is "done".
  const counts = statusCounts.map((row) => ({
    boardId: row.boardId,
    status: row.status,
    count: row._count._all
  }));
  const countFor = (boardId: string, status: string) =>
    counts.find((row) => row.boardId === boardId && row.status === status)?.count ?? 0;
  const doneByBoard = new Map(boards.map((board) => [board.id, doneColumnName(board.columns)]));
  const isDone = (boardId: string, status: string) => doneByBoard.get(boardId) === status;

  const boardProgress = boards.map((board) => {
    const columns = board.columns.map((column) => ({
      name: column.name,
      color: column.color,
      count: countFor(board.id, column.name),
      done: column.name === doneByBoard.get(board.id)
    }));
    const backlog = countFor(board.id, 'BACKLOG');
    const total = backlog + columns.reduce((sum, column) => sum + column.count, 0);
    return { id: board.id, name: board.name, backlog, columns, total };
  });

  const openTasks = counts
    .filter((row) => !isDone(row.boardId, row.status))
    .reduce((sum, row) => sum + row.count, 0);

  // Your open tasks, most important first (priority options run low → high).
  const priorityRank = new Map(priorities.map((option) => [option.name, option.position]));
  const myOpen = assigned.filter((issue) => !isDone(issue.boardId, issue.status));
  const myTasks = myOpen
    .toSorted(
      (a, b) =>
        (priorityRank.get(b.priority) ?? -1) - (priorityRank.get(a.priority) ?? -1) ||
        b.updatedAt.getTime() - a.updatedAt.getTime()
    )
    .slice(0, 8)
    .map((issue) => ({
      ...issue,
      priorityColor: priorities.find((option) => option.name === issue.priority)?.color ?? null
    }));

  const activeSprint = sprint && {
    id: sprint.id,
    name: sprint.name,
    goal: sprint.goal,
    startsAt: sprint.startsAt,
    endsAt: sprint.endsAt,
    total: sprint.issues.length,
    done: sprint.issues.filter((issue) => isDone(issue.boardId, issue.status)).length
  };

  // One feed of what changed lately, newest first.
  const activity = [
    ...recentEvents.map((event) => ({
      kind: 'task' as const,
      id: event.id,
      title: `${event.issue.issueKey} ${event.issue.title}`,
      detail: describeEvent(event),
      who: event.viaGit ? 'via git' : (event.actor?.username ?? null),
      href: `/projects/${projectId}/issues?board=${event.issue.boardId}`,
      at: event.createdAt
    })),
    ...recentDocs.map((doc) => ({
      kind: 'doc' as const,
      id: doc.slug,
      title: doc.title,
      detail: 'Doc',
      who: doc.author.username,
      href: `/projects/${projectId}/docs?page=${encodeURIComponent(doc.slug)}`,
      at: doc.updatedAt
    })),
    ...recentDrawings.map((drawing) => ({
      kind: 'drawing' as const,
      id: drawing.id,
      title: drawing.title,
      detail: 'Drawing',
      who: drawing.author.username,
      href: `/projects/${projectId}/drawings?drawing=${drawing.id}`,
      at: drawing.updatedAt
    }))
  ]
    .toSorted((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 10);

  // Target dates: open tasks that are overdue or due in the next two weeks.
  const upcoming = dated
    .filter((issue) => !isDone(issue.boardId, issue.status))
    .map((issue) => {
      const due = issue.targetDate as Date;
      return {
        id: issue.id,
        issueKey: issue.issueKey,
        title: issue.title,
        status: issue.status,
        boardId: issue.boardId,
        assignee: issue.assignee?.username ?? null,
        targetDate: due.toISOString().slice(0, 10),
        daysLeft: Math.round((due.getTime() - today.getTime()) / DAY_MS)
      };
    });
  const overdueCount = upcoming.filter((issue) => issue.daysLeft < 0).length;

  // Throughput: tasks created and finished per week, oldest week first.
  const reachedDone = moves.filter(
    (move) => move.toValue !== null && isDone(move.issue.boardId, move.toValue)
  );
  const weekIndex = (at: Date) => TREND_WEEKS - 1 - Math.floor((now - at.getTime()) / WEEK_MS);
  const throughput = Array.from({ length: TREND_WEEKS }, (_, index) => ({
    start: new Date(now - (TREND_WEEKS - index) * WEEK_MS),
    created: 0,
    done: new Set<string>()
  }));
  for (const issue of createdRecently) {
    const week = throughput[weekIndex(issue.createdAt)];
    if (week) week.created += 1;
  }
  for (const move of reachedDone) {
    throughput[weekIndex(move.createdAt)]?.done.add(move.issueId);
  }
  const weeks = throughput.map((week) => ({
    start: week.start,
    created: week.created,
    done: week.done.size
  }));
  const doneThisWeek = weeks.at(-1)?.done ?? 0;
  const doneLastWeek = weeks.at(-2)?.done ?? 0;

  // Lead time: creation to the latest arrival in done, for work finished in 30 days.
  const monthAgo = now - 30 * DAY_MS;
  const finished = new Map<string, number>();
  for (const move of reachedDone) {
    if (move.createdAt.getTime() < monthAgo) continue;
    const days = (move.createdAt.getTime() - move.issue.createdAt.getTime()) / DAY_MS;
    finished.set(move.issueId, Math.max(finished.get(move.issueId) ?? 0, days));
  }
  const leadTimeDays = median([...finished.values()]);

  // Who holds the open work, and how much of it is late.
  const open = openIssues.filter((issue) => !isDone(issue.boardId, issue.status));
  const todayMs = today.getTime();
  const loadFor = (assigneeId: string | null) => {
    const mine = open.filter((issue) => issue.assigneeId === assigneeId);
    return {
      open: mine.length,
      started: mine.filter((issue) => issue.status !== 'BACKLOG').length,
      overdue: mine.filter((issue) => issue.targetDate && issue.targetDate.getTime() < todayMs)
        .length
    };
  };
  const workload = [
    ...members.map(({ user }) => ({
      id: user.id,
      name: user.name ?? user.username,
      ...loadFor(user.id)
    })),
    { id: null, name: 'Unassigned', ...loadFor(null) }
  ]
    .filter((row) => row.open > 0 || row.id !== null)
    .toSorted((a, b) => b.open - a.open);

  // Started work that hasn't changed in a while.
  const stuckBefore = now - STUCK_DAYS * DAY_MS;
  const stuck = open
    .filter((issue) => issue.status !== 'BACKLOG' && issue.updatedAt.getTime() < stuckBefore)
    .toSorted((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
    .map((issue) => ({
      id: issue.id,
      issueKey: issue.issueKey,
      title: issue.title,
      status: issue.status,
      boardId: issue.boardId,
      assignee: issue.assignee?.username ?? null,
      idleDays: Math.floor((now - issue.updatedAt.getTime()) / DAY_MS)
    }));

  return {
    project,
    members: members.length,
    openTasks,
    createdThisWeek,
    doneThisWeek,
    doneLastWeek,
    leadTimeDays,
    weeks,
    workload,
    stuck: stuck.slice(0, 6),
    stuckCount: stuck.length,
    overdueCount,
    upcoming: upcoming.slice(0, 8),
    upcomingCount: upcoming.length,
    myOpenCount: myOpen.length,
    myTasks,
    boardProgress,
    activeSprint,
    activity,
    resources
  };
}

export type ProjectDashboard = Awaited<ReturnType<typeof getProjectDashboard>>;
