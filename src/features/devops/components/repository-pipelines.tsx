'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Icons } from '@/components/icons';
import { mergeRequestPipelinesOptions, pipelineJobsOptions } from '@/features/devops/api/queries';
import { JobLogDialog } from '@/features/devops/components/job-log-dialog';
import { StatusBadge } from '@/features/devops/components/status-badge';
import type { GitMergeRequest, GitPipeline, GitPipelineJob } from '@/lib/git/provider';
import { useT } from '@/i18n/client';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

function duration(job: GitPipelineJob): string | null {
  if (!job.startedAt) return null;
  const end = job.finishedAt ?? new Date();
  const seconds = Math.max(0, Math.round((end.getTime() - job.startedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

interface RepositoryPipelinesProps {
  repositoryId: string;
  runs: GitPipeline[];
  /** Runs left out because their branch is hidden in the project's settings. */
  hiddenRuns: number;
  productionBranch: string | null;
  /** Open merge requests, newest first. */
  mergeRequests: GitMergeRequest[];
  /** "Pull requests" on GitHub, "Merge requests" on GitLab. */
  mergeRequestLabel: string;
}

/** A repository's CI: open merge requests with their pipelines, and recent runs. */
export function RepositoryPipelines({
  repositoryId,
  runs,
  hiddenRuns,
  productionBranch,
  mergeRequests,
  mergeRequestLabel
}: RepositoryPipelinesProps) {
  const [logJob, setLogJob] = useState<GitPipelineJob | null>(null);
  const t = useT();

  return (
    <>
      <Tabs defaultValue={mergeRequests.length > 0 ? 'merge-requests' : 'runs'}>
        <TabsList>
          <TabsTrigger value='merge-requests'>
            {mergeRequestLabel}
            <Badge variant='secondary' className='ml-1'>
              {mergeRequests.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value='runs'>{t('devops.recentRuns')}</TabsTrigger>
        </TabsList>
        <TabsContent value='merge-requests' className='pt-2'>
          {mergeRequests.length === 0 ? (
            <p className='text-muted-foreground py-2 text-sm'>
              {t('devops.noOpen', { kind: mergeRequestLabel.toLowerCase() })}
            </p>
          ) : (
            <ul className='divide-border divide-y'>
              {mergeRequests.map((request) => (
                <MergeRequestRow
                  key={request.number}
                  repositoryId={repositoryId}
                  request={request}
                  productionBranch={productionBranch}
                  onShowLog={setLogJob}
                />
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value='runs' className='pt-2'>
          <PipelineList
            repositoryId={repositoryId}
            pipelines={runs.slice(0, 10)}
            productionBranch={productionBranch}
            empty={t('devops.noRuns')}
            onShowLog={setLogJob}
          />
          {hiddenRuns > 0 && (
            <p className='text-muted-foreground mt-2 text-xs'>
              {t('devops.hiddenBranches', { count: hiddenRuns })}
            </p>
          )}
        </TabsContent>
      </Tabs>
      <JobLogDialog
        repositoryId={repositoryId}
        job={logJob}
        onOpenChange={(open) => !open && setLogJob(null)}
      />
    </>
  );
}

interface ShowLog {
  onShowLog: (job: GitPipelineJob) => void;
  productionBranch: string | null;
}

function ProductionBadge() {
  const t = useT();
  return (
    <Badge variant='default' className='h-5 text-[10px] uppercase'>
      {t('devops.production')}
    </Badge>
  );
}

function MergeRequestRow({
  repositoryId,
  request,
  productionBranch,
  onShowLog
}: ShowLog & { repositoryId: string; request: GitMergeRequest }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  // Loaded on the first expand only, then kept fresh while anything runs.
  const { data, error, isPending } = useQuery({
    ...mergeRequestPipelinesOptions(repositoryId, request.number),
    enabled: open
  });
  const latest = data?.[0];

  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className='flex flex-wrap items-center gap-3 py-2 text-sm'>
          <CollapsibleTrigger
            render={<Button variant='ghost' size='icon' className='size-7' />}
            aria-label={open ? t('devops.hidePipelines') : t('devops.showPipelines')}
          >
            <Icons.chevronRight className={cn('transition-transform', open && 'rotate-90')} />
          </CollapsibleTrigger>
          <Icons.gitPullRequest className='text-muted-foreground size-4' />
          <a
            href={request.webUrl}
            target='_blank'
            rel='noreferrer noopener'
            className='font-medium hover:underline'
          >
            #{request.number} {request.title}
          </a>
          <code className='text-muted-foreground text-xs'>
            {request.sourceBranch} → {request.targetBranch}
          </code>
          {productionBranch === request.targetBranch && <ProductionBadge />}
          {latest && <StatusBadge status={latest.status} />}
          <span className='text-muted-foreground ml-auto text-xs'>{request.author}</span>
        </div>
        <CollapsibleContent className='pb-3 pl-10'>
          {isPending ? (
            <p className='text-muted-foreground text-sm'>{t('devops.loadingPipelines')}</p>
          ) : error ? (
            <p className='text-destructive text-sm'>{error.message}</p>
          ) : (
            <PipelineList
              repositoryId={repositoryId}
              pipelines={data}
              productionBranch={productionBranch}
              empty={t('devops.noMrPipelines')}
              onShowLog={onShowLog}
            />
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function PipelineList({
  repositoryId,
  pipelines,
  empty,
  productionBranch,
  onShowLog
}: ShowLog & { repositoryId: string; pipelines: GitPipeline[]; empty: string }) {
  if (pipelines.length === 0) return <p className='text-muted-foreground text-sm'>{empty}</p>;
  return (
    <ul className='divide-border divide-y rounded-md border'>
      {pipelines.map((pipeline) => (
        <PipelineRow
          key={pipeline.id}
          repositoryId={repositoryId}
          pipeline={pipeline}
          productionBranch={productionBranch}
          onShowLog={onShowLog}
        />
      ))}
    </ul>
  );
}

function PipelineRow({
  repositoryId,
  pipeline,
  productionBranch,
  onShowLog
}: ShowLog & { repositoryId: string; pipeline: GitPipeline }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className='flex flex-wrap items-center gap-3 px-2 py-2 text-sm'>
          <CollapsibleTrigger
            render={<Button variant='ghost' size='icon' className='size-7' />}
            aria-label={open ? t('devops.hideJobs') : t('devops.showJobs')}
          >
            <Icons.chevronRight className={cn('transition-transform', open && 'rotate-90')} />
          </CollapsibleTrigger>
          <StatusBadge status={pipeline.status} />
          <a
            href={pipeline.webUrl}
            target='_blank'
            rel='noreferrer noopener'
            className='font-medium hover:underline'
          >
            {pipeline.name}
          </a>
          <code className='text-muted-foreground text-xs'>{pipeline.ref}</code>
          {productionBranch === pipeline.ref && <ProductionBadge />}
          <span className='text-muted-foreground ml-auto text-xs'>
            {dateFormat.format(pipeline.createdAt)}
          </span>
        </div>
        <CollapsibleContent className='px-2 pb-2 pl-11'>
          {open && (
            <PipelineJobs
              repositoryId={repositoryId}
              pipelineId={pipeline.id}
              onShowLog={onShowLog}
            />
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function PipelineJobs({
  repositoryId,
  pipelineId,
  onShowLog
}: Pick<ShowLog, 'onShowLog'> & { repositoryId: string; pipelineId: string }) {
  const { data: jobs, error, isPending } = useQuery(pipelineJobsOptions(repositoryId, pipelineId));
  const t = useT();

  if (isPending) return <p className='text-muted-foreground text-sm'>{t('devops.loadingJobs')}</p>;
  if (error) return <p className='text-destructive text-sm'>{error.message}</p>;
  if (jobs.length === 0)
    return <p className='text-muted-foreground text-sm'>{t('devops.noJobs')}</p>;

  return (
    <ul className='space-y-1'>
      {jobs.map((job) => (
        <li key={job.id} className='flex flex-wrap items-center gap-3 text-sm'>
          <StatusBadge status={job.status} />
          {job.stage && <span className='text-muted-foreground text-xs'>{job.stage}</span>}
          <span>{job.name}</span>
          <span className='text-muted-foreground text-xs'>{duration(job)}</span>
          <Button
            variant='outline'
            size='sm'
            className='ml-auto h-7'
            onClick={() => onShowLog(job)}
          >
            <Icons.terminal /> {t('devops.logs')}
          </Button>
        </li>
      ))}
    </ul>
  );
}
