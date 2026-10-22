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
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { controlContainerAction, inspectContainerAction } from '@/features/devops/actions';
import { ContainerEvents } from '@/features/devops/components/container-events';
import { ContainerLogs } from '@/features/devops/components/container-logs';
import { ContainerRequests } from '@/features/devops/components/container-requests';
import { ContainerExec } from '@/features/devops/components/container-exec';
import { ContainerInspect, ContainerMounts } from '@/features/devops/components/container-inspect';
import { ContainerStatsPanel } from '@/features/devops/components/container-stats';
import { stateVariant } from '@/features/devops/components/container-state';
import { candidatePorts } from '@/features/devops/container-format';
import { useT } from '@/i18n/client';
import type { ContainerAction } from '@/lib/docker/containers';
import { cn } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

interface ContainerDetailProps {
  projectId: string;
  source: string;
  sourceName: string;
  containerId: string;
  allowed: boolean;
  /** Project owners may capture a container's traffic. */
  isOwner: boolean;
  fontSize: number;
}

const TAB_LABELS = {
  logs: 'tabLogs',
  requests: 'tabRequests',
  events: 'tabEvents',
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
  isOwner,
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
        <DetailSkeleton />
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
            <ContainerLogs
              projectId={projectId}
              source={source}
              containerId={containerId}
              active={tab === 'logs'}
            />
          </div>
          <div className={cn(tab !== 'requests' && 'hidden')}>
            <ContainerRequests
              projectId={projectId}
              source={source}
              containerId={containerId}
              ports={candidatePorts(container)}
              canCapture={isOwner}
              active={tab === 'requests'}
            />
          </div>
          <div className={cn(tab !== 'events' && 'hidden')}>
            <ContainerEvents
              projectId={projectId}
              source={source}
              containerId={containerId}
              active={tab === 'events'}
            />
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

/** The page's shape while the first answer from Docker is on its way. */
function DetailSkeleton() {
  return (
    <div className='space-y-4' aria-busy='true'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='space-y-2'>
          <div className='flex items-center gap-2'>
            <Skeleton className='h-7 w-64' />
            <Skeleton className='h-5 w-16 rounded-full' />
          </div>
          <Skeleton className='h-4 w-80' />
          <Skeleton className='h-3 w-96 max-w-full' />
        </div>
        <div className='flex gap-2'>
          <Skeleton className='h-8 w-20' />
          <Skeleton className='h-8 w-24' />
          <Skeleton className='h-8 w-24' />
        </div>
      </div>
      <div className='flex gap-5 border-b pb-2'>
        {[10, 12, 20, 10, 12].map((width, index) => (
          <Skeleton key={index} className='h-4' style={{ width: `${width * 4}px` }} />
        ))}
      </div>
      <Skeleton className='h-[40vh] w-full' />
    </div>
  );
}
