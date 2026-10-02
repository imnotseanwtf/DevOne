'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Icons } from '@/components/icons';
import { jobLogOptions } from '@/features/devops/api/queries';
import { StatusBadge } from '@/features/devops/components/status-badge';
import { useXterm } from '@/features/devops/components/use-xterm';
import { isRunning } from '@/features/devops/status';
import { useT } from '@/i18n/client';
import type { GitPipelineJob } from '@/lib/git/provider';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

interface JobLogDialogProps {
  repositoryId: string;
  job: GitPipelineJob | null;
  onOpenChange: (open: boolean) => void;
}

export function JobLogDialog({ repositoryId, job, onOpenChange }: JobLogDialogProps) {
  return (
    <Dialog open={!!job} onOpenChange={onOpenChange}>
      <DialogContent className='flex h-[85vh] flex-col gap-3 sm:max-w-5xl'>
        {job && <JobLog repositoryId={repositoryId} job={job} />}
      </DialogContent>
    </Dialog>
  );
}

function JobLog({ repositoryId, job }: { repositoryId: string; job: GitPipelineJob }) {
  const running = isRunning(job.status);
  const t = useT();
  const {
    data: log,
    error,
    isPending,
    refetch,
    isFetching
  } = useQuery(jobLogOptions(repositoryId, job.id, running));

  return (
    <>
      <DialogHeader className='pr-8'>
        <DialogTitle className='flex flex-wrap items-center gap-2'>
          <Icons.terminal className='size-4' />
          {job.name}
          <StatusBadge status={job.status} />
        </DialogTitle>
        <DialogDescription className='flex flex-wrap items-center gap-x-3 gap-y-1'>
          {job.stage && <span>{t('devops.log.stage', { stage: job.stage })}</span>}
          {log?.truncated && <span>{t('devops.log.truncated')}</span>}
          {running && <span>{t('devops.log.refreshing')}</span>}
          <span className='ml-auto flex gap-2'>
            <Button
              size='sm'
              variant='outline'
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <Icons.refresh className={isFetching ? 'animate-spin' : undefined} />{' '}
              {t('common.refresh')}
            </Button>
            <Button
              size='sm'
              variant='outline'
              render={
                // oxlint-disable-next-line jsx-a11y/anchor-has-content, jsx-a11y/control-has-associated-label -- link text arrives via Button's render composition
                <a href={job.webUrl} target='_blank' rel='noreferrer noopener' />
              }
              nativeButton={false}
            >
              <Icons.externalLink /> {t('common.open')}
            </Button>
          </span>
        </DialogDescription>
      </DialogHeader>
      <div className='relative min-h-0 flex-1 overflow-hidden rounded-md bg-[#0a0a0a] p-2'>
        <LogTerminal text={log?.available ? log.text : ''} />
        {(isPending || error || (log && !log.available) || (log?.available && !log.text)) && (
          <p className='absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-neutral-400'>
            {isPending
              ? t('devops.log.loading')
              : error
                ? error.message
                : log && !log.available
                  ? running
                    ? t('devops.log.publishedLater')
                    : t('devops.log.noLog')
                  : t('devops.log.noOutput')}
          </p>
        )}
      </div>
    </>
  );
}

function LogTerminal({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminal = useXterm(containerRef, { readOnly: true });

  useEffect(() => {
    if (!terminal) return;
    terminal.reset();
    terminal.write(text, () => terminal.scrollToBottom());
  }, [terminal, text]);

  return <div ref={containerRef} className='h-full w-full' />;
}
