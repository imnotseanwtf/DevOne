'use client';

import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { useT } from '@/i18n/client';
import { LOG_TAIL_LINES } from '@/lib/docker/limits';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';

interface ContainerLogsProps {
  projectId: string;
  source: string;
  containerId: string;
  /** The stream is open only while this tab is showing. */
  active: boolean;
}

/** Keeps the page light: the oldest text is dropped past this. */
const MAX_CHARS = 500_000;
// Colour codes from the container's own logger; the log view is plain text.
const ANSI = new RegExp(String.raw`\u001b\[[0-9;?]*[A-Za-z]`, 'g');

type Status = 'connecting' | 'live' | 'ended';

/** The container's logs, live: `docker logs --follow` streamed as it writes. */
export function ContainerLogs({ projectId, source, containerId, active }: ContainerLogsProps) {
  const t = useT();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('connecting');
  const [reason, setReason] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const box = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (!active || paused) return;
    setText('');
    setReason(null);
    setStatus('connecting');

    const params = new URLSearchParams({ projectId, source, containerId });
    const stream = new EventSource(`/api/docker/logs?${params}`);
    let buffered = '';
    let frame = 0;
    const flush = () => {
      frame = 0;
      const chunk = buffered;
      buffered = '';
      setText((current) => (current + chunk).slice(-MAX_CHARS));
    };

    stream.addEventListener('open', () => setStatus('live'));
    stream.addEventListener('message', (event: MessageEvent<string>) => {
      buffered += (JSON.parse(event.data) as string).replace(ANSI, '');
      // Several chunks can land in one frame: one render for all of them.
      if (!frame) frame = requestAnimationFrame(flush);
    });
    const end = (message: string | null) => {
      stream.close();
      setStatus('ended');
      setReason(message);
    };
    stream.addEventListener('end', (event) => {
      const data = (event as MessageEvent<string>).data;
      end((JSON.parse(data) as { reason: string }).reason);
    });
    // A reconnect would replay the tail and duplicate lines, so a dropped link ends the stream.
    stream.addEventListener('error', () => end('Disconnected'));

    return () => {
      if (frame) cancelAnimationFrame(frame);
      stream.close();
    };
  }, [active, paused, projectId, source, containerId]);

  // Follows the newest line, unless the reader scrolled up to look at something.
  useEffect(() => {
    const element = box.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [text]);

  const live = status === 'live' && !paused;

  return (
    <div className='space-y-2'>
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
                ? t('devops.containers.loadingLogs')
                : t('devops.containers.logsLive', { lines: String(LOG_TAIL_LINES) })}
        </p>
        <div className='flex items-center gap-2'>
          <Button variant='outline' size='sm' onClick={() => setText('')}>
            {t('devops.containers.clear')}
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => {
              stick.current = true;
              setPaused((current) => !current);
            }}
          >
            {paused || status === 'ended' ? <Icons.run /> : <Icons.pause />}
            {paused || status === 'ended'
              ? t('devops.containers.resume')
              : t('devops.containers.pause')}
          </Button>
        </div>
      </div>
      <pre
        ref={box}
        onScroll={(event) => {
          const element = event.currentTarget;
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        }}
        className='h-[60vh] min-h-80 overflow-auto rounded-md bg-[#0a0a0a] p-3 font-mono text-xs break-all whitespace-pre-wrap text-neutral-200'
      >
        {text || (status === 'live' ? t('devops.containers.noLogs') : '')}
      </pre>
    </div>
  );
}
