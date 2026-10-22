'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Icons } from '@/components/icons';
import { useT } from '@/i18n/client';
import { CAPTURE_IMAGE, CAPTURE_SECONDS } from '@/lib/docker/limits';
import type { Exchange, HttpMessageBody } from '@/lib/docker/pcap';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

interface ContainerCaptureProps {
  projectId: string;
  source: string;
  containerId: string;
  /** Ports the app probably listens on, best guess first. */
  ports: number[];
  canCapture: boolean;
}

interface Run {
  port: number;
  seconds: number;
  reveal: boolean;
  /** Changes on each start, so the same settings can be run again. */
  id: number;
}

type Phase = 'running' | 'done';

function statusTone(status: number): string {
  if (status >= 500) return 'border-red-500/60 text-red-600';
  if (status >= 400) return 'border-amber-500/60 text-amber-600';
  if (status >= 300) return 'border-sky-500/50 text-sky-600';
  return 'border-emerald-500/50 text-emerald-600';
}

/** Capture a few seconds of this container's HTTP traffic and read each request next to its answer. */
export function ContainerCapture({
  projectId,
  source,
  containerId,
  ports,
  canCapture
}: ContainerCaptureProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [port, setPort] = useState(String(ports[0] ?? 80));
  const [seconds, setSeconds] = useState<number>(CAPTURE_SECONDS[1]);
  const [reveal, setReveal] = useState(false);
  const [understood, setUnderstood] = useState(false);

  const [run, setRun] = useState<Run | null>(null);
  const [phase, setPhase] = useState<Phase>('done');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const [left, setLeft] = useState(0);

  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;

  useEffect(() => {
    if (!run) return;
    setExchanges([]);
    setStatus('');
    setReason(null);
    setPhase('running');
    setLeft(run.seconds);

    const params = new URLSearchParams({
      projectId,
      source,
      containerId,
      port: String(run.port),
      seconds: String(run.seconds),
      reveal: run.reveal ? '1' : '0'
    });
    const stream = new EventSource(`/api/docker/capture?${params}`);
    const startedAt = Date.now();
    const timer = setInterval(
      () => setLeft(Math.max(0, run.seconds - Math.floor((Date.now() - startedAt) / 1000))),
      500
    );
    const finish = (message: string | null) => {
      clearInterval(timer);
      stream.close();
      setReason(message);
      setPhase('done');
    };

    stream.addEventListener('exchange', (event) => {
      const exchange = JSON.parse((event as MessageEvent<string>).data) as Exchange;
      setExchanges((current) => [...current, exchange]);
    });
    stream.addEventListener('status', (event) => {
      setStatus((JSON.parse((event as MessageEvent<string>).data) as { text: string }).text);
    });
    stream.addEventListener('end', (event) => {
      finish((JSON.parse((event as MessageEvent<string>).data) as { reason: string }).reason);
    });
    // A dropped link ends the capture: reconnecting would start a second one.
    stream.addEventListener('error', () => finish('Disconnected'));

    return () => {
      clearInterval(timer);
      stream.close();
    };
  }, [run, projectId, source, containerId]);

  if (!canCapture) {
    return <p className='text-muted-foreground text-xs'>{t('devops.containers.captureOwners')}</p>;
  }

  const start = () => {
    setOpen(false);
    setUnderstood(false);
    setRun({ port: portNumber, seconds, reveal, id: Date.now() });
  };

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-3'>
        {phase === 'running' ? (
          <Button
            variant='outline'
            size='sm'
            onClick={() => setRun(null)}
            aria-label={t('devops.containers.captureStop')}
          >
            <Icons.stop /> {t('devops.containers.captureStop')}
          </Button>
        ) : (
          <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
            <Icons.eye />{' '}
            {run ? t('devops.containers.captureAgain') : t('devops.containers.captureButton')}
          </Button>
        )}
        {run && (
          <p className='text-muted-foreground flex items-center gap-2 text-xs'>
            {phase === 'running' ? (
              <>
                <Icons.spinner className='size-3.5 animate-spin' />
                {status && !/listening/i.test(status)
                  ? status
                  : t('devops.containers.captureRunning', { seconds: String(left) })}
              </>
            ) : (
              <span>
                {reason && reason !== 'Capture finished'
                  ? reason
                  : t('devops.containers.captureDone', { count: String(exchanges.length) })}
              </span>
            )}
            <Badge variant='outline'>
              {run.reveal
                ? t('devops.containers.captureShown')
                : t('devops.containers.captureHidden')}
            </Badge>
          </p>
        )}
      </div>

      {run &&
        phase === 'done' &&
        exchanges.length === 0 &&
        (!reason || reason === 'Capture finished') && (
          <p className='text-muted-foreground text-sm'>{t('devops.containers.captureEmpty')}</p>
        )}

      {exchanges.length > 0 && (
        <div className='divide-border max-h-[70vh] divide-y overflow-auto rounded-md border'>
          {exchanges.map((exchange, index) => (
            <ExchangeRow key={index} exchange={exchange} />
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>{t('devops.containers.captureTitle')}</DialogTitle>
            <DialogDescription>{t('devops.containers.captureIntro')}</DialogDescription>
          </DialogHeader>
          <ul className='text-muted-foreground list-disc space-y-1.5 pl-5 text-sm'>
            <li>{t('devops.containers.captureWarnData')}</li>
            <li>{t('devops.containers.captureWarnRun', { image: CAPTURE_IMAGE })}</li>
            <li>{t('devops.containers.captureWarnKept')}</li>
          </ul>
          <div className='grid grid-cols-2 gap-3'>
            <label className='space-y-1.5 text-sm'>
              {t('devops.containers.capturePort')}
              <Input
                type='number'
                inputMode='numeric'
                min={1}
                max={65535}
                list='capture-ports'
                value={port}
                onChange={(event) => setPort(event.target.value)}
                aria-invalid={!portValid}
              />
              <datalist id='capture-ports'>
                {ports.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </datalist>
            </label>
            <label className='space-y-1.5 text-sm'>
              {t('devops.containers.captureDuration')}
              <NativeSelect
                className='w-full'
                value={seconds}
                onChange={(event) => setSeconds(Number(event.target.value))}
              >
                {CAPTURE_SECONDS.map((option) => (
                  <NativeSelectOption key={option} value={option}>
                    {t('devops.containers.captureSeconds', { count: String(option) })}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          </div>
          <label className='flex items-center gap-2 text-sm'>
            <Checkbox
              checked={reveal}
              onCheckedChange={(on) => setReveal(on)}
              aria-label={t('devops.containers.captureReveal')}
            />
            {t('devops.containers.captureReveal')}
          </label>
          <label className='flex items-center gap-2 text-sm font-medium'>
            <Checkbox
              checked={understood}
              onCheckedChange={(on) => setUnderstood(on)}
              aria-label={t('devops.containers.captureUnderstand')}
            />
            {t('devops.containers.captureUnderstand')}
          </label>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!understood || !portValid} onClick={start}>
              {t('devops.containers.captureStart')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const timeFormat = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

function ExchangeRow({ exchange }: { exchange: Exchange }) {
  const { request, response } = exchange;
  const t = useT();
  return (
    <details className='group'>
      <summary className='hover:bg-muted/40 flex cursor-pointer list-none flex-wrap items-center gap-3 px-3 py-2 text-sm'>
        <Icons.chevronRight className='text-muted-foreground size-4 transition-transform group-open:rotate-90' />
        <span className='text-muted-foreground tabular-nums'>
          {timeFormat.format(request.time)}
        </span>
        <code className='text-xs font-medium'>{request.method}</code>
        <span className='min-w-0 flex-1 truncate font-mono text-xs' title={request.target}>
          {request.target}
        </span>
        {response ? (
          <Badge variant='outline' className={statusTone(response.status)}>
            {response.status}
          </Badge>
        ) : (
          <Badge variant='outline'>—</Badge>
        )}
        <span className='text-muted-foreground w-16 text-right text-xs tabular-nums'>
          {exchange.durationMs === null ? '' : `${exchange.durationMs} ms`}
        </span>
      </summary>
      <div className='grid gap-4 px-3 pt-1 pb-4 lg:grid-cols-2'>
        <Message
          title={t('devops.containers.captureRequest')}
          startLine={`${request.method} ${request.target}`}
          headers={request.headers}
          body={request.body}
        />
        {response ? (
          <Message
            title={t('devops.containers.captureResponse')}
            startLine={`${response.status} ${response.reason}`}
            headers={response.headers}
            body={response.body}
          />
        ) : (
          <p className='text-muted-foreground text-sm'>
            {t('devops.containers.captureNoResponse')}
          </p>
        )}
      </div>
    </details>
  );
}

function Message({
  title,
  startLine,
  headers,
  body
}: {
  title: string;
  startLine: string;
  headers: [string, string][];
  body: HttpMessageBody;
}) {
  const t = useT();
  const size = String(body.size);
  const note =
    body.note === 'binary'
      ? t('devops.containers.captureBinary', { size })
      : body.note === 'undecoded'
        ? t('devops.containers.captureUndecoded', { size })
        : body.note === 'truncated'
          ? body.text === null
            ? t('devops.containers.captureWithheld', { size })
            : t('devops.containers.captureCutOff', { size })
          : null;
  return (
    <div className='min-w-0 space-y-2'>
      <h4 className='text-sm font-medium'>{title}</h4>
      <pre className='bg-muted/50 max-h-48 overflow-auto rounded-md p-2 font-mono text-xs break-all whitespace-pre-wrap'>
        <span className='font-semibold'>{startLine}</span>
        {headers.map(([key, value], index) => (
          <span key={index} className='block'>
            <span className='text-muted-foreground'>{key}:</span> {value}
          </span>
        ))}
      </pre>
      {body.text !== null && body.text !== '' ? (
        <pre className='bg-muted/50 max-h-64 overflow-auto rounded-md p-2 font-mono text-xs break-all whitespace-pre-wrap'>
          {body.text}
        </pre>
      ) : null}
      <p className={cn('text-xs', note ? 'text-muted-foreground' : 'text-muted-foreground/70')}>
        {note ?? (body.size === 0 ? t('devops.containers.captureNoBody') : '')}
      </p>
    </div>
  );
}
