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
import { Icons } from '@/components/icons';
import { createApiKeyAction, deleteApiKeyAction } from '@/features/ai-router/actions';
import { useLocale, useT } from '@/i18n/client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

export interface AiKeyRow {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}

function CopyButton({ value }: { value: string }) {
  const t = useT();
  return (
    <Button
      type='button'
      variant='outline'
      size='sm'
      onClick={() =>
        navigator.clipboard.writeText(value).then(
          () => toast.success(t('aiRouter.keys.copied')),
          () => toast.error(t('common.somethingWrong'))
        )
      }
    >
      <Icons.copy /> {t('aiRouter.keys.copy')}
    </Button>
  );
}

export function AiKeysSettings({
  keys,
  endpoint,
  models
}: {
  keys: AiKeyRow[];
  endpoint: string;
  models: string[];
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AiKeyRow | null>(null);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const exampleModel = models.includes('auto') ? 'auto' : (models[0] ?? 'auto');
  const curl = [
    `curl ${endpoint}/chat/completions \\`,
    `  -H "Authorization: Bearer ${createdKey ?? '$DEVONE_AI_KEY'}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model":"${exampleModel}","messages":[{"role":"user","content":"Hello"}]}'`
  ].join('\n');

  const closeCreate = () => {
    setCreating(false);
    setName('');
    setCreatedKey(null);
  };

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-4'>
          <div className='space-y-1.5'>
            <CardTitle>{t('account.tabs.ai')}</CardTitle>
            <CardDescription>{t('aiRouter.keys.description')}</CardDescription>
          </div>
          <Button size='sm' onClick={() => setCreating(true)}>
            <Icons.add /> {t('aiRouter.keys.create')}
          </Button>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <p className='text-muted-foreground text-sm'>{t('aiRouter.keys.empty')}</p>
          ) : (
            <ul className='divide-border divide-y rounded-md border'>
              {keys.map((key) => (
                <li key={key.id} className='flex flex-wrap items-center gap-3 p-3'>
                  <Icons.lock className='text-muted-foreground size-4' />
                  <div className='min-w-0 flex-1'>
                    <p className='flex flex-wrap items-center gap-2 text-sm font-medium'>
                      {key.name}
                      <code className='text-muted-foreground text-xs'>{key.prefix}…</code>
                    </p>
                    <p className='text-muted-foreground text-xs'>
                      {t('aiRouter.keys.createdOn', { date: dateFormat.format(key.createdAt) })} ·{' '}
                      {t('aiRouter.keys.lastUsed')}:{' '}
                      {key.lastUsedAt ? dateFormat.format(key.lastUsedAt) : t('common.never')}
                    </p>
                  </div>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={t('common.delete')}
                    disabled={pending}
                    onClick={() => setDeleting(key)}
                  >
                    <Icons.trash />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('aiRouter.keys.setup')}</CardTitle>
          <CardDescription>{t('aiRouter.keys.setupHint')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label>{t('aiRouter.endpoint')}</Label>
            <div className='flex flex-wrap items-center gap-2'>
              <code className='bg-muted rounded px-2 py-1 text-sm break-all'>{endpoint}</code>
              <CopyButton value={endpoint} />
            </div>
          </div>
          <div className='space-y-2'>
            <Label>{t('aiRouter.keys.models')}</Label>
            {models.length === 0 ? (
              <p className='text-muted-foreground text-sm'>{t('aiRouter.keys.noModels')}</p>
            ) : (
              <div className='flex flex-wrap gap-1'>
                {models.map((model) => (
                  <Badge key={model} variant='outline' className='font-mono'>
                    {model}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <pre className='bg-muted overflow-x-auto rounded-md p-3 text-xs'>{curl}</pre>
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={(open) => !open && closeCreate()}>
        <DialogContent className='sm:max-w-md'>
          {createdKey ? (
            <div className='space-y-4'>
              <DialogHeader>
                <DialogTitle>{t('aiRouter.keys.createTitle')}</DialogTitle>
                <DialogDescription>{t('aiRouter.keys.created')}</DialogDescription>
              </DialogHeader>
              <div className='flex items-center gap-2'>
                <code className='bg-muted min-w-0 flex-1 rounded px-2 py-1 text-xs break-all'>
                  {createdKey}
                </code>
                <CopyButton value={createdKey} />
              </div>
              <DialogFooter>
                <Button onClick={closeCreate}>{t('aiRouter.keys.done')}</Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              className='space-y-4'
              onSubmit={(event) => {
                event.preventDefault();
                startTransition(async () => {
                  const result = await createApiKeyAction({ name });
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  setCreatedKey(result.key);
                  router.refresh();
                });
              }}
            >
              <DialogHeader>
                <DialogTitle>{t('aiRouter.keys.createTitle')}</DialogTitle>
                <DialogDescription>{t('aiRouter.keys.description')}</DialogDescription>
              </DialogHeader>
              <div className='space-y-2'>
                <Label htmlFor='ai-key-name'>{t('aiRouter.keys.name')}</Label>
                <Input
                  id='ai-key-name'
                  required
                  autoFocus
                  maxLength={60}
                  placeholder={t('aiRouter.keys.namePlaceholder')}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type='button' variant='outline' onClick={closeCreate}>
                  {t('common.cancel')}
                </Button>
                <Button type='submit' disabled={pending || !name.trim()}>
                  {pending && <Icons.spinner className='animate-spin' />}
                  {t('aiRouter.keys.create')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('aiRouter.keys.deleteTitle', { name: deleting?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('aiRouter.keys.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                const target = deleting;
                setDeleting(null);
                if (!target) return;
                startTransition(async () => {
                  const result = await deleteApiKeyAction({ keyId: target.id });
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success(t('aiRouter.keys.deleted'));
                  router.refresh();
                });
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
