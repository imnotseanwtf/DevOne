'use client';

import { Button } from '@/components/ui/button';
import { SshTerminal } from '@/features/devops/components/ssh-terminal';
import { useT } from '@/i18n/client';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ContainerExecProps {
  projectId: string;
  source: string;
  containerId: string;
  running: boolean;
  /** True while this tab is showing: the shell opens the first time it is. */
  active: boolean;
  local: boolean;
  fontSize: number;
}

interface Opened {
  sessionId: string;
  exited: string | null;
}

/** A first guess at the size; the terminal sends its real one once it's laid out. */
const INITIAL_SIZE = { cols: 120, rows: 32 };

/** An interactive shell in the container (docker exec -it), like Docker Desktop's Exec tab. */
export function ContainerExec({
  projectId,
  source,
  containerId,
  running,
  active,
  local,
  fontSize
}: ContainerExecProps) {
  const t = useT();
  const [session, setSession] = useState<Opened | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const sessionRef = useRef<Opened | null>(null);
  sessionRef.current = session;

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    const response = await fetch('/api/ssh/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'container', projectId, source, containerId, ...INITIAL_SIZE })
    }).catch(() => null);
    const payload = (await response?.json().catch(() => ({}))) as
      | { sessionId?: string; error?: string }
      | undefined;
    setConnecting(false);
    if (!response || !response.ok || !payload?.sessionId) {
      setError(payload?.error ?? 'Could not reach DevOne');
      return;
    }
    setSession({ sessionId: payload.sessionId, exited: null });
  }, [projectId, source, containerId]);

  // Opens on first view, not on page load: a shell is a held-open SSH connection.
  useEffect(() => {
    if (active && running && !session && !connecting && !error) void connect();
  }, [active, running, session, connecting, error, connect]);

  // Leaving the page ends the shell now instead of after the reconnect grace period.
  useEffect(
    () => () => {
      const open = sessionRef.current;
      if (open && !open.exited) {
        void fetch(`/api/ssh/sessions/${open.sessionId}`, { method: 'DELETE', keepalive: true });
      }
    },
    []
  );

  if (!running && !session) {
    return <p className='text-muted-foreground text-sm'>{t('devops.containers.execNotRunning')}</p>;
  }

  return (
    <div className='space-y-2'>
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
      {!session && connecting && (
        <p className='text-muted-foreground text-sm'>{t('devops.containers.execStarting')}</p>
      )}
      {session && (
        <div className='h-[60vh] min-h-80 overflow-hidden rounded-md bg-[#0a0a0a] p-2'>
          <SshTerminal
            key={session.sessionId}
            fontSize={fontSize}
            sessionId={session.sessionId}
            onExit={(reason) => setSession((current) => current && { ...current, exited: reason })}
          />
        </div>
      )}
      <div className='flex items-center justify-between gap-2'>
        {local ? (
          <p className='text-muted-foreground text-xs'>{t('devops.containers.execLocalHint')}</p>
        ) : (
          <span />
        )}
        {(error || session?.exited) && (
          <Button
            variant='outline'
            size='sm'
            disabled={connecting}
            onClick={() => {
              setSession(null);
              void connect();
            }}
          >
            {t('devops.containers.reconnect')}
          </Button>
        )}
      </div>
    </div>
  );
}
