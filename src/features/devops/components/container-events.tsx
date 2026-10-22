'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { useEventStream } from '@/features/devops/components/use-event-stream';
import { useT } from '@/i18n/client';
import type { en } from '@/i18n/messages/en';
import type { DockerEvent } from '@/lib/docker/events';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface ContainerEventsProps {
  projectId: string;
  source: string;
  containerId: string;
  /** The stream is open only while this tab is showing. */
  active: boolean;
}

const MAX_EVENTS = 500;

type ContainersKey = keyof typeof en.devops.containers;

/** How each Docker event is called, and how loudly. */
const EVENTS: Record<string, { label: ContainersKey; tone: 'good' | 'bad' | 'neutral' }> = {
  create: { label: 'evCreate', tone: 'neutral' },
  start: { label: 'evStart', tone: 'good' },
  restart: { label: 'evRestart', tone: 'neutral' },
  stop: { label: 'evStop', tone: 'neutral' },
  die: { label: 'evDie', tone: 'neutral' },
  kill: { label: 'evKill', tone: 'bad' },
  oom: { label: 'evOom', tone: 'bad' },
  pause: { label: 'evPause', tone: 'neutral' },
  unpause: { label: 'evUnpause', tone: 'good' },
  rename: { label: 'evRename', tone: 'neutral' },
  destroy: { label: 'evDestroy', tone: 'bad' },
  exec_start: { label: 'evExec', tone: 'neutral' },
  exec_die: { label: 'evExecDone', tone: 'neutral' },
  health_status: { label: 'evHealth', tone: 'neutral' }
};

const timeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' });

/** What happened to the container: starts, stops, crashes, health checks and every command run inside it. */
export function ContainerEvents({ projectId, source, containerId, active }: ContainerEventsProps) {
  const t = useT();
  const [paused, setPaused] = useState(false);
  const params = new URLSearchParams({ projectId, source, containerId });
  const { items, status, reason, clear } = useEventStream<DockerEvent>(
    active && !paused ? `/api/docker/events?${params}` : null,
    MAX_EVENTS
  );

  // exec_create repeats exec_start: one row per command is enough.
  const events = items.filter((event) => event.action !== 'exec_create');
  const live = status === 'live' && !paused;

  const detail = (event: DockerEvent) => {
    const code = event.attributes.exitCode;
    if (event.action === 'die')
      return code === undefined ? '' : `${t('devops.containers.exitCode')} ${code}`;
    if (event.action === 'exec_die')
      return code === undefined ? '' : `${t('devops.containers.exitCode')} ${code}`;
    if (event.action === 'kill')
      return event.attributes.signal ? `signal ${event.attributes.signal}` : '';
    if (event.action === 'rename') return event.attributes.oldName ?? '';
    return event.detail;
  };

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <p className='text-muted-foreground flex items-center gap-2 text-xs'>
          <span
            className={cn(
              'size-2 rounded-full',
              live ? 'animate-pulse bg-emerald-500' : 'bg-muted-foreground'
            )}
          />
          {paused
            ? t('devops.containers.logsPaused')
            : status === 'ended'
              ? (reason ?? t('devops.containers.logsEnded'))
              : status === 'connecting'
                ? t('devops.containers.eventsLoading')
                : t('devops.containers.eventsLive')}
        </p>
        <div className='flex items-center gap-2'>
          <Button variant='outline' size='sm' onClick={clear}>
            {t('devops.containers.clear')}
          </Button>
          <Button variant='outline' size='sm' onClick={() => setPaused((current) => !current)}>
            {paused || status === 'ended' ? <Icons.run /> : <Icons.pause />}
            {paused || status === 'ended'
              ? t('devops.containers.resume')
              : t('devops.containers.pause')}
          </Button>
        </div>
      </div>

      {events.length === 0 ? (
        <p className='text-muted-foreground py-8 text-center text-sm'>
          {status === 'connecting' ? (
            <span className='inline-flex items-center gap-2'>
              <Icons.spinner className='size-4 animate-spin' />
              {t('devops.containers.eventsLoading')}
            </span>
          ) : (
            t('devops.containers.noEvents')
          )}
        </p>
      ) : (
        <div className='max-h-[60vh] overflow-auto rounded-md border'>
          <table className='w-full text-left text-sm'>
            <thead className='bg-background text-muted-foreground sticky top-0 border-b text-xs'>
              <tr>
                <th className='px-3 py-2 font-medium'>{t('devops.containers.when')}</th>
                <th className='px-3 py-2 font-medium'>{t('devops.containers.event')}</th>
                <th className='px-3 py-2 font-medium'>{t('devops.containers.details')}</th>
              </tr>
            </thead>
            <tbody className='divide-border divide-y'>
              {events.map((event, index) => {
                const known = EVENTS[event.action];
                return (
                  <tr key={`${event.time}-${event.action}-${index}`}>
                    <td className='text-muted-foreground px-3 py-1.5 whitespace-nowrap tabular-nums'>
                      {timeFormat.format(event.time)}
                    </td>
                    <td className='px-3 py-1.5 whitespace-nowrap'>
                      <Badge
                        variant={known?.tone === 'bad' ? 'destructive' : 'outline'}
                        className={cn(
                          known?.tone === 'good' && 'border-emerald-500/50 text-emerald-600'
                        )}
                      >
                        {known ? t(`devops.containers.${known.label}`) : event.action}
                      </Badge>
                    </td>
                    <td className='px-3 py-1.5 font-mono text-xs break-all'>{detail(event)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
