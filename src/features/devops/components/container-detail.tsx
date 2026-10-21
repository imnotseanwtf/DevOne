'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import {
  containerLogsAction,
  controlContainerAction,
  inspectContainerAction
} from '@/features/devops/actions';
import { ContainerExec } from '@/features/devops/components/container-exec';
import { ContainerInspect, ContainerMounts } from '@/features/devops/components/container-inspect';
import { ContainerStatsPanel } from '@/features/devops/components/container-stats';
import { stateVariant } from '@/features/devops/components/container-state';
import { useT } from '@/i18n/client';
import type { ContainerAction } from '@/lib/docker/containers';
import { LOG_TAIL_LINES } from '@/lib/docker/limits';
import { cn } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface ContainerDetailProps {
  projectId: string;
  source: string;
  sourceName: string;
  containerId: string;
  allowed: boolean;
  fontSize: number;
}

const TAB_LABELS = {
  logs: 'tabLogs',
  inspect: 'tabInspect',
  mounts: 'tabMounts',
  exec: 'tabExec',
  stats: 'tabStats'
} as const;
type Tab = keyof typeof TAB_LABELS;
const TABS = Object.keys(TAB_LABELS) as Tab[];

export function ContainerDetail({
  projectId,
  source,
  sourceName,
  containerId,
  allowed,
  fontSize
}: ContainerDetailProps) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('logs');
  const [deleting, setDeleting] = useState(false);
  const backHref = `/projects/${projectId}/devops/containers`;

  const detailsKey = ['devops', 'container', projectId, source, containerId];
  const details = useQuery({
    queryKey: detailsKey,
    queryFn: async () => {
      const result = await inspectContainerAction({ projectId, source, containerId });
      if (!result.ok) throw new Error(result.error);
      return result.details;
    },
    enabled: allowed,
    retry: false,
    refetchInterval: 5000
  });

  const control = useMutation({
    mutationFn: async (action: ContainerAction) => {
      const result = await controlContainerAction({ projectId, source, containerId, action });
      if (!result.ok) throw new Error(result.error);
      return action;
    },
    onSuccess: (action) => {
      if (action === 'remove') {
        router.push(backHref);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: detailsKey });
    },
    onError: (error: Error) =>
      toast.error(`${t('devops.containers.actionFailed')}: ${error.message}`)
  });

  const container = details.data;
  const running = container?.state === 'running';

  return (
    <div className='space-y-4'>
      <Link
        href={backHref}
        className='text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline'
      >
        <Icons.chevronLeft className='size-4' /> {t('devops.containers.back')}
      </Link>

      {!allowed ? (
        <Card>
          <CardContent className='py-6 text-sm'>{t('devops.terminal.ownersOnly')}</CardContent>
        </Card>
      ) : details.isError ? (
        <p role='alert' className='text-destructive text-sm'>
          {details.error.message}
        </p>
      ) : !container ? (
        <p className='text-muted-foreground text-sm'>{t('devops.containers.loading')}</p>
      ) : (
        <>
          <div className='flex flex-wrap items-start justify-between gap-4'>
            <div className='min-w-0 space-y-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <h2 className='truncate text-xl font-semibold'>{container.name}</h2>
                <Badge variant={stateVariant(container.state)}>{container.state}</Badge>
                {container.health && <Badge variant='outline'>{container.health}</Badge>}
              </div>
              <p className='text-muted-foreground text-sm break-all'>
                {container.image} · {sourceName}
              </p>
              <p className='text-muted-foreground font-mono text-xs break-all'>
                {t('devops.containers.id')} {container.id}
              </p>
            </div>
            <div className='flex flex-wrap gap-2'>
              {running ? (
                <Button
                  variant='outline'
                  disabled={control.isPending}
                  onClick={() => control.mutate('stop')}
                >
                  <Icons.stop /> {t('devops.containers.stop')}
                </Button>
              ) : (
                <Button
                  variant='outline'
                  disabled={control.isPending}
                  onClick={() => control.mutate('start')}
                >
                  <Icons.run /> {t('devops.containers.start')}
                </Button>
              )}
              <Button
                variant='outline'
                disabled={control.isPending}
                onClick={() => control.mutate('restart')}
              >
                <Icons.refresh /> {t('devops.containers.restart')}
              </Button>
              <Button
                variant='outline'
                className='text-destructive'
                disabled={control.isPending}
                onClick={() => setDeleting(true)}
              >
                <Icons.trash /> {t('devops.containers.delete')}
              </Button>
            </div>
          </div>

          <div role='tablist' className='flex gap-5 border-b'>
            {TABS.map((id) => (
              <button
                key={id}
                type='button'
                role='tab'
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  'text-muted-foreground hover:text-foreground -mb-px border-b-2 border-transparent px-1 pb-2 text-sm font-medium',
                  tab === id && 'border-foreground text-foreground'
                )}
              >
                {t(`devops.containers.${TAB_LABELS[id]}`)}
              </button>
            ))}
          </div>

          <div className={cn(tab !== 'logs' && 'hidden')}>
            <ContainerLogs projectId={projectId} source={source} containerId={containerId} />
          </div>
          <div className={cn(tab !== 'inspect' && 'hidden')}>
            <ContainerInspect container={container} />
          </div>
          <div className={cn(tab !== 'mounts' && 'hidden')}>
            <ContainerMounts container={container} />
          </div>
          {/* Kept mounted once opened, so switching tabs doesn't drop the shell. */}
          <div className={cn(tab !== 'exec' && 'hidden')}>
            <ContainerExec
              projectId={projectId}
              source={source}
              containerId={containerId}
              running={running}
              active={tab === 'exec'}
              local={source === 'local'}
              fontSize={fontSize}
            />
          </div>
          <div className={cn(tab !== 'stats' && 'hidden')}>
            <ContainerStatsPanel
              projectId={projectId}
              source={source}
              containerId={containerId}
              running={running}
              active={tab === 'stats'}
            />
          </div>
        </>
      )}

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('devops.containers.deleteTitle', { name: container?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('devops.containers.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => control.mutate('remove')}>
              {t('devops.containers.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ContainerLogs({
  projectId,
  source,
  containerId
}: {
  projectId: string;
  source: string;
  containerId: string;
}) {
  const t = useT();
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLPreElement>(null);

  const logs = useQuery({
    queryKey: ['devops', 'container-logs', projectId, source, containerId],
    queryFn: async () => {
      const result = await containerLogsAction({ projectId, source, containerId });
      if (!result.ok) throw new Error(result.error);
      return result.logs;
    },
    retry: false,
    refetchInterval: follow ? 3000 : false
  });

  // Keep the newest line in view.
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [logs.data]);

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between gap-2'>
        <p className='text-muted-foreground text-xs'>
          {t('devops.containers.logHint', { lines: String(LOG_TAIL_LINES) })}
        </p>
        <div className='flex items-center gap-2'>
          <Button
            variant={follow ? 'secondary' : 'outline'}
            size='sm'
            aria-pressed={follow}
            onClick={() => setFollow((current) => !current)}
          >
            {t('devops.containers.follow')}
          </Button>
          <Button
            variant='outline'
            size='sm'
            disabled={logs.isFetching}
            onClick={() => void logs.refetch()}
          >
            {logs.isFetching ? <Icons.spinner className='animate-spin' /> : <Icons.refresh />}
            {t('devops.containers.refresh')}
          </Button>
        </div>
      </div>
      {logs.isPending ? (
        <p className='text-muted-foreground text-sm'>{t('devops.containers.loadingLogs')}</p>
      ) : logs.isError ? (
        <p role='alert' className='text-destructive text-sm'>
          {logs.error.message}
        </p>
      ) : (
        <pre
          ref={box}
          className='h-[60vh] min-h-80 overflow-auto rounded-md bg-[#0a0a0a] p-3 font-mono text-xs break-all whitespace-pre-wrap text-neutral-200'
        >
          {logs.data || t('devops.containers.noLogs')}
        </pre>
      )}
    </div>
  );
}
