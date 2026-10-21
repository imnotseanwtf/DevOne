'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { listContainersAction } from '@/features/devops/actions';
import { useT } from '@/i18n/client';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

interface HostSummary {
  id: string;
  name: string;
  address: string;
}

interface ContainersWorkspaceProps {
  projectId: string;
  hosts: HostSummary[];
  policy: {
    allowed: boolean;
    access: 'DISABLED' | 'OWNERS' | 'MEMBERS';
    isOwner: boolean;
  };
}

const LOCAL = 'local';

function stateVariant(state: string) {
  if (state === 'running') return 'default' as const;
  if (state === 'exited' || state === 'created') return 'secondary' as const;
  return 'destructive' as const;
}

export function ContainersWorkspace({ projectId, hosts, policy }: ContainersWorkspaceProps) {
  const t = useT();
  const [source, setSource] = useState<string>(policy.isOwner ? LOCAL : (hosts[0]?.id ?? ''));

  const sourceName =
    source === LOCAL
      ? t('devops.containers.local')
      : (hosts.find((h) => h.id === source)?.name ?? '');

  const containers = useQuery({
    queryKey: ['devops', 'containers', projectId, source],
    queryFn: async () => {
      const result = await listContainersAction({ projectId, source });
      if (!result.ok) throw new Error(result.error);
      return result.containers;
    },
    enabled: policy.allowed && source !== '',
    retry: false,
    refetchInterval: 15_000
  });

  if (!policy.allowed) {
    return (
      <Card>
        <CardContent className='flex flex-wrap items-center gap-3 py-6 text-sm'>
          <Icons.lock className='text-muted-foreground size-4' />
          {policy.access === 'DISABLED'
            ? t('devops.terminal.disabled')
            : t('devops.terminal.ownersOnly')}
          {policy.isOwner && (
            <Link
              href={`/projects/${projectId}/settings?tab=devops`}
              className='underline underline-offset-4'
            >
              {t('devops.terminal.changeInSettings')}
            </Link>
          )}
        </CardContent>
      </Card>
    );
  }

  const running = containers.data?.filter((entry) => entry.state === 'running').length ?? 0;

  return (
    <div className='grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]'>
      <Card className='h-fit'>
        <CardHeader>
          <CardTitle className='text-base'>{t('devops.containers.servers')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-1'>
          {policy.isOwner && (
            <Button
              variant='ghost'
              className={cn(
                'h-auto w-full justify-start px-2 py-1.5 text-left',
                source === LOCAL && 'bg-muted'
              )}
              aria-pressed={source === LOCAL}
              onClick={() => setSource(LOCAL)}
              title={t('devops.containers.localHint')}
            >
              <Icons.product />
              <span className='min-w-0 text-sm font-medium'>{t('devops.containers.local')}</span>
            </Button>
          )}
          {hosts.map((host) => (
            <Button
              key={host.id}
              variant='ghost'
              className={cn(
                'h-auto w-full justify-start px-2 py-1.5 text-left',
                source === host.id && 'bg-muted'
              )}
              aria-pressed={source === host.id}
              onClick={() => setSource(host.id)}
            >
              <Icons.server />
              <span className='min-w-0'>
                <span className='block truncate text-sm font-medium'>{host.name}</span>
                <span className='text-muted-foreground block truncate text-xs'>{host.address}</span>
              </span>
            </Button>
          ))}
          {hosts.length === 0 && (
            <p className='text-muted-foreground px-2 pt-2 text-sm'>
              {t('devops.containers.noServers')}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className='min-w-0'>
        <CardHeader className='flex flex-row items-center justify-between gap-3'>
          <CardTitle className='text-base'>
            {sourceName || t('devops.containers.selectSource')}
            {containers.data && (
              <span className='text-muted-foreground ml-3 text-xs font-normal'>
                {t('devops.containers.count', {
                  running: String(running),
                  total: String(containers.data.length)
                })}
              </span>
            )}
          </CardTitle>
          <Button
            variant='outline'
            size='sm'
            disabled={containers.isFetching || source === ''}
            onClick={() => void containers.refetch()}
          >
            {containers.isFetching ? <Icons.spinner className='animate-spin' /> : <Icons.refresh />}
            {t('devops.containers.refresh')}
          </Button>
        </CardHeader>
        <CardContent>
          {source === '' ? (
            <p className='text-muted-foreground text-sm'>{t('devops.containers.selectSource')}</p>
          ) : containers.isPending ? (
            <p className='text-muted-foreground text-sm'>{t('devops.containers.loading')}</p>
          ) : containers.isError ? (
            <p role='alert' className='text-destructive text-sm'>
              {containers.error.message}
            </p>
          ) : containers.data.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              {t('devops.containers.empty', { source: sourceName })}
            </p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full text-left text-sm'>
                <thead className='text-muted-foreground text-xs'>
                  <tr>
                    <th className='py-2 pr-4 font-medium'>{t('devops.containers.name')}</th>
                    <th className='py-2 pr-4 font-medium'>{t('devops.containers.image')}</th>
                    <th className='py-2 pr-4 font-medium'>{t('devops.containers.state')}</th>
                    <th className='py-2 pr-4 font-medium'>{t('devops.containers.status')}</th>
                    <th className='py-2 font-medium'>{t('devops.containers.ports')}</th>
                  </tr>
                </thead>
                <tbody className='divide-border divide-y'>
                  {containers.data.map((container) => (
                    <tr key={container.id}>
                      <td className='py-2 pr-4 font-medium'>
                        {container.name}
                        <span className='text-muted-foreground block font-mono text-xs font-normal'>
                          {container.id.slice(0, 12)}
                        </span>
                      </td>
                      <td className='py-2 pr-4 break-all'>{container.image}</td>
                      <td className='py-2 pr-4'>
                        <Badge variant={stateVariant(container.state)}>{container.state}</Badge>
                      </td>
                      <td className='py-2 pr-4 whitespace-nowrap'>{container.status}</td>
                      <td className='text-muted-foreground py-2 font-mono text-xs break-all'>
                        {container.ports || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
