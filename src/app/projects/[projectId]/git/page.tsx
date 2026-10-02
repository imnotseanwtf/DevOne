import { Icons } from '@/components/icons';
import PageContainer from '@/components/layout/page-container';
import { buttonVariants } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { OpenInVsCodeMenu } from '@/features/git/components/open-in-vscode-menu';
import {
  BranchControlProvider,
  HeaderBranchPicker
} from '@/features/git/components/workbench/branch-control';
import {
  RepositoryWorkbench,
  type WorkbenchPanel
} from '@/features/git/components/repository-workbench';
import {
  getMergeRequestMigrations,
  getRepositoryBranches,
  getRepositoryCommits,
  getRepositoryMergeRequests,
  listProjectRepositories
} from '@/features/git/service';
import { listProjectsForUser } from '@/features/projects/service';
import { requireUser } from '@/lib/auth/session';
import type { GitBranch } from '@/lib/git/provider';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSearchParamsCache, parseAsString, parseAsStringEnum } from 'nuqs/server';

export const metadata: Metadata = { title: 'Git' };

// Older links used one page per view; each now opens the matching workbench panel.
const PANEL_FOR_VIEW: Record<string, WorkbenchPanel> = {
  code: 'explorer',
  files: 'explorer',
  commits: 'history',
  branches: 'branches',
  pulls: 'pulls'
};

const gitSearchParams = createSearchParamsCache({
  repo: parseAsString,
  view: parseAsStringEnum(Object.keys(PANEL_FOR_VIEW)).withDefault('code'),
  ref: parseAsString,
  path: parseAsString.withDefault('')
});

interface GitPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function GitPage({ params, searchParams }: GitPageProps) {
  const user = await requireUser();
  const { projectId } = await params;
  const { repo, view, ref, path } = await gitSearchParams.parse(searchParams);

  const projects = await listProjectsForUser(user.id);
  const activeProject = projects.find((entry) => entry.id === projectId);
  if (!activeProject) notFound();

  const linked = await listProjectRepositories(user.id, activeProject.id);
  const repository = linked.find((entry) => entry.id === repo) ?? linked[0];

  if (!repository) {
    return (
      <PageContainer pageTitle='Git' pageDescription='Edit code, commit, and review branches.'>
        <EmptyState
          title='No repositories linked'
          description='Link one from the Projects page to edit its code, branches, and pull requests here.'
          actionLabel='Go to Projects'
          actionHref='/projects'
        />
      </PageContainer>
    );
  }

  const reference = ref ?? repository.defaultBranch;
  const description = 'Edit code, commit, and review branches.';

  let branches;
  try {
    branches = await getRepositoryBranches(user.id, repository.id);
  } catch {
    return (
      <PageContainer pageTitle='Git' pageDescription={description}>
        <EmptyState
          title='Could not reach the repository'
          description={`The provider did not answer for ${repository.fullName}. Check that your token can still read it.`}
        />
      </PageContainer>
    );
  }

  return (
    <BranchControlProvider>
      <PageContainer
        pageTitle='Git'
        pageDescription={description}
        pageHeaderAction={
          <div className='flex items-center gap-2'>
            <HeaderBranchPicker
              projectId={activeProject.id}
              branches={branches}
              defaultBranch={repository.defaultBranch}
              repositories={linked}
              activeRepositoryId={repository.id}
            />
            <OpenInVsCodeMenu
              provider={repository.provider}
              fullName={repository.fullName}
              webUrl={repository.webUrl}
              branch={reference}
            />
          </div>
        }
      >
        <Workbench
          userId={user.id}
          repository={repository}
          branches={branches}
          reference={reference}
          panel={PANEL_FOR_VIEW[view]}
          path={view === 'files' && path.split('/').pop()?.includes('.') ? path : undefined}
        />
      </PageContainer>
    </BranchControlProvider>
  );
}

async function Workbench({
  userId,
  repository,
  branches,
  reference,
  panel,
  path
}: {
  userId: string;
  repository: Awaited<ReturnType<typeof listProjectRepositories>>[number];
  branches: GitBranch[];
  reference: string;
  panel: WorkbenchPanel;
  path?: string;
}) {
  const [commits, mergeRequests] = await Promise.all([
    getRepositoryCommits(userId, repository.id, reference).catch(() => []),
    getRepositoryMergeRequests(userId, repository.id).catch(() => [])
  ]);

  // Only open requests are worth an extra call for their changed files.
  const pulls = await Promise.all(
    mergeRequests.map(async (request, index) => {
      const open = request.state !== 'merged' && request.state !== 'closed';
      if (!open || index >= 10) return { ...request, migrationCount: 0 };
      const { migrations } = await getMergeRequestMigrations(
        userId,
        repository.id,
        request.number
      ).catch(() => ({ migrations: [] as string[] }));
      return { ...request, migrationCount: migrations.length };
    })
  );

  return (
    <RepositoryWorkbench
      key={repository.id}
      repositoryId={repository.id}
      repositoryName={repository.fullName}
      provider={repository.provider}
      webUrl={repository.webUrl}
      defaultBranch={repository.defaultBranch}
      branches={branches}
      commits={commits}
      pulls={pulls}
      initialPanel={panel}
      initialPath={path}
    />
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  actionHref
}: {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <Empty className='bg-card min-h-80 border'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <Icons.github aria-hidden='true' />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {actionLabel && actionHref && (
        <EmptyContent>
          <Link href={actionHref} className={buttonVariants()}>
            {actionLabel}
          </Link>
        </EmptyContent>
      )}
    </Empty>
  );
}
