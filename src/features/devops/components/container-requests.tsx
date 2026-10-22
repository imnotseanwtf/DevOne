'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Icons } from '@/components/icons';
import { ContainerCapture } from '@/features/devops/components/container-capture';
import { useEventStream } from '@/features/devops/components/use-event-stream';
import { useT } from '@/i18n/client';
import type { ProxyRequest } from '@/lib/docker/access-log';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';

interface ContainerRequestsProps {
  projectId: string;
  source: string;
  containerId: string;
  /** Ports the app probably listens on, for the traffic capture. */
  ports: number[];
  canCapture: boolean;
  /** The stream is open only while this tab is showing. */
  active: boolean;
}

interface Meta {
  proxy: string;
  /** Requests of any service the proxy has logged since this stream opened. */
  seen: number;
}

const MAX_REQUESTS = 1000;
const SLOW_MS = 1000;

const CLASSES = ['all', '2xx', '3xx', '4xx', '5xx'] as const;
type StatusClass = (typeof CLASSES)[number];

const classOf = (status: number): StatusClass =>
  status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 300 ? '3xx' : '2xx';

const timeFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

const STATUS_TONE: Record<StatusClass, string> = {
  all: '',
  '2xx': 'border-emerald-500/50 text-emerald-600',
  '3xx': 'border-sky-500/50 text-sky-600',
  '4xx': 'border-amber-500/60 text-amber-600',
  '5xx': 'border-red-500/60 text-red-600'
};

/** Every request the reverse proxy sent to this container, read from the proxy's access log. */
export function ContainerRequests({
  projectId,
  source,
  containerId,
  ports,
  canCapture,
  active
}: ContainerRequestsProps) {
  const t = useT();
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState('');
  const [statusClass, setStatusClass] = useState<StatusClass>('all');
  const params = new URLSearchParams({ projectId, source, containerId });
  const { items, status, reason, meta, clear } = useEventStream<ProxyRequest, Meta>(
    active && !paused ? `/api/docker/requests?${params}` : null,
    MAX_REQUESTS
  );

  const counts = useMemo(() => {
    const result: Record<StatusClass, number> = {
      all: items.length,
      '2xx': 0,
      '3xx': 0,
      '4xx': 0,
      '5xx': 0
    };
    for (const request of items) result[classOf(request.status)]++;
    return result;
  }, [items]);

  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((request) => {
      if (statusClass !== 'all' && classOf(request.status) !== statusClass) return false;
      const haystack =
        `${request.method} ${request.path} ${request.client} ${request.host} ${request.status}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [items, query, statusClass]);

  const live = status === 'live' && !paused;
  const noAccessLog = meta !== null && meta.seen === 0;

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-3'>
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
              : meta
                ? t('devops.containers.requestsVia', { proxy: meta.proxy })
                : t('devops.containers.requestsLoading')}
        </p>
        <div className='ml-auto flex items-center gap-2'>
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

      <ContainerCapture
        projectId={projectId}
        source={source}
        containerId={containerId}
        ports={ports}
        canCapture={canCapture}
      />

      {noAccessLog && items.length === 0 ? (
        <div className='bg-muted/50 space-y-2 rounded-md border p-4 text-sm'>
          <p className='font-medium'>
            {t('devops.containers.noAccessLogTitle', { proxy: meta.proxy })}
          </p>
          <p className='text-muted-foreground'>{t('devops.containers.noAccessLogBody')}</p>
          <pre className='bg-background overflow-x-auto rounded-md border p-3 font-mono text-xs'>
            --accesslog=true{'\n'}--accesslog.format=json
          </pre>
        </div>
      ) : (
        <>
          <div className='flex flex-wrap items-center gap-3'>
            <div className='relative min-w-48 flex-1 sm:max-w-xs'>
              <Icons.search className='text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('devops.containers.requestsSearch')}
                aria-label={t('devops.containers.requestsSearch')}
                className='pl-8'
              />
            </div>
            <div role='group' className='flex flex-wrap gap-1'>
              {CLASSES.map((option) => (
                <Button
                  key={option}
                  variant={statusClass === option ? 'secondary' : 'ghost'}
                  size='sm'
                  aria-pressed={statusClass === option}
                  onClick={() => setStatusClass(option)}
                >
                  {option === 'all' ? t('devops.containers.allStatuses') : option}
                  <span className='text-muted-foreground ml-1 text-xs tabular-nums'>
                    {counts[option]}
                  </span>
                </Button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <p className='text-muted-foreground py-8 text-center text-sm'>
              {status === 'connecting' || (meta === null && status === 'live') ? (
                <span className='inline-flex items-center gap-2'>
                  <Icons.spinner className='size-4 animate-spin' />
                  {t('devops.containers.requestsLoading')}
                </span>
              ) : items.length > 0 ? (
                t('devops.containers.noMatch')
              ) : status === 'ended' && meta === null ? (
                // The stream failed before it could read the proxy: say why, not "no requests".
                (reason ?? t('devops.containers.logsEnded'))
              ) : (
                t('devops.containers.noRequests', { count: String(meta?.seen ?? 0) })
              )}
            </p>
          ) : (
            <div className='max-h-[60vh] overflow-auto rounded-md border'>
              <table className='w-full min-w-[44rem] text-left text-sm'>
                <thead className='bg-background text-muted-foreground sticky top-0 border-b text-xs'>
                  <tr>
                    <th className='px-3 py-2 font-medium'>{t('devops.containers.when')}</th>
                    <th className='px-3 py-2 font-medium'>{t('devops.containers.method')}</th>
                    <th className='px-3 py-2 font-medium'>{t('devops.containers.path')}</th>
                    <th className='px-3 py-2 font-medium'>{t('devops.containers.statusCode')}</th>
                    <th className='px-3 py-2 text-right font-medium'>
                      {t('devops.containers.duration')}
                    </th>
                    <th className='px-3 py-2 font-medium'>{t('devops.containers.client')}</th>
                  </tr>
                </thead>
                <tbody className='divide-border divide-y'>
                  {visible.map((request, index) => (
                    <tr key={`${request.time}-${index}`}>
                      <td className='text-muted-foreground px-3 py-1.5 whitespace-nowrap tabular-nums'>
                        {request.time ? timeFormat.format(request.time) : '—'}
                      </td>
                      <td className='px-3 py-1.5'>
                        <code className='font-mono text-xs font-medium'>{request.method}</code>
                      </td>
                      <td className='max-w-md px-3 py-1.5'>
                        <span
                          className='block truncate font-mono text-xs'
                          title={`${request.host}${request.path}`}
                        >
                          {request.path}
                        </span>
                        {request.host && (
                          <span className='text-muted-foreground block truncate text-xs'>
                            {request.host}
                          </span>
                        )}
                      </td>
                      <td className='px-3 py-1.5'>
                        <Badge variant='outline' className={STATUS_TONE[classOf(request.status)]}>
                          {request.status}
                        </Badge>
                      </td>
                      <td
                        className={cn(
                          'px-3 py-1.5 text-right whitespace-nowrap tabular-nums',
                          request.durationMs >= SLOW_MS && 'font-medium text-amber-600'
                        )}
                      >
                        {request.durationMs < 10
                          ? request.durationMs.toFixed(1)
                          : Math.round(request.durationMs)}{' '}
                        ms
                      </td>
                      <td className='text-muted-foreground px-3 py-1.5 font-mono text-xs'>
                        {request.client}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
