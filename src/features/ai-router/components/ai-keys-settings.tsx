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
import { Button } from './gateway-button';
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
import { useAppForm } from '@/lib/form';
import { z } from 'zod';
import { useMutation, useSuspenseQuery, useQueryClient } from '@tanstack/react-query';
import type { ProviderFormat } from '@/lib/ai-router/types';
import { gatewayRequestExample } from '../client-setup';
import { Icons } from '@/components/icons';
import { createApiKeyAction, deleteApiKeyAction } from '@/features/ai-router/actions';
import { useLocale, useT } from '@/i18n/client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { aiGatewayKeys, gatewayEndpointQueryOptions } from '../api/queries';
import type { AiKeySummary } from '../api/types';

function CopyButton({ value, label }: { value: string; label?: string }) {
  const t = useT();
  return (
    <Button
      type='button'
      variant='outline'
      size='sm'
      aria-label={label}
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

export function AiKeysSettings({ userId }: { userId: string }) {
  const {
    data: { keys, endpoint, models }
  } = useSuspenseQuery(gatewayEndpointQueryOptions(userId));
  const queryClient = useQueryClient();
  const t = useT();
  const locale = useLocale();
  const [deletingPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [format, setFormat] = useState<ProviderFormat>('openai');
  const [selectedModel, setSelectedModel] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AiKeySummary | null>(null);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const exampleModel = selectedModel || (models.includes('auto') ? 'auto' : (models[0] ?? 'auto'));
  const curl = gatewayRequestExample(endpoint, exampleModel, format);
  const create = useMutation({
    mutationFn: async (name: string) => {
      const result = await createApiKeyAction({ name });
      if (!result.ok) throw new Error(result.error);
      return result.key;
    },
    onSuccess: async (key) => {
      setCreatedKey(key);
      await queryClient.invalidateQueries({ queryKey: aiGatewayKeys.endpoint(userId) });
    },
    onError: (error) => toast.error(error.message)
  });
  const pending = create.isPending || deletingPending;
  const form = useAppForm({
    defaultValues: { name: '' },
    validators: { onSubmit: z.object({ name: z.string().trim().min(1).max(60) }) },
    onSubmit: async ({ value }) => {
      await create.mutateAsync(value.name).catch(() => undefined);
    }
  });

  const closeCreate = () => {
    setCreating(false);
    form.reset();
    setCreatedKey(null);
  };

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Icons.diagram className='size-5' /> {t('aiRouter.workspace.apiEndpoint')}
          </CardTitle>
          <CardDescription>{t('aiRouter.workspace.endpointHint')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          {[
            { label: t('aiRouter.endpoint'), value: endpoint },
            { label: t('aiRouter.gateway.chat'), value: `${endpoint}/chat/completions` },
            { label: t('aiRouter.gateway.messages'), value: `${endpoint}/messages` },
            { label: t('aiRouter.gateway.responses'), value: `${endpoint}/responses` }
          ].map((row) => (
            <div key={row.value} className='flex flex-wrap items-center gap-2 sm:flex-nowrap'>
              <span className='text-muted-foreground w-full shrink-0 text-xs sm:w-44'>
                {row.label}
              </span>
              <Input
                aria-label={row.label}
                value={row.value}
                readOnly
                className='min-w-0 flex-1 font-mono text-xs'
              />
              <CopyButton value={row.value} label={`${t('aiRouter.keys.copy')} ${row.label}`} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-4'>
          <div className='space-y-1.5'>
            <CardTitle className='flex items-center gap-2'>
              <Icons.primaryKey className='size-5' /> {t('aiRouter.workspace.personalKeys')}
            </CardTitle>
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
                    <p className='flex flex-wrap items-center gap-2 text-sm font-medium break-all'>
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
                    aria-label={`${t('common.delete')} ${key.name}`}
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
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='min-w-0 space-y-2'>
              <Label htmlFor='ai-example-format'>{t('aiRouter.workspace.protocol')}</Label>
              <select
                id='ai-example-format'
                className='bg-background h-9 w-full min-w-0 rounded-md border px-3 text-sm'
                value={format}
                onChange={(event) => setFormat(event.target.value as ProviderFormat)}
              >
                <option value='openai'>{t('aiRouter.gateway.chat')}</option>
                <option value='claude'>{t('aiRouter.gateway.messages')}</option>
                <option value='openai-responses'>{t('aiRouter.gateway.responses')}</option>
              </select>
            </div>
            <div className='min-w-0 space-y-2'>
              <Label htmlFor='ai-example-model'>{t('aiRouter.usage.model')}</Label>
              <select
                id='ai-example-model'
                className='bg-background h-9 w-full min-w-0 rounded-md border px-3 text-sm'
                value={exampleModel}
                onChange={(event) => setSelectedModel(event.target.value)}
              >
                {(models.length ? models : ['auto']).map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className='min-w-0 space-y-2'>
            <div className='flex items-center justify-between gap-3'>
              <Label>{t('aiRouter.workspace.example')}</Label>
              <CopyButton
                value={curl}
                label={`${t('aiRouter.keys.copy')} ${t('aiRouter.workspace.example')}`}
              />
            </div>
            <pre className='bg-muted overflow-x-auto rounded-md p-3 text-xs'>{curl}</pre>
          </div>
          <div className='space-y-3'>
            <Label>{t('aiRouter.keys.models')}</Label>
            <p className='text-muted-foreground text-xs'>{t('aiRouter.workspace.modelsHint')}</p>
            {models.length === 0 ? (
              <p className='text-muted-foreground text-sm'>{t('aiRouter.keys.noModels')}</p>
            ) : (
              <>
                <Input
                  aria-label={t('aiRouter.keys.models')}
                  placeholder={t('aiRouter.keys.models')}
                  value={modelSearch}
                  onChange={(event) => setModelSearch(event.target.value)}
                />
                <div className='grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2'>
                  {models
                    .filter((model) => model.toLowerCase().includes(modelSearch.toLowerCase()))
                    .map((model) => (
                      <div
                        key={model}
                        className='flex min-w-0 items-center gap-2 rounded-md border p-2'
                      >
                        <code className='min-w-0 flex-1 break-all text-xs'>{model}</code>
                        <CopyButton
                          value={model}
                          label={`${t('aiRouter.workspace.copyModel')} ${model}`}
                        />
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={(open) => !open && !create.isPending && closeCreate()}>
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
                event.stopPropagation();
                void form.handleSubmit();
              }}
            >
              <DialogHeader>
                <DialogTitle>{t('aiRouter.keys.createTitle')}</DialogTitle>
                <DialogDescription>{t('aiRouter.keys.description')}</DialogDescription>
              </DialogHeader>
              <form.AppField
                name='name'
                children={(field) => (
                  <field.TextField
                    label={t('aiRouter.keys.name')}
                    required
                    autoFocus
                    maxLength={60}
                    placeholder={t('aiRouter.keys.namePlaceholder')}
                  />
                )}
              />
              <DialogFooter>
                <Button
                  type='button'
                  variant='outline'
                  disabled={create.isPending}
                  onClick={closeCreate}
                >
                  {t('common.cancel')}
                </Button>
                <Button type='submit' isLoading={create.isPending} disabled={pending}>
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
                  await queryClient.invalidateQueries({ queryKey: aiGatewayKeys.endpoint(userId) });
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
