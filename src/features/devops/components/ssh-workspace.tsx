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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { deleteSshHostAction } from '@/features/devops/actions';
import { SshConnectForm } from '@/features/devops/components/ssh-connect-form';
import { SshTerminal } from '@/features/devops/components/ssh-terminal';
import type { NewSshConnection } from '@/features/devops/schema';
import { useT } from '@/i18n/client';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export interface SavedHostSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: 'PASSWORD' | 'PRIVATE_KEY';
  hostKeyFingerprint: string | null;
}

interface OpenSession {
  sessionId: string;
  label: string;
  fingerprint: string;
  exited: string | null;
}

interface ConnectResponse {
  sessionId?: string;
  label?: string;
  fingerprint?: string;
  hostId?: string | null;
  error?: string;
}

/** A first guess at the size; the terminal sends its real one once it's laid out. */
const INITIAL_SIZE = { cols: 120, rows: 32 };

async function connect(body: Record<string, unknown>): Promise<ConnectResponse> {
  const response = await fetch('/api/ssh/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, ...INITIAL_SIZE })
  }).catch(() => null);
  if (!response) return { error: 'Could not reach DevOne' };
  const payload = (await response.json().catch(() => ({}))) as ConnectResponse;
  if (!response.ok || !payload.sessionId) {
    return { error: payload.error ?? 'Could not open the connection' };
  }
  return payload;
}

export interface TerminalPolicySummary {
  allowed: boolean;
  access: 'DISABLED' | 'OWNERS' | 'MEMBERS';
  allowedHosts: string[];
  isOwner: boolean;
}

interface SshWorkspaceProps {
  projectId: string;
  savedHosts: SavedHostSummary[];
  policy: TerminalPolicySummary;
  fontSize: number;
}

export function SshWorkspace({ projectId, savedHosts, policy, fontSize }: SshWorkspaceProps) {
  const router = useRouter();
  const t = useT();
  const storageKey = `devone:ssh-sessions:${projectId}`;
  const [sessions, setSessions] = useState<OpenSession[]>([]);
  const [active, setActive] = useState<string | 'new'>('new');
  const [connecting, setConnecting] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SavedHostSummary | null>(null);

  // Re-attach to shells still open on the server after a reload of this tab.
  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]') as OpenSession[];
      if (stored.length > 0) {
        setSessions(stored.filter((session) => !session.exited));
        setActive(stored[0].sessionId);
      }
    } catch {
      // Storage unavailable or corrupt: start with no tabs.
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(sessions.filter((s) => !s.exited)));
    } catch {
      // Not essential.
    }
  }, [sessions, storageKey]);

  const opened = (response: ConnectResponse) => {
    const session: OpenSession = {
      sessionId: response.sessionId!,
      label: response.label ?? 'Terminal',
      fingerprint: response.fingerprint ?? '',
      exited: null
    };
    setSessions((current) => [...current, session]);
    setActive(session.sessionId);
  };

  const connectSaved = async (host: SavedHostSummary) => {
    setConnecting(host.id);
    const response = await connect({ mode: 'saved', projectId, hostId: host.id });
    setConnecting(null);
    if (response.error) {
      toast.error(`${host.name}: ${response.error}`);
      return;
    }
    opened(response);
    // Shows the key it pinned on the first connection.
    if (!host.hostKeyFingerprint) router.refresh();
  };

  const connectNew = async (connection: NewSshConnection) => {
    const response = await connect({ mode: 'new', projectId, connection });
    if (response.error) return response.error;
    opened(response);
    if (response.hostId) router.refresh();
    return undefined;
  };

  const close = (sessionId: string) => {
    const session = sessions.find((entry) => entry.sessionId === sessionId);
    if (session && !session.exited) {
      void fetch(`/api/ssh/sessions/${sessionId}`, { method: 'DELETE' });
    }
    const remaining = sessions.filter((entry) => entry.sessionId !== sessionId);
    setSessions(remaining);
    if (active === sessionId) setActive(remaining.at(-1)?.sessionId ?? 'new');
  };

  const markExited = (sessionId: string, reason: string) =>
    setSessions((current) =>
      current.map((entry) => (entry.sessionId === sessionId ? { ...entry, exited: reason } : entry))
    );

  const remove = async (host: SavedHostSummary) => {
    const result = await deleteSshHostAction({ projectId, hostId: host.id });
    if (!result.ok) toast.error(result.error);
    else router.refresh();
    setRemoving(null);
  };

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

  return (
    <div className='grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]'>
      <Card className='h-fit'>
        <CardHeader>
          <CardTitle className='text-base'>{t('devops.terminal.savedServers')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2'>
          {savedHosts.length === 0 ? (
            <p className='text-muted-foreground text-sm'>{t('devops.terminal.savedHint')}</p>
          ) : (
            <ul className='space-y-1'>
              {savedHosts.map((host) => (
                <li key={host.id} className='group flex items-center gap-1'>
                  <Button
                    variant='ghost'
                    className='h-auto min-w-0 flex-1 justify-start px-2 py-1.5 text-left'
                    disabled={connecting !== null}
                    onClick={() => void connectSaved(host)}
                    title={host.hostKeyFingerprint ?? undefined}
                  >
                    {connecting === host.id ? (
                      <Icons.spinner className='animate-spin' />
                    ) : (
                      <Icons.server />
                    )}
                    <span className='min-w-0'>
                      <span className='block truncate text-sm font-medium'>{host.name}</span>
                      <span className='text-muted-foreground block truncate text-xs'>
                        {host.username}@{host.host}
                        {host.port !== 22 && `:${host.port}`}
                      </span>
                    </span>
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='size-7 opacity-60 group-hover:opacity-100'
                    aria-label={t('devops.terminal.remove', { name: host.name })}
                    onClick={() => setRemoving(host)}
                  >
                    <Icons.trash />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            variant='outline'
            className='w-full'
            onClick={() => setActive('new')}
            aria-pressed={active === 'new'}
          >
            <Icons.add /> {t('devops.terminal.newConnection')}
          </Button>
        </CardContent>
      </Card>

      <div className='min-w-0 space-y-3'>
        {sessions.length > 0 && (
          <div
            role='tablist'
            aria-label={t('devops.terminal.openTerminals')}
            className='flex flex-wrap gap-1'
          >
            {sessions.map((session) => (
              <div
                key={session.sessionId}
                className={cn(
                  'flex items-center rounded-md border text-sm',
                  active === session.sessionId ? 'bg-muted' : 'opacity-80'
                )}
              >
                <button
                  type='button'
                  role='tab'
                  aria-selected={active === session.sessionId}
                  className='flex items-center gap-2 py-1 pr-1 pl-3'
                  onClick={() => setActive(session.sessionId)}
                >
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      session.exited ? 'bg-muted-foreground' : 'bg-emerald-500'
                    )}
                  />
                  {session.label}
                </button>
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-7'
                  aria-label={t('devops.terminal.closeTab', { name: session.label })}
                  onClick={() => close(session.sessionId)}
                >
                  <Icons.close />
                </Button>
              </div>
            ))}
          </div>
        )}

        {sessions.map((session) => (
          <div
            key={session.sessionId}
            className={cn('space-y-2', active !== session.sessionId && 'hidden')}
          >
            <div className='text-muted-foreground flex flex-wrap items-center gap-2 text-xs'>
              <Icons.lock className='size-3.5' />
              {t('devops.terminal.hostKey')} <code>{session.fingerprint}</code>
              {session.exited && <Badge variant='outline'>{session.exited}</Badge>}
            </div>
            <div className='h-[65vh] min-h-80 overflow-hidden rounded-md bg-[#0a0a0a] p-2'>
              <SshTerminal
                fontSize={fontSize}
                sessionId={session.sessionId}
                onExit={(reason) => markExited(session.sessionId, reason)}
              />
            </div>
          </div>
        ))}

        {active === 'new' && (
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>{t('devops.terminal.connectTitle')}</CardTitle>
            </CardHeader>
            <CardContent className='max-w-xl space-y-4'>
              {policy.allowedHosts.length > 0 && (
                <p className='text-muted-foreground text-sm'>
                  {t('devops.terminal.allowedHosts', { hosts: policy.allowedHosts.join(', ') })}
                </p>
              )}
              <SshConnectForm onConnect={connectNew} />
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('devops.terminal.removeTitle', { name: removing?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('devops.terminal.removeDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => removing && void remove(removing)}>
              {t('common.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
