import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DevOpsTabs } from '@/features/devops/components/devops-tabs';
import { RepositoryPipelines } from '@/features/devops/components/repository-pipelines';
import {
  getRepositoryMergeRequests,
  getRepositoryPipelines,
  listProjectRepositories
} from '@/features/git/service';
import { listConnectionsForProject } from '@/features/database/service';
import { listProjectsForUser } from '@/features/projects/service';
import { requireUser } from '@/lib/auth/session';
import { getT } from '@/i18n/server';
import { matchesAnyGlob } from '@/lib/glob';
import { getPrisma } from '@/lib/db/prisma';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'DevOps' };

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

interface DevOpsPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function DevOpsPage({ params }: DevOpsPageProps) {
  const user = await requireUser();
  const { projectId } = await params;
  const t = await getT();

  const projects = await listProjectsForUser(user.id);
  const activeProject = projects.find((entry) => entry.id === projectId);
  if (!activeProject) notFound();

  const [repositories, databases, settings] = await Promise.all([
    listProjectRepositories(user.id, activeProject.id),
    listConnectionsForProject(user.id, activeProject.id),
    getPrisma().project.findUniqueOrThrow({
      where: { id: activeProject.id },
      select: { hiddenPipelineBranches: true }
    })
  ]);
  const hidden = (branch: string) => matchesAnyGlob(branch, settings.hiddenPipelineBranches);

  const pipelines = await Promise.all(
    repositories.map(async (repository) => {
      const [runs, requests] = await Promise.all([
        getRepositoryPipelines(user.id, repository.id).catch(() => []),
        getRepositoryMergeRequests(user.id, repository.id).catch(() => [])
      ]);
      // GitHub says "open", GitLab "opened".
      const mergeRequests = requests.filter(
        (request) => request.state.startsWith('open') && !hidden(request.sourceBranch)
      );
      const visibleRuns = runs.filter((run) => !hidden(run.ref));
      return {
        repository,
        runs: visibleRuns,
        hiddenRuns: runs.length - visibleRuns.length,
        mergeRequests
      };
    })
  );

  return (
    <Shell projectId={activeProject.id}>
      <Card>
        <CardHeader>
          <CardTitle>{t('devops.databases')}</CardTitle>
        </CardHeader>
        <CardContent>
          {databases.length === 0 ? (
            <p className='text-muted-foreground text-sm'>{t('devops.noDatabases')}</p>
          ) : (
            <ul className='divide-border divide-y text-sm'>
              {databases.map((database) => (
                <li key={database.id} className='flex flex-wrap items-center gap-3 py-2'>
                  <span className='font-medium'>{database.name}</span>
                  <Badge variant='outline'>{database.environment}</Badge>
                  <Badge variant={database.readOnly ? 'secondary' : 'destructive'}>
                    {database.readOnly ? t('devops.readOnly') : t('devops.writesAllowed')}
                  </Badge>
                  <span className='text-muted-foreground ml-auto text-xs'>
                    {database.lastScannedAt
                      ? t('devops.scanned', { date: dateFormat.format(database.lastScannedAt) })
                      : t('devops.neverScanned')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {pipelines.length === 0 ? (
        <p className='text-muted-foreground text-sm'>{t('devops.linkRepository')}</p>
      ) : (
        pipelines.map(({ repository, runs, hiddenRuns, mergeRequests }) => (
          <Card key={repository.id}>
            <CardHeader>
              <CardTitle>{repository.fullName}</CardTitle>
            </CardHeader>
            <CardContent>
              <RepositoryPipelines
                repositoryId={repository.id}
                runs={runs}
                hiddenRuns={hiddenRuns}
                productionBranch={repository.productionBranch}
                mergeRequests={mergeRequests}
                mergeRequestLabel={
                  repository.provider === 'GITHUB'
                    ? t('devops.pullRequests')
                    : t('devops.mergeRequests')
                }
              />
            </CardContent>
          </Card>
        ))
      )}
    </Shell>
  );
}

async function Shell({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const t = await getT();
  return (
    <PageContainer pageTitle={t('devops.title')} pageDescription={t('devops.description')}>
      <div className='space-y-6'>
        <DevOpsTabs projectId={projectId} active='pipelines' />
        {children}
      </div>
    </PageContainer>
  );
}
