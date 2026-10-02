'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { testConnectionAction } from '@/features/database/actions';
import { cn } from '@/lib/utils';
import { useEffect, useState, useTransition } from 'react';

type Status = 'checking' | 'connected' | 'disconnected';

/**
 * Tests the connection as soon as it is shown: Connected, or Disconnected with
 * the reason on hover and a Retry button. "Test connection" re-checks on demand.
 */
export function ConnectionStatus({
  connectionId,
  className
}: {
  connectionId: string;
  className?: string;
}) {
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const test = () => {
    setStatus('checking');
    setError(undefined);
    startTransition(async () => {
      const result = await testConnectionAction({ connectionId });
      setStatus(result.ok ? 'connected' : 'disconnected');
      if (!result.ok) setError(result.error ?? 'Could not reach the database');
    });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(test, [connectionId]);

  return (
    <span className={cn('relative z-10 flex flex-wrap items-center gap-2', className)}>
      <span
        role='status'
        title={status === 'disconnected' ? error : undefined}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
          status === 'connected' &&
            'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
          status === 'disconnected' && 'border-destructive/30 bg-destructive/10 text-destructive',
          status === 'checking' && 'text-muted-foreground'
        )}
      >
        <span
          aria-hidden='true'
          className={cn(
            'size-1.5 rounded-full',
            status === 'connected' && 'bg-emerald-500',
            status === 'disconnected' && 'bg-destructive',
            status === 'checking' && 'bg-muted-foreground animate-pulse'
          )}
        />
        {status === 'checking'
          ? 'Checking…'
          : status === 'connected'
            ? 'Connected'
            : 'Disconnected'}
      </span>
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='h-7'
        disabled={pending}
        onClick={test}
      >
        {pending ? (
          <Icons.spinner className='size-3.5 animate-spin' aria-hidden='true' />
        ) : status === 'disconnected' ? (
          <Icons.refresh className='size-3.5' aria-hidden='true' />
        ) : (
          <Icons.connected className='size-3.5' aria-hidden='true' />
        )}
        {status === 'disconnected' ? 'Retry' : 'Test connection'}
      </Button>
      {status === 'disconnected' && error && (
        <span className='text-destructive w-full truncate text-xs' title={error}>
          {error}
        </span>
      )}
    </span>
  );
}
