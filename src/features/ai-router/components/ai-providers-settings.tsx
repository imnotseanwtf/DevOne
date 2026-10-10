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
import { Switch } from '@/components/ui/switch';
import { Icons } from '@/components/icons';
import {
  clearProviderCooldownAction,
  deleteProviderAction,
  fetchProviderModelsAction,
  saveProviderAction,
  setProviderEnabledAction
} from '@/features/ai-router/actions';
import { useLocale, useT } from '@/i18n/client';
import { AI_PROVIDER_PRESETS } from '@/lib/ai-router/presets';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppForm } from '@/lib/form';
import type { AiProviderSummary } from '../api/types';
import { aiGatewayKeys } from '../api/queries';
import { authorizeProvider, authorizeProviderType, useGatewayMutation } from './gateway-mutation';
import { toast } from 'sonner';

export type AiProviderRow = AiProviderSummary;

type Editing = { provider: AiProviderRow } | null;

export function AiProvidersSettings({ providers }: { providers: AiProviderRow[] }) {
  const t = useT();
  const locale = useLocale();
  const mutation = useGatewayMutation();
  const pending = mutation.isPending;
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<AiProviderRow | null>(null);
  const timeFormat = new Intl.DateTimeFormat(locale, { timeStyle: 'short' });
  const now = new Date();

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    mutation.mutate(action, { onSuccess: () => success && toast.success(success) });

  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-4'>
        <div className='space-y-1.5'>
          <CardTitle className='break-all'>
            {providers[0]?.name ?? t('aiRouter.providers.title')}
          </CardTitle>
          <CardDescription>{t('aiRouter.providers.description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {providers.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('aiRouter.providers.empty')}</p>
        ) : (
          <ul className='divide-border divide-y rounded-md border'>
            {providers.map((provider) => {
              const resting = provider.cooldownUntil && new Date(provider.cooldownUntil) > now;
              return (
                <li key={provider.id} className='flex flex-wrap items-center gap-x-4 gap-y-2 p-3'>
                  <Switch
                    checked={provider.enabled}
                    disabled={pending}
                    aria-label={t('aiRouter.providers.enabled')}
                    onCheckedChange={(enabled) =>
                      run(() => setProviderEnabledAction({ providerId: provider.id, enabled }))
                    }
                  />
                  <div className='min-w-48 flex-1 space-y-1'>
                    <p className='flex flex-wrap items-center gap-2 text-sm font-medium break-all'>
                      {provider.name}
                      <Badge variant='outline'>#{provider.priority}</Badge>
                      {!provider.enabled && (
                        <Badge variant='secondary'>{t('aiRouter.providers.off')}</Badge>
                      )}
                      {resting && provider.cooldownUntil && (
                        <Badge variant='destructive'>
                          {t('aiRouter.providers.resting', {
                            time: timeFormat.format(new Date(provider.cooldownUntil))
                          })}
                        </Badge>
                      )}
                    </p>
                    <p className='text-muted-foreground text-xs break-all'>
                      <code>{provider.baseUrl}</code> ·{' '}
                      {t('aiRouter.providers.modelCount', { count: provider.models.length })}
                      {provider.models.length > 0 &&
                        `: ${provider.models.slice(0, 4).join(', ')}${provider.models.length > 4 ? ', …' : ''}`}
                    </p>
                    {provider.lastError && (
                      <p className='text-destructive line-clamp-2 text-xs'>
                        {t('aiRouter.providers.lastError')}: {provider.lastError}
                      </p>
                    )}
                  </div>
                  <div className='flex gap-1'>
                    {(resting || provider.lastError) && (
                      <Button
                        variant='ghost'
                        size='icon'
                        aria-label={t('aiRouter.providers.tryNow')}
                        title={t('aiRouter.providers.tryNow')}
                        disabled={pending}
                        onClick={() =>
                          run(() => clearProviderCooldownAction({ providerId: provider.id }))
                        }
                      >
                        <Icons.refresh />
                      </Button>
                    )}
                    <Button
                      variant='ghost'
                      size='icon'
                      aria-label={t('aiRouter.providers.editTitle', { name: provider.name })}
                      disabled={pending}
                      onClick={() => setEditing({ provider })}
                    >
                      <Icons.edit />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      aria-label={t('common.remove')}
                      disabled={pending}
                      onClick={() => setRemoving(provider)}
                    >
                      <Icons.trash />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {editing && (
        <ProviderDialog
          provider={editing.provider}
          nextPriority={(providers.at(-1)?.priority ?? 0) + 10}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast.success(t('aiRouter.providers.saved'));
          }}
        />
      )}

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('aiRouter.providers.removeTitle', { name: removing?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('aiRouter.providers.removeDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                const target = removing;
                setRemoving(null);
                if (target) {
                  run(
                    () => deleteProviderAction({ providerId: target.id }),
                    t('aiRouter.providers.removed')
                  );
                }
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

const modelLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

interface ProviderFormValues {
  presetId: string;
  name: string;
  providerType: string;
  alias: string;
  format: 'openai' | 'claude' | 'openai-responses';
  authType: 'api_key' | 'oauth' | 'access_token' | 'none';
  baseUrl: string;
  apiKey: string;
  clearApiKey: boolean;
  models: string;
  priority: number;
  enabled: boolean;
}

export function ProviderDialog({
  provider,
  nextPriority,
  onClose,
  onSaved,
  presetId = 'opencode-zen',
  initialFormat
}: {
  provider: AiProviderRow | null;
  nextPriority: number;
  onClose: () => void;
  onSaved: (providerId?: string) => void;
  presetId?: string;
  initialFormat?: 'openai' | 'claude';
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const connectAfterSave = useRef(false);
  const initial =
    AI_PROVIDER_PRESETS.find((preset) => preset.id === presetId) ?? AI_PROVIDER_PRESETS[0];
  const quickConnect = useMutation({
    mutationFn: authorizeProviderType,
    onError: (error) => toast.error(error.message)
  });
  const save = useMutation({
    mutationFn: async (value: ProviderFormValues) => {
      const result = await saveProviderAction({
        ...value,
        id: provider?.id,
        alias: value.alias.trim() || null,
        apiKey:
          value.authType === 'api_key' || value.authType === 'access_token'
            ? value.apiKey || undefined
            : undefined,
        models: modelLines(value.models)
      });
      if (!result.ok) throw new Error(result.error);
      await queryClient.invalidateQueries({ queryKey: aiGatewayKeys.all });
      if (connectAfterSave.current && value.authType === 'oauth') {
        const id = result.providerId ?? provider?.id;
        try {
          if (!id) throw new Error('oauth');
          await authorizeProvider(id);
        } catch {
          toast.error(t('aiRouter.oauth.failed'));
        }
      }
      return result.providerId;
    },
    onSuccess: onSaved
  });
  const form = useAppForm({
    defaultValues: {
      presetId: provider ? 'custom' : initial.id,
      name: provider?.name ?? initial.name,
      providerType: provider?.providerType ?? initial.providerType ?? 'custom',
      alias: provider?.alias ?? '',
      format: provider?.format ?? initialFormat ?? initial.format ?? 'openai',
      authType: provider?.authType ?? initial.authType ?? 'api_key',
      baseUrl: provider?.baseUrl ?? initial.baseUrl,
      apiKey: '',
      clearApiKey: false,
      models: (provider?.models ?? initial.models).join('\n'),
      priority: provider?.priority ?? nextPriority,
      enabled: provider?.enabled ?? true
    } as ProviderFormValues,
    validators: {
      onSubmit: z.object({
        presetId: z.string(),
        name: z
          .string()
          .trim()
          .min(1, t('aiRouter.gateway.invalid'))
          .max(60, t('aiRouter.gateway.invalid'))
          .regex(/^[^/\s][^/]*$/, t('aiRouter.gateway.invalid')),
        providerType: z.string(),
        alias: z
          .string()
          .max(30, t('aiRouter.gateway.invalid'))
          .refine(
            (value) => !value || /^[a-zA-Z][\w-]*$/.test(value),
            t('aiRouter.gateway.invalid')
          ),
        format: z.enum(['openai', 'claude', 'openai-responses']),
        authType: z.enum(['api_key', 'oauth', 'access_token', 'none']),
        baseUrl: z
          .string()
          .trim()
          .min(1, t('aiRouter.gateway.invalid'))
          .max(500, t('aiRouter.gateway.invalid')),
        apiKey: z.string().max(1000, t('aiRouter.gateway.invalid')),
        clearApiKey: z.boolean(),
        models: z.string(),
        priority: z
          .number({ error: t('aiRouter.gateway.invalid') })
          .int(t('aiRouter.gateway.invalid'))
          .min(0, t('aiRouter.gateway.invalid'))
          .max(10000, t('aiRouter.gateway.invalid')),
        enabled: z.boolean()
      })
    },
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value).catch(() => undefined);
    }
  });
  const fetchModels = useMutation({
    mutationFn: async () => {
      const value = form.state.values;
      const result = await fetchProviderModelsAction({
        providerId: provider?.id,
        baseUrl: value.baseUrl,
        apiKey: value.clearApiKey ? undefined : value.apiKey || undefined,
        providerType: value.providerType,
        authType: value.authType,
        format: value.format
      });
      if (!result.ok) throw new Error(result.error);
      form.setFieldValue(
        'models',
        [...new Set([...modelLines(form.state.values.models), ...result.models])].join('\n')
      );
      toast.success(t('aiRouter.providers.fetched', { count: result.models.length }));
    }
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-lg'>
        <form
          className='space-y-4'
          autoComplete='off'
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {provider
                ? t('aiRouter.providers.editTitle', { name: provider.name })
                : t('aiRouter.providers.addTitle')}
            </DialogTitle>
            <form.Subscribe selector={(state) => state.values.presetId}>
              {(id) => {
                const preset = AI_PROVIDER_PRESETS.find((candidate) => candidate.id === id);
                return preset ? <DialogDescription>{t(preset.hintKey)}</DialogDescription> : null;
              }}
            </form.Subscribe>
          </DialogHeader>
          <fieldset disabled={save.isPending || quickConnect.isPending} className='space-y-4'>
            {!provider && (
              <form.AppField
                name='presetId'
                listeners={{
                  onChange: ({ value }) => {
                    const next = AI_PROVIDER_PRESETS.find((candidate) => candidate.id === value);
                    if (!next) return;
                    form.setFieldValue('name', next.name);
                    form.setFieldValue('baseUrl', next.baseUrl);
                    form.setFieldValue('models', next.models.join('\n'));
                    form.setFieldValue('providerType', next.providerType ?? 'custom');
                    form.setFieldValue('format', next.format ?? 'openai');
                    form.setFieldValue(
                      'authType',
                      next.authType ?? (next.needsKey ? 'api_key' : 'none')
                    );
                    if (next.providerType === 'claude' || next.providerType === 'codex') {
                      quickConnect.mutate(next.providerType);
                    }
                  }
                }}
                children={(field) => (
                  <field.SelectField
                    label={t('aiRouter.providers.preset')}
                    options={AI_PROVIDER_PRESETS.map((preset) => ({
                      value: preset.id,
                      label: preset.name || t('aiRouter.gateway.custom')
                    }))}
                  />
                )}
              />
            )}
            <div className='grid gap-4 sm:grid-cols-[1fr_7rem]'>
              <form.AppField
                name='name'
                children={(field) => (
                  <field.TextField label={t('aiRouter.providers.name')} required maxLength={60} />
                )}
              />
              <form.AppField
                name='priority'
                children={(field) => (
                  <field.TextField
                    label={t('aiRouter.providers.priority')}
                    type='number'
                    required
                    min={0}
                    max={10000}
                  />
                )}
              />
            </div>
            <p className='text-muted-foreground text-xs break-all'>
              {t('aiRouter.providers.priorityHint')}
            </p>
            <form.AppField
              name='providerType'
              children={(field) => (
                <field.SelectField
                  label={t('aiRouter.gateway.providerType')}
                  options={[
                    { value: 'custom', label: t('aiRouter.gateway.custom') },
                    { value: 'openai', label: 'OpenAI' },
                    { value: 'anthropic', label: 'Anthropic' },
                    { value: 'claude', label: 'Claude' },
                    { value: 'codex', label: 'Codex' },
                    { value: 'ollama', label: 'Ollama' }
                  ]}
                />
              )}
            />
            <form.AppField
              name='alias'
              children={(field) => (
                <field.TextField
                  label={t('aiRouter.gateway.alias')}
                  description={t('aiRouter.gateway.aliasHint')}
                  maxLength={30}
                />
              )}
            />
            <form.AppField
              name='format'
              children={(field) => (
                <field.SelectField
                  label={t('aiRouter.gateway.format')}
                  options={[
                    { value: 'openai', label: t('aiRouter.gateway.chat') },
                    { value: 'claude', label: t('aiRouter.gateway.messages') },
                    { value: 'openai-responses', label: t('aiRouter.gateway.responses') }
                  ]}
                />
              )}
            />
            <form.AppField
              name='authType'
              children={(field) => (
                <field.SelectField
                  label={t('aiRouter.gateway.authType')}
                  options={[
                    { value: 'api_key', label: t('aiRouter.providers.apiKey') },
                    { value: 'oauth', label: 'OAuth' },
                    { value: 'access_token', label: t('aiRouter.gateway.accessToken') },
                    { value: 'none', label: t('aiRouter.gateway.noAuth') }
                  ]}
                />
              )}
            />
            <form.AppField
              name='baseUrl'
              children={(field) => (
                <field.TextField
                  label={t('aiRouter.providers.baseUrl')}
                  required
                  placeholder='https://api.example.com/v1'
                />
              )}
            />
            <form.Subscribe
              selector={(state) => [state.values.authType, state.values.clearApiKey] as const}
            >
              {([authType, clearApiKey]) =>
                authType === 'oauth' ? (
                  <p className='text-muted-foreground text-sm'>{t('aiRouter.oauth.saveFirst')}</p>
                ) : authType !== 'none' ? (
                  <>
                    <form.AppField
                      name='apiKey'
                      children={(field) => (
                        <field.TextField
                          label={
                            authType === 'access_token'
                              ? t('aiRouter.gateway.accessToken')
                              : t('aiRouter.providers.apiKey')
                          }
                          type='password'
                          disabled={clearApiKey}
                          description={
                            provider?.hasApiKey ? t('aiRouter.providers.apiKeyKeep') : undefined
                          }
                        />
                      )}
                    />
                    {provider?.hasApiKey && (
                      <form.AppField
                        name='clearApiKey'
                        children={(field) => (
                          <field.CheckboxField label={t('aiRouter.providers.clearKey')} />
                        )}
                      />
                    )}
                  </>
                ) : null
              }
            </form.Subscribe>
            <form.AppField
              name='models'
              children={(field) => (
                <field.TextareaField
                  label={t('aiRouter.providers.models')}
                  description={t('aiRouter.providers.modelsHint')}
                  rows={5}
                  className='font-mono text-xs'
                />
              )}
            />
            <Button
              type='button'
              variant='outline'
              size='sm'
              isLoading={fetchModels.isPending}
              onClick={() => fetchModels.mutate()}
            >
              <Icons.download />
              {t('aiRouter.providers.fetchModels')}
            </Button>
            <form.AppField
              name='enabled'
              children={(field) => <field.SwitchField label={t('aiRouter.providers.enabled')} />}
            />
          </fieldset>
          {(save.error || fetchModels.error) && (
            <p role='alert' className='text-destructive text-sm'>
              {save.error?.message ?? fetchModels.error?.message}
            </p>
          )}
          <DialogFooter>
            <Button type='button' variant='outline' disabled={save.isPending} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <form.Subscribe selector={(state) => state.values.authType}>
              {(authType) =>
                authType === 'oauth' ? (
                  <Button
                    type='submit'
                    isLoading={save.isPending}
                    onClick={() => (connectAfterSave.current = true)}
                  >
                    {t('aiRouter.oauth.saveConnect')}
                  </Button>
                ) : null
              }
            </form.Subscribe>
            <Button
              type='submit'
              isLoading={save.isPending}
              onClick={() => (connectAfterSave.current = false)}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
