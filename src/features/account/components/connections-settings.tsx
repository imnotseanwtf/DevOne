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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Icons } from '@/components/icons';
import { connectAccountAction, removeConnectionAction } from '@/features/account/actions';
import { useT } from '@/i18n/client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

export interface ConnectionSummary {
  id: string;
  provider: 'GITHUB' | 'GITLAB';
  providerUserId: string;
  baseUrl: string;
  kind: 'oauth' | 'token';
  repositoryCount: number;
  isSignIn: boolean;
}

type TokenDialog = { mode: 'add' } | { mode: 'replace'; connection: ConnectionSummary } | null;

const hostOf = (baseUrl: string) => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};

export function ConnectionsSettings({ connections }: { connections: ConnectionSummary[] }) {
  const t = useT();
  const router = useRouter();
  const [dialog, setDialog] = useState<TokenDialog>(null);
  const [removing, setRemoving] = useState<ConnectionSummary | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.tabs.connections')}</CardTitle>
        <CardDescription>{t('account.connections.description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <ul className='divide-border divide-y rounded-md border'>
          {connections.map((connection) => (
            <li key={connection.id} className='flex flex-wrap items-center gap-3 p-3'>
              {connection.provider === 'GITHUB' ? (
                <Icons.github className='size-5' />
              ) : (
                <Icons.gitlab className='size-5' />
              )}
              <div className='min-w-0 flex-1'>
                <p className='flex flex-wrap items-center gap-2 text-sm font-medium'>
                  {hostOf(connection.baseUrl)}
                  {connection.isSignIn && (
                    <Badge variant='secondary'>{t('account.connections.signInAccount')}</Badge>
                  )}
                </p>
                <p className='text-muted-foreground text-xs'>
                  {connection.kind === 'oauth'
                    ? `${t('account.connections.oauth')} · ${t('account.connections.expires')}`
                    : t('account.connections.token')}{' '}
                  · {t('account.connections.repositories', { count: connection.repositoryCount })}
                </p>
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setDialog({ mode: 'replace', connection })}
              >
                <Icons.refresh /> {t('account.connections.replaceToken')}
              </Button>
              <Button
                variant='ghost'
                size='icon'
                aria-label={t('common.remove')}
                title={connection.isSignIn ? t('account.connections.cannotRemove') : undefined}
                disabled={connection.isSignIn}
                onClick={() => setRemoving(connection)}
              >
                <Icons.trash />
              </Button>
            </li>
          ))}
        </ul>
        <Button variant='outline' onClick={() => setDialog({ mode: 'add' })}>
          <Icons.add /> {t('account.connections.add')}
        </Button>
      </CardContent>

      {dialog && (
        <TokenDialogForm
          dialog={dialog}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null);
            toast.success(message);
            router.refresh();
          }}
        />
      )}

      <AlertDialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('account.connections.removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('account.connections.removeDescription', {
                count: removing?.repositoryCount ?? 0
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={pending}
              onClick={() => {
                const connection = removing;
                setRemoving(null);
                if (!connection) return;
                startTransition(async () => {
                  const result = await removeConnectionAction({ connectionId: connection.id });
                  if (!result.ok) toast.error(result.error);
                  else router.refresh();
                });
              }}
            >
              {t('common.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function TokenDialogForm({
  dialog,
  onClose,
  onDone
}: {
  dialog: NonNullable<TokenDialog>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const replacing = dialog.mode === 'replace' ? dialog.connection : null;
  const [provider, setProvider] = useState<'github' | 'gitlab'>(
    replacing?.provider === 'GITLAB' ? 'gitlab' : 'github'
  );
  const [gitlabBaseUrl, setGitlabBaseUrl] = useState(
    replacing?.provider === 'GITLAB' ? replacing.baseUrl : 'https://gitlab.com'
  );
  const [token, setToken] = useState('');
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <form
          className='space-y-4'
          autoComplete='off'
          onSubmit={(event) => {
            event.preventDefault();
            setError(undefined);
            startTransition(async () => {
              const result = await connectAccountAction({
                provider,
                token,
                gitlabBaseUrl: provider === 'gitlab' ? gitlabBaseUrl : undefined
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              onDone(
                result.replaced
                  ? t('account.connections.replaced')
                  : t('account.connections.connected', { username: result.username })
              );
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {replacing
                ? t('account.connections.replaceTitle', { host: hostOf(replacing.baseUrl) })
                : t('account.connections.addTitle')}
            </DialogTitle>
            <DialogDescription>
              {replacing
                ? t('account.connections.replaceHint')
                : t('account.connections.tokenHint')}
            </DialogDescription>
          </DialogHeader>
          {!replacing && (
            <div className='space-y-2'>
              <Label htmlFor='connection-provider'>{t('account.connections.provider')}</Label>
              <NativeSelect
                id='connection-provider'
                value={provider}
                onChange={(event) => setProvider(event.target.value as 'github' | 'gitlab')}
              >
                <option value='github'>GitHub</option>
                <option value='gitlab'>GitLab</option>
              </NativeSelect>
            </div>
          )}
          {provider === 'gitlab' && !replacing && (
            <div className='space-y-2'>
              <Label htmlFor='connection-gitlab-url'>{t('account.connections.gitlabUrl')}</Label>
              <Input
                id='connection-gitlab-url'
                value={gitlabBaseUrl}
                onChange={(event) => setGitlabBaseUrl(event.target.value)}
              />
            </div>
          )}
          <div className='space-y-2'>
            <Label htmlFor='connection-token'>{t('account.connections.accessToken')}</Label>
            <Input
              id='connection-token'
              type='password'
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </div>
          {error && <p className='text-destructive text-sm'>{error}</p>}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type='submit' disabled={pending || !token.trim()}>
              {pending && <Icons.spinner className='animate-spin' />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
