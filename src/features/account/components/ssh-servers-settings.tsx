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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Icons } from '@/components/icons';
import {
  deleteSavedSshHostAction,
  renameSshHostAction,
  resetSshHostKeyAction
} from '@/features/account/actions';
import { useLocale, useT } from '@/i18n/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

export interface SavedServer {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: 'PASSWORD' | 'PRIVATE_KEY';
  hostKeyFingerprint: string | null;
  lastConnectedAt: Date | null;
  project: { id: string; name: string };
}

type Confirm = { kind: 'reset' | 'delete'; server: SavedServer } | null;

export function SshServersSettings({ servers }: { servers: SavedServer[] }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? t('common.somethingWrong'));
        return;
      }
      toast.success(success);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.tabs.ssh')}</CardTitle>
        <CardDescription>{t('account.ssh.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {servers.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('account.ssh.empty')}</p>
        ) : (
          <ul className='divide-border divide-y rounded-md border'>
            {servers.map((server) => (
              <li key={server.id} className='flex flex-wrap items-center gap-x-4 gap-y-2 p-3'>
                <Icons.server className='text-muted-foreground size-4' />
                <div className='min-w-48 flex-1 space-y-0.5'>
                  {editing?.id === server.id ? (
                    <form
                      className='flex gap-2'
                      onSubmit={(event) => {
                        event.preventDefault();
                        const name = editing.name.trim();
                        setEditing(null);
                        if (name && name !== server.name) {
                          run(
                            () => renameSshHostAction({ hostId: server.id, name }),
                            t('account.ssh.renamed')
                          );
                        }
                      }}
                    >
                      <Input
                        autoFocus
                        className='h-7'
                        value={editing.name}
                        maxLength={80}
                        aria-label={t('common.rename')}
                        onChange={(event) =>
                          setEditing({ id: server.id, name: event.target.value })
                        }
                        onKeyDown={(event) => event.key === 'Escape' && setEditing(null)}
                      />
                      <Button type='submit' size='sm' className='h-7'>
                        {t('common.save')}
                      </Button>
                    </form>
                  ) : (
                    <p className='text-sm font-medium'>{server.name}</p>
                  )}
                  <p className='text-muted-foreground text-xs'>
                    <code>
                      {server.username}@{server.host}
                      {server.port !== 22 && `:${server.port}`}
                    </code>{' '}
                    ·{' '}
                    <Link
                      href={`/projects/${server.project.id}/devops/terminal`}
                      className='underline underline-offset-4'
                    >
                      {server.project.name}
                    </Link>{' '}
                    ·{' '}
                    {server.authMethod === 'PASSWORD'
                      ? t('devops.terminal.form.password')
                      : t('devops.terminal.form.privateKey')}
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {t('account.ssh.lastConnected')}:{' '}
                    {server.lastConnectedAt
                      ? dateFormat.format(server.lastConnectedAt)
                      : t('common.never')}
                  </p>
                </div>
                <div className='flex min-w-0 flex-col gap-1 text-xs'>
                  <span className='text-muted-foreground'>{t('account.ssh.hostKey')}</span>
                  {server.hostKeyFingerprint ? (
                    <code className='max-w-64 truncate' title={server.hostKeyFingerprint}>
                      {server.hostKeyFingerprint}
                    </code>
                  ) : (
                    <Badge variant='outline'>{t('account.ssh.notPinned')}</Badge>
                  )}
                </div>
                <div className='flex gap-1'>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={t('common.rename')}
                    disabled={pending}
                    onClick={() => setEditing({ id: server.id, name: server.name })}
                  >
                    <Icons.edit />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={t('account.ssh.resetKey')}
                    title={t('account.ssh.resetKey')}
                    disabled={pending || !server.hostKeyFingerprint}
                    onClick={() => setConfirm({ kind: 'reset', server })}
                  >
                    <Icons.refresh />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={t('common.remove')}
                    disabled={pending}
                    onClick={() => setConfirm({ kind: 'delete', server })}
                  >
                    <Icons.trash />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'reset'
                ? t('account.ssh.resetKeyTitle', { name: confirm.server.name })
                : t('devops.terminal.removeTitle', { name: confirm?.server.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'reset'
                ? t('account.ssh.resetKeyDescription')
                : t('devops.terminal.removeDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                const current = confirm;
                setConfirm(null);
                if (!current) return;
                if (current.kind === 'reset') {
                  run(
                    () => resetSshHostKeyAction({ hostId: current.server.id }),
                    t('account.ssh.keyReset')
                  );
                } else {
                  run(
                    () => deleteSavedSshHostAction({ hostId: current.server.id }),
                    t('common.saved')
                  );
                }
              }}
            >
              {confirm?.kind === 'reset' ? t('account.ssh.resetKey') : t('common.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
