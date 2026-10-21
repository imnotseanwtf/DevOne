'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Icons } from '@/components/icons';
import { containerExecAction, containerLogsAction } from '@/features/devops/actions';
import { useT } from '@/i18n/client';
import type { ContainerInfo } from '@/lib/docker/containers';
import { LOG_TAIL_LINES } from '@/lib/docker/limits';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

interface ContainerDialogProps {
  projectId: string;
  source: string;
  container: ContainerInfo | null;
  onClose: () => void;
}

interface RanCommand {
  command: string;
  output: string;
  exitCode: number | null;
}

const outputClass =
  'max-h-[50vh] overflow-auto rounded-md bg-[#0a0a0a] p-3 font-mono text-xs break-all whitespace-pre-wrap text-neutral-200';

export function ContainerDialog({ projectId, source, container, onClose }: ContainerDialogProps) {
  const t = useT();
  return (
    <Dialog open={!!container} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{container?.name}</DialogTitle>
          <DialogDescription>{container?.image}</DialogDescription>
        </DialogHeader>
        {container && (
          <Tabs defaultValue='logs' key={container.id}>
            <TabsList>
              <TabsTrigger value='logs'>{t('devops.containers.logs')}</TabsTrigger>
              <TabsTrigger value='run'>{t('devops.containers.run')}</TabsTrigger>
            </TabsList>
            <TabsContent value='logs'>
              <Logs projectId={projectId} source={source} containerId={container.id} />
            </TabsContent>
            <TabsContent value='run'>
              <Run
                projectId={projectId}
                source={source}
                containerId={container.id}
                running={container.state === 'running'}
              />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Logs({
  projectId,
  source,
  containerId
}: {
  projectId: string;
  source: string;
  containerId: string;
}) {
  const t = useT();
  const [follow, setFollow] = useState(false);
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
        <pre ref={box} className={outputClass}>
          {logs.data || t('devops.containers.noLogs')}
        </pre>
      )}
    </div>
  );
}

function Run({
  projectId,
  source,
  containerId,
  running
}: {
  projectId: string;
  source: string;
  containerId: string;
  running: boolean;
}) {
  const t = useT();
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<RanCommand[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async (value: string) => {
      const result = await containerExecAction({ projectId, source, containerId, command: value });
      if (!result.ok) throw new Error(result.error);
      return { command: value, ...result.result };
    },
    onSuccess: (ran) => {
      setError(null);
      setHistory((current) => [ran, ...current]);
      setCommand('');
    },
    onError: (failure: Error) => setError(failure.message)
  });

  return (
    <div className='space-y-3'>
      <form
        className='flex gap-2'
        onSubmit={(event) => {
          event.preventDefault();
          if (command.trim() && !run.isPending) run.mutate(command);
        }}
      >
        <Input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder={t('devops.containers.commandPlaceholder')}
          className='font-mono'
          autoComplete='off'
          spellCheck={false}
          disabled={!running}
          aria-label={t('devops.containers.run')}
        />
        <Button type='submit' disabled={!running || run.isPending || !command.trim()}>
          {run.isPending ? t('devops.containers.running') : t('devops.containers.runButton')}
        </Button>
      </form>
      <p className='text-muted-foreground text-xs'>{t('devops.containers.execHint')}</p>
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
      <div className='space-y-3'>
        {history.map((entry, index) => (
          <div key={history.length - index} className='space-y-1'>
            <div className='flex items-center gap-2 font-mono text-xs'>
              <span className='text-muted-foreground'>$</span>
              <span className='min-w-0 break-all'>{entry.command}</span>
              <span
                className={
                  entry.exitCode === 0 ? 'text-emerald-600' : 'text-destructive ml-auto shrink-0'
                }
              >
                {t('devops.containers.exit', { code: String(entry.exitCode ?? '?') })}
              </span>
            </div>
            <pre className={outputClass}>{entry.output || t('devops.containers.noOutput')}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
