import { Icons } from '@/components/icons';
import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getRepositoryMergeRequests,
  getRepositoryPipelines,
  listProjectRepositories
} from '@/features/git/service';
import { ThroughputChart } from '@/features/projects/components/throughput-chart';
import { getProjectDashboard, type ProjectDashboard } from '@/features/projects/dashboard';
import { ENVIRONMENT_LABELS } from '@/features/resources/labels';
import { requireUser } from '@/lib/auth/session';
import { formatTimeAgo } from '@/lib/format';
import type { GitPipeline } from '@/lib/git/provider';
import { cn } from '@/lib/utils';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

export const metadata: Metadata = { title: 'Project Dashboard' };

const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const dueFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
});

/** "3 days overdue", "Due today", "Due tomorrow", "Due in 5 days". */
function dueLabel(daysLeft: number): string {
  if (daysLeft < -1) return `${-daysLeft} days overdue`;
  if (daysLeft === -1) return '1 day overdue';
  if (daysLeft === 0) return 'Due today';
  if (daysLeft === 1) return 'Due tomorrow';
  return `Due in ${daysLeft} days`;
}

const GOOD = new Set(['success', 'completed', 'passed']);
const BAD = new Set(['failure', 'failed', 'canceled', 'cancelled', 'timed_out']);

function statusVariant(status: string): 'secondary' | 'destructive' | 'outline' {
  const value = status.toLowerCase();
  if (GOOD.has(value)) return 'secondary';
  if (BAD.has(value)) return 'destructive';
  return 'outline';
}

export default async function ProjectDashboardPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;

  let dashboard: ProjectDashboard;
  try {
    dashboard = await getProjectDashboard(user.id, projectId);
  } catch {
    notFound();
  }

  const base = `/projects/${projectId}`;
  const sprint = dashboard.activeSprint;
  const sprintPercent =
    sprint && sprint.total > 0 ? Math.round((sprint.done / sprint.total) * 100) : null;
  const doneDelta = dashboard.doneThisWeek - dashboard.doneLastWeek;
  const trendWeeks = dashboard.weeks.map((week) => {
    const end = new Date(week.start.getTime() + 6 * 24 * 60 * 60 * 1000);
    return {
      label: dateFormat.format(week.start),
      range: `${dateFormat.format(week.start)} – ${dateFormat.format(end)}`,
      created: week.created,
      done: week.done
    };
  });
  const doneInWindow = dashboard.weeks.reduce((sum, week) => sum + week.done, 0);

  return (
    <PageContainer
      pageTitle={dashboard.project.name}
      pageDescription={
        dashboard.project.description ?? 'What needs attention across tasks, code and environments.'
      }
      pageHeaderAction={
        <Link href={`${base}/issues`} className={buttonVariants({ size: 'sm' })}>
          <Icons.kanban aria-hidden='true' />
          Open board
        </Link>
      }
    >
      <div className='space-y-4'>
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'>
          <StatTile
            label='Open tasks'
            icon={Icons.kanban}
            value={dashboard.openTasks}
            detail={
              dashboard.overdueCount > 0 ? (
                <span className='text-destructive font-medium'>
                  {dashboard.overdueCount} overdue
                </span>
              ) : (
                'Nothing overdue'
              )
            }
            footnote={`${dashboard.createdThisWeek} created this week`}
            href={`${base}/issues`}
          />
          <StatTile
            label='Completed this week'
            icon={Icons.circleCheck}
            value={dashboard.doneThisWeek}
            detail={
              <span className='inline-flex items-center gap-1'>
                {doneDelta >= 0 ? (
                  <Icons.trendingUp className='size-3.5' aria-hidden='true' />
                ) : (
                  <Icons.trendingDown className='size-3.5' aria-hidden='true' />
                )}
                {doneDelta === 0
                  ? 'Same as last week'
                  : `${Math.abs(doneDelta)} ${doneDelta > 0 ? 'more' : 'fewer'} than last week`}
              </span>
            }
            footnote={`${dashboard.doneLastWeek} last week`}
          />
          <StatTile
            label='Median lead time'
            icon={Icons.clock}
            value={formatDays(dashboard.leadTimeDays)}
            detail='From created to done'
            footnote='Tasks finished in the last 30 days'
          />
          <StatTile
            label='Assigned to you'
            icon={Icons.user}
            value={dashboard.myOpenCount}
            detail={dashboard.myOpenCount === 0 ? 'Nothing waiting on you' : 'Open tasks'}
            footnote={`${dashboard.members} member${dashboard.members === 1 ? '' : 's'} on this project`}
            href={`${base}/issues`}
          />
          <StatTile
            label={sprint ? sprint.name : 'Sprint'}
            icon={Icons.target}
            value={sprintPercent === null ? '—' : `${sprintPercent}%`}
            detail={sprint ? `${sprint.done} of ${sprint.total} tasks done` : 'No active sprint'}
            footnote={
              sprint?.endsAt
                ? `Ends ${dateFormat.format(sprint.endsAt)}`
                : 'Start one from the board'
            }
            progress={sprintPercent}
            href={`${base}/issues`}
          />
        </div>

        <div className='grid gap-4 lg:grid-cols-2'>
          <MyTasks projectId={projectId} tasks={dashboard.myTasks} total={dashboard.myOpenCount} />
          <TargetDates
            projectId={projectId}
            tasks={dashboard.upcoming}
            total={dashboard.upcomingCount}
          />
        </div>

        <div className='grid gap-4 lg:grid-cols-7'>
          <Card className='lg:col-span-4'>
            <CardHeader>
              <CardTitle>Throughput</CardTitle>
              <CardDescription>
                Tasks created and completed per week. {doneInWindow} completed in the last{' '}
                {dashboard.weeks.length} weeks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ThroughputChart weeks={trendWeeks} />
            </CardContent>
          </Card>
          <Workload rows={dashboard.workload} className='lg:col-span-3' />
        </div>

        <div className='grid items-start gap-4 lg:grid-cols-2'>
          <div className='space-y-4'>
            <BoardProgress projectId={projectId} boards={dashboard.boardProgress} />
            <Stuck projectId={projectId} tasks={dashboard.stuck} total={dashboard.stuckCount} />
          </div>
          <Activity items={dashboard.activity} />
        </div>

        <div className='grid gap-4 lg:grid-cols-2'>
          <Suspense fallback={<SectionSkeleton title='Environments' />}>
            <Environments userId={user.id} projectId={projectId} resources={dashboard.resources} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton title='Open pull requests' />}>
            <PullRequests userId={user.id} projectId={projectId} />
          </Suspense>
        </div>
      </div>
    </PageContainer>
  );
}

/** "3.5 days", "18 hours", or a dash when nothing finished yet. */
function formatDays(days: number | null): string {
  if (days === null) return '—';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`;
  return `${days < 10 ? Math.round(days * 10) / 10 : Math.round(days)}d`;
}

function StatTile({
  label,
  icon: Icon,
  value,
  detail,
  footnote,
  progress = null,
  href
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: number | string;
  detail: React.ReactNode;
  footnote: string;
  /** 0–100 draws a thin progress bar under the value. */
  progress?: number | null;
  href?: string;
}) {
  const body = (
    <Card
      className={cn(
        'h-full gap-3 py-5',
        href && 'hover:border-foreground/20 hover:bg-muted/30 transition-colors'
      )}
    >
      <CardHeader className='flex flex-row items-center justify-between gap-2 px-5'>
        <CardDescription className='truncate text-sm font-medium'>{label}</CardDescription>
        <span className='bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md'>
          <Icon className='size-4' />
        </span>
      </CardHeader>
      <CardContent className='space-y-1.5 px-5'>
        <p className='text-3xl font-semibold tracking-tight tabular-nums'>{value}</p>
        {progress !== null && (
          <div
            className='bg-muted h-1.5 overflow-hidden rounded-full'
            role='progressbar'
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${label} progress`}
          >
            <div className='bg-primary h-full rounded-full' style={{ width: `${progress}%` }} />
          </div>
        )}
        <p className='text-sm'>{detail}</p>
        <p className='text-muted-foreground truncate text-xs'>{footnote}</p>
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className='rounded-xl focus-visible:ring-2 focus-visible:outline-none'>
      {body}
    </Link>
  ) : (
    body
  );
}

/** Open tasks per person, split into started and not started. */
function Workload({ rows, className }: { rows: ProjectDashboard['workload']; className?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.open));
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Team workload</CardTitle>
        <CardDescription>Open tasks per person.</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='text-muted-foreground flex gap-4 text-xs'>
          <span className='inline-flex items-center gap-1.5'>
            <span className='bg-primary size-2.5 rounded-sm' aria-hidden='true' /> In progress
          </span>
          <span className='inline-flex items-center gap-1.5'>
            <span className='bg-muted-foreground/35 size-2.5 rounded-sm' aria-hidden='true' />{' '}
            Backlog
          </span>
        </div>
        {rows.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No open tasks.</p>
        ) : (
          <ul className='space-y-3'>
            {rows.map((row) => (
              <li key={row.id ?? 'unassigned'} className='space-y-1.5'>
                <div className='flex items-baseline justify-between gap-2 text-sm'>
                  <span
                    className={cn('truncate', row.id === null && 'text-muted-foreground italic')}
                  >
                    {row.name}
                  </span>
                  <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                    {row.open} open
                    {row.overdue > 0 && (
                      <span className='text-destructive font-medium'> · {row.overdue} overdue</span>
                    )}
                  </span>
                </div>
                <div
                  className='flex h-2 gap-0.5'
                  title={`${row.started} in progress, ${row.open - row.started} in backlog`}
                >
                  {row.started > 0 && (
                    <div
                      className='bg-primary rounded-sm'
                      style={{ width: `${(row.started / max) * 100}%` }}
                    />
                  )}
                  {row.open - row.started > 0 && (
                    <div
                      className='bg-muted-foreground/35 rounded-sm'
                      style={{ width: `${((row.open - row.started) / max) * 100}%` }}
                    />
                  )}
                  {row.open === 0 && <div className='bg-muted w-full rounded-sm' />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Started tasks nobody has touched for a week or more, oldest first. */
function Stuck({
  projectId,
  tasks,
  total
}: {
  projectId: string;
  tasks: ProjectDashboard['stuck'];
  total: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs a nudge</CardTitle>
        <CardDescription>Started tasks with no change in 7+ days.</CardDescription>
        {total > tasks.length && (
          <CardAction>
            <span className='text-muted-foreground text-xs'>{total - tasks.length} more</span>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className='text-muted-foreground flex items-center gap-2 text-sm'>
            <Icons.circleCheck className='size-4' aria-hidden='true' /> Everything in progress is
            moving.
          </p>
        ) : (
          <ul className='divide-border divide-y'>
            {tasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/projects/${projectId}/issues?board=${task.boardId}`}
                  className='hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-sm'
                >
                  <code className='text-muted-foreground shrink-0 text-xs'>{task.issueKey}</code>
                  <span className='min-w-0 flex-1 truncate'>{task.title}</span>
                  <span className='text-muted-foreground hidden shrink-0 text-xs sm:inline'>
                    {task.status} · {task.assignee ?? 'Unassigned'}
                  </span>
                  <Badge variant='outline' className='shrink-0 tabular-nums'>
                    {task.idleDays}d idle
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MyTasks({
  projectId,
  tasks,
  total
}: {
  projectId: string;
  tasks: ProjectDashboard['myTasks'];
  total: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your tasks</CardTitle>
        <CardDescription>Open and assigned to you, most important first.</CardDescription>
        {total > tasks.length && (
          <CardAction>
            <Link href={`/projects/${projectId}/issues`} className='text-xs underline'>
              All {total}
            </Link>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No open tasks assigned to you.</p>
        ) : (
          <ul className='divide-border divide-y'>
            {tasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/projects/${projectId}/issues?board=${task.boardId}`}
                  className='hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-sm'
                >
                  <code className='text-muted-foreground shrink-0 text-xs'>{task.issueKey}</code>
                  <span className='min-w-0 flex-1 truncate'>{task.title}</span>
                  <span className='text-muted-foreground hidden shrink-0 text-xs sm:inline'>
                    {task.status === 'BACKLOG' ? 'Backlog' : task.status}
                  </span>
                  {task.targetDate && (
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1 text-xs',
                        task.targetDate.getTime() <
                          Date.parse(new Date().toISOString().slice(0, 10))
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      )}
                      title='Target date'
                    >
                      <Icons.calendar className='size-3' aria-hidden='true' />
                      {dueFormat.format(task.targetDate)}
                    </span>
                  )}
                  <span className='inline-flex shrink-0 items-center gap-1.5 text-xs'>
                    <span
                      aria-hidden='true'
                      className='bg-muted-foreground size-2 rounded-full'
                      style={
                        task.priorityColor ? { backgroundColor: task.priorityColor } : undefined
                      }
                    />
                    {task.priority.charAt(0) + task.priority.slice(1).toLowerCase()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Open tasks past their target date or due in the next two weeks, soonest first. */
function TargetDates({
  projectId,
  tasks,
  total
}: {
  projectId: string;
  tasks: ProjectDashboard['upcoming'];
  total: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Overdue &amp; due soon</CardTitle>
        <CardDescription>Open tasks by target date, over the next two weeks.</CardDescription>
        {total > tasks.length && (
          <CardAction>
            <span className='text-muted-foreground text-xs'>{total - tasks.length} more</span>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            Nothing due in the next two weeks. Set a target date on a task to see it here.
          </p>
        ) : (
          <ul className='divide-border divide-y'>
            {tasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/projects/${projectId}/issues?board=${task.boardId}`}
                  className='hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-sm'
                >
                  <code className='text-muted-foreground shrink-0 text-xs'>{task.issueKey}</code>
                  <span className='min-w-0 flex-1 truncate'>{task.title}</span>
                  <span className='text-muted-foreground hidden shrink-0 text-xs sm:inline'>
                    {task.assignee ?? 'Unassigned'}
                  </span>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 text-xs',
                      task.daysLeft < 0
                        ? 'text-destructive font-medium'
                        : task.daysLeft === 0
                          ? 'font-medium'
                          : 'text-muted-foreground'
                    )}
                    title={dueFormat.format(new Date(`${task.targetDate}T00:00:00Z`))}
                  >
                    {task.daysLeft < 0 && (
                      <Icons.alertCircle className='size-3' aria-hidden='true' />
                    )}
                    {dueLabel(task.daysLeft)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Tasks per column on each board, as one bar split by column colour. */
function BoardProgress({
  projectId,
  boards
}: {
  projectId: string;
  boards: ProjectDashboard['boardProgress'];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Board progress</CardTitle>
        <CardDescription>Where every task sits, per board.</CardDescription>
      </CardHeader>
      <CardContent className='space-y-5'>
        {boards.length === 0 && <p className='text-muted-foreground text-sm'>No boards yet.</p>}
        {boards.map((board) => {
          const segments = [
            ...(board.backlog > 0
              ? [{ name: 'Backlog', color: null, count: board.backlog, done: false }]
              : []),
            ...board.columns
          ].filter((segment) => segment.count > 0);
          const done = board.columns.find((column) => column.done)?.count ?? 0;

          return (
            <div key={board.id} className='space-y-2'>
              <div className='flex items-baseline justify-between gap-2 text-sm'>
                <Link
                  href={`/projects/${projectId}/issues?board=${board.id}`}
                  className='font-medium hover:underline'
                >
                  {board.name}
                </Link>
                <span className='text-muted-foreground text-xs tabular-nums'>
                  {board.total === 0
                    ? 'No tasks'
                    : `${done} of ${board.total} done (${Math.round((done / board.total) * 100)}%)`}
                </span>
              </div>
              {board.total > 0 && (
                <>
                  <div
                    role='img'
                    aria-label={segments
                      .map((segment) => `${segment.name}: ${segment.count}`)
                      .join(', ')}
                    className='flex h-2.5 gap-0.5 overflow-hidden rounded-full'
                  >
                    {segments.map((segment) => (
                      <div
                        key={segment.name}
                        title={`${segment.name}: ${segment.count}`}
                        className='bg-muted-foreground/40 first:rounded-l-full last:rounded-r-full'
                        style={{
                          flexGrow: segment.count,
                          ...(segment.color ? { backgroundColor: segment.color } : {})
                        }}
                      />
                    ))}
                  </div>
                  <ul className='flex flex-wrap gap-x-3 gap-y-1 text-xs'>
                    {segments.map((segment) => (
                      <li key={segment.name} className='inline-flex items-center gap-1.5'>
                        <span
                          aria-hidden='true'
                          className='bg-muted-foreground/40 size-2 rounded-full'
                          style={segment.color ? { backgroundColor: segment.color } : undefined}
                        />
                        <span className='text-muted-foreground'>{segment.name}</span>
                        <span className='tabular-nums'>{segment.count}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Each shared API/app resource with its URL and the latest pipeline on its branch. */
async function Environments({
  userId,
  projectId,
  resources
}: {
  userId: string;
  projectId: string;
  resources: ProjectDashboard['resources'];
}) {
  // Pipelines are listed per repository, so each repository is asked once.
  const repositoryIds = [...new Set(resources.flatMap((resource) => resource.repositoryId ?? []))];
  const pipelines = new Map(
    await Promise.all(
      repositoryIds.map(
        async (id): Promise<[string, GitPipeline[] | null]> => [
          id,
          await getRepositoryPipelines(userId, id).catch(() => null)
        ]
      )
    )
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Environments</CardTitle>
        <CardDescription>Where the app runs, and its latest build.</CardDescription>
        <CardAction>
          <Link href={`/projects/${projectId}/resources`} className='text-xs underline'>
            Resources
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {resources.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            No environments yet. Add your API or app URLs on the{' '}
            <Link href={`/projects/${projectId}/resources`} className='underline'>
              Resources
            </Link>{' '}
            page.
          </p>
        ) : (
          <ul className='divide-border divide-y'>
            {resources.map((resource) => {
              const branch = resource.branch ?? resource.repository?.defaultBranch ?? null;
              const run =
                resource.repositoryId && branch
                  ? pipelines.get(resource.repositoryId)?.find((entry) => entry.ref === branch)
                  : undefined;
              return (
                <li
                  key={resource.id}
                  className='flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm'
                >
                  <span className='font-medium'>{resource.name}</span>
                  <Badge
                    variant={resource.environment === 'PRODUCTION' ? 'destructive' : 'outline'}
                  >
                    {ENVIRONMENT_LABELS[resource.environment]}
                  </Badge>
                  {resource.url && (
                    <a
                      href={resource.url}
                      target='_blank'
                      rel='noreferrer noopener'
                      className='text-muted-foreground inline-flex min-w-0 items-center gap-1 truncate text-xs hover:underline'
                    >
                      {resource.url.replace(/^https?:\/\//, '')}
                      <Icons.externalLink className='size-3 shrink-0' />
                    </a>
                  )}
                  <span className='ml-auto inline-flex items-center gap-2 text-xs'>
                    {branch && (
                      <code className='text-muted-foreground inline-flex items-center gap-1'>
                        <Icons.gitBranch className='size-3' />
                        {branch}
                      </code>
                    )}
                    {run ? (
                      <a href={run.webUrl} target='_blank' rel='noreferrer noopener'>
                        <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                      </a>
                    ) : resource.repositoryId ? (
                      <span className='text-muted-foreground'>No runs</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Open pull/merge requests across the project's repositories, newest first. */
async function PullRequests({ userId, projectId }: { userId: string; projectId: string }) {
  const repositories = await listProjectRepositories(userId, projectId);
  const results = await Promise.all(
    repositories.map(async (repository) => ({
      repository,
      requests: await getRepositoryMergeRequests(userId, repository.id).catch(() => null)
    }))
  );
  const unreachable = results.filter((result) => result.requests === null).length;
  const open = results
    .flatMap(({ repository, requests }) =>
      (requests ?? [])
        .filter((request) => request.state !== 'merged' && request.state !== 'closed')
        .map((request) => ({ ...request, repository: repository.fullName }))
    )
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Open pull requests{' '}
          <span className='text-muted-foreground tabular-nums'>{open.length}</span>
        </CardTitle>
        <CardDescription>Waiting for review or merge.</CardDescription>
        <CardAction>
          <Link href={`/projects/${projectId}/git`} className='text-xs underline'>
            Git
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className='space-y-2'>
        {repositories.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No repositories linked to this project.</p>
        ) : open.length === 0 ? (
          <p className='text-muted-foreground text-sm'>Nothing open.</p>
        ) : (
          <ul className='divide-border divide-y'>
            {open.slice(0, 6).map((request) => (
              <li key={`${request.repository}#${request.number}`} className='py-2 text-sm'>
                <a
                  href={request.webUrl}
                  target='_blank'
                  rel='noreferrer noopener'
                  className='flex items-baseline gap-2 hover:underline'
                >
                  <span className='text-muted-foreground shrink-0 text-xs'>#{request.number}</span>
                  <span className='min-w-0 flex-1 truncate'>{request.title}</span>
                </a>
                <p className='text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 text-xs'>
                  <span>{request.author}</span>
                  <code>
                    {request.sourceBranch} → {request.targetBranch}
                  </code>
                  <span>{formatTimeAgo(request.createdAt)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
        {unreachable > 0 && (
          <p className='text-muted-foreground text-xs'>
            {`${unreachable} ${unreachable === 1 ? 'repository' : 'repositories'} couldn't be reached.`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Activity({ items }: { items: ProjectDashboard['activity'] }) {
  const icon = { task: Icons.kanban, doc: Icons.page, drawing: Icons.palette } as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Task moves and edits, docs and drawings.</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className='text-muted-foreground text-sm'>Nothing yet.</p>
        ) : (
          <ul className='space-y-2.5'>
            {items.map((item) => {
              const Icon = icon[item.kind];
              return (
                <li key={`${item.kind}-${item.id}`} className='flex gap-2.5 text-sm'>
                  <Icon className='text-muted-foreground mt-0.5 size-4 shrink-0' />
                  <div className='min-w-0'>
                    <Link href={item.href} className='block truncate hover:underline'>
                      {item.title}
                    </Link>
                    <p className='text-muted-foreground text-xs'>
                      {item.detail}
                      {item.who && ` · ${item.who}`} · {formatTimeAgo(item.at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-2'>
        <Skeleton className='h-5 w-full' />
        <Skeleton className='h-5 w-5/6' />
        <Skeleton className='h-5 w-2/3' />
      </CardContent>
    </Card>
  );
}
