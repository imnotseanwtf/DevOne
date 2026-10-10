'use client';

import { useState } from 'react';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
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
import { Switch } from '@/components/ui/switch';
import { useLocale, useT } from '@/i18n/client';
import { useAppForm } from '@/lib/form';
import {
  clearConnectionCooldownAction,
  deleteConnectionAction,
  saveConnectionAction,
  saveRouterSettingsAction,
  setConnectionEnabledAction
} from '../actions';
import { gatewayAdminQueryOptions } from '../api/queries';
import type {
  AiConnectionSummary,
  AiProviderSummary,
  AiRouterSettings,
  ConnectionInput
} from '../api/types';
import { AiCombosSettings } from './ai-combos-settings';
import { ProviderCatalog } from './provider-catalog';
import Link from 'next/link';
import { AiProvidersSettings } from './ai-providers-settings';
import { Button } from './gateway-button';
import { authorizeProvider, useGatewayMutation } from './gateway-mutation';

interface AiGatewayPanelProps {
  userId: string;
  oauthResult?: string;
  view?: 'providers' | 'settings' | 'combos';
  providerId?: string;
}

export function AiGatewayPanel({
  userId,
  oauthResult,
  view = 'providers',
  providerId
}: AiGatewayPanelProps) {
  const t = useT();
  const { data } = useSuspenseQuery(gatewayAdminQueryOptions(userId));
  const provider = data.providers.find((item) => item.id === providerId);
  return (
    <div className='space-y-6'>
      {oauthResult && (
        <p role='status' className='text-sm'>
          {oauthResult === 'connected' ? t('aiRouter.oauth.connected') : t('aiRouter.oauth.failed')}
        </p>
      )}
      {view === 'combos' ? (
        <AiCombosSettings providers={data.providers} combos={data.combos} />
      ) : view === 'settings' ? (
        <RouterSettings key={JSON.stringify(data.settings)} settings={data.settings} />
      ) : providerId ? (
        <div className='space-y-5'>
          <Link
            href='/router?tab=providers'
            className='inline-flex items-center gap-2 text-sm hover:underline'
          >
            <Icons.chevronLeft className='size-4' /> {t('aiRouter.workspace.backProviders')}
          </Link>
          {provider ? (
            <>
              <AiProvidersSettings providers={[provider]} />
              <ConnectionsCard providers={[provider]} connections={data.connections} />
            </>
          ) : (
            <p>{t('aiRouter.workspace.providerMissing')}</p>
          )}
        </div>
      ) : (
        <ProviderCatalog providers={data.providers} connections={data.connections} />
      )}
    </div>
  );
}

interface ConnectionsCardProps {
  providers: AiProviderSummary[];
  connections: AiConnectionSummary[];
}

function ConnectionsCard({ providers, connections }: ConnectionsCardProps) {
  const t = useT();
  const locale = useLocale();
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  const [editing, setEditing] = useState<{
    provider: AiProviderSummary;
    connection?: AiConnectionSummary;
  } | null>(null);
  const [removing, setRemoving] = useState<AiConnectionSummary | null>(null);
  const mutation = useGatewayMutation();
  const oauth = useMutation({
    mutationFn: authorizeProvider,
    onError: (error) => toast.error(error.message)
  });
  const connecting = oauth.isPending;
  const addAccount = (provider: AiProviderSummary) => {
    if (provider.authType === 'oauth' || provider.providerType === 'claude') {
      oauth.mutate(provider.id);
    } else {
      setEditing({ provider });
    }
  };
  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-4'>
        <div className='space-y-1.5'>
          <CardTitle>{t('aiRouter.connections.title')}</CardTitle>
          <CardDescription>{t('aiRouter.connections.description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className='space-y-5'>
        {providers.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('aiRouter.connections.noProviders')}</p>
        ) : (
          providers.map((provider) => {
            const accounts = connections.filter(
              (connection) => connection.providerId === provider.id
            );
            return (
              <section
                key={provider.id}
                className='space-y-3 rounded-md border p-3'
                aria-label={provider.name}
              >
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <h3 className='text-sm font-medium'>{provider.name}</h3>
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={connecting}
                      isLoading={oauth.isPending && oauth.variables === provider.id}
                      onClick={() => addAccount(provider)}
                    >
                      <Icons.add />
                      {t('aiRouter.connections.add')}
                    </Button>
                  </div>
                </div>
                {provider.authType === 'oauth' && !provider.oauthConfigured && (
                  <p className='text-muted-foreground text-xs'>
                    {t('aiRouter.oauth.notConfigured')}
                  </p>
                )}
                {accounts.length === 0 ? (
                  <p className='text-muted-foreground text-sm'>{t('aiRouter.connections.empty')}</p>
                ) : (
                  <ul className='divide-y'>
                    {accounts.map((connection) => {
                      const cooldown =
                        connection.rateLimitedUntil &&
                        new Date(connection.rateLimitedUntil).getTime() > Date.now();
                      const expired =
                        connection.expiresAt &&
                        new Date(connection.expiresAt).getTime() <= Date.now();
                      const missingCredential =
                        connection.authType !== 'none' &&
                        !connection.hasApiKey &&
                        !connection.hasAccessToken &&
                        !connection.hasRefreshToken;
                      return (
                        <li key={connection.id} className='flex flex-wrap items-start gap-3 py-3'>
                          <Switch
                            checked={connection.isActive}
                            disabled={mutation.isPending}
                            aria-label={t('aiRouter.connections.activeName', {
                              name: connection.name
                            })}
                            onCheckedChange={(isActive) =>
                              mutation.mutate(() =>
                                setConnectionEnabledAction({
                                  connectionId: connection.id,
                                  isActive
                                })
                              )
                            }
                          />
                          <div className='min-w-40 flex-1 space-y-1'>
                            <p className='flex flex-wrap items-center gap-2 text-sm font-medium break-all'>
                              {connection.name}
                              <Badge variant='outline'>#{connection.priority}</Badge>
                              <Badge variant='secondary'>
                                {connection.authType === 'api_key'
                                  ? t('aiRouter.providers.apiKey')
                                  : connection.authType === 'access_token'
                                    ? t('aiRouter.gateway.accessToken')
                                    : connection.authType === 'none'
                                      ? t('aiRouter.gateway.noAuth')
                                      : 'OAuth'}
                              </Badge>
                              {!connection.isActive && (
                                <Badge variant='secondary'>{t('aiRouter.providers.off')}</Badge>
                              )}
                              {expired && (
                                <Badge variant='destructive'>
                                  {t('aiRouter.connections.expired')}
                                </Badge>
                              )}
                              {missingCredential && (
                                <Badge variant='destructive'>
                                  {t('aiRouter.connections.noCredential')}
                                </Badge>
                              )}
                            </p>
                            <p className='text-muted-foreground break-all text-xs'>
                              {connection.allowedModels.length
                                ? t('aiRouter.connections.allowedList', {
                                    models: connection.allowedModels.join(', ')
                                  })
                                : t('aiRouter.connections.allModels')}
                            </p>
                            {cooldown && connection.rateLimitedUntil && (
                              <p className='text-destructive text-xs'>
                                {t('aiRouter.connections.cooldown', {
                                  time: dateFormat.format(new Date(connection.rateLimitedUntil))
                                })}
                              </p>
                            )}
                            {connection.expiresAt && !expired && (
                              <p className='text-muted-foreground text-xs'>
                                {t('aiRouter.connections.expires', {
                                  time: dateFormat.format(new Date(connection.expiresAt))
                                })}
                              </p>
                            )}
                            {connection.lastError && (
                              <p className='text-destructive line-clamp-2 text-xs'>
                                {connection.lastError}
                              </p>
                            )}
                          </div>
                          <div className='flex gap-1'>
                            {(cooldown || connection.lastError) && (
                              <Button
                                variant='ghost'
                                size='icon'
                                disabled={mutation.isPending}
                                aria-label={t('aiRouter.providers.tryNow')}
                                onClick={() =>
                                  mutation.mutate(() =>
                                    clearConnectionCooldownAction({ connectionId: connection.id })
                                  )
                                }
                              >
                                <Icons.refresh />
                              </Button>
                            )}
                            <Button
                              variant='ghost'
                              size='icon'
                              aria-label={t('aiRouter.connections.edit', { name: connection.name })}
                              onClick={() => setEditing({ provider, connection })}
                            >
                              <Icons.edit />
                            </Button>
                            <Button
                              variant='ghost'
                              size='icon'
                              disabled={mutation.isPending}
                              aria-label={t('aiRouter.connections.remove', {
                                name: connection.name
                              })}
                              onClick={() => setRemoving(connection)}
                            >
                              <Icons.trash />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </CardContent>
      {editing && (
        <ConnectionDialog
          provider={editing.provider}
          connection={editing.connection}
          onClose={() => setEditing(null)}
        />
      )}
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('aiRouter.connections.remove', { name: removing?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('aiRouter.connections.removeHint')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                const target = removing;
                setRemoving(null);
                if (target)
                  mutation.mutate(() => deleteConnectionAction({ connectionId: target.id }));
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

interface ConnectionDialogProps {
  provider: AiProviderSummary;
  connection?: AiConnectionSummary;
  onClose: () => void;
}

function ConnectionDialog({ provider, connection, onClose }: ConnectionDialogProps) {
  const t = useT();
  const mutation = useGatewayMutation(() => {
    toast.success(t('aiRouter.connections.saved'));
    onClose();
  });
  const form = useAppForm({
    defaultValues: {
      name: connection?.name ?? '',
      authType:
        connection?.authType ?? (provider.authType === 'oauth' ? 'api_key' : provider.authType),
      apiKey: '',
      priority: connection?.priority ?? 10,
      isActive: connection?.isActive ?? true,
      allowedModels: connection?.allowedModels.join('\n') ?? ''
    },
    validators: {
      onSubmit: z.object({
        name: z
          .string()
          .trim()
          .min(1, t('aiRouter.gateway.invalid'))
          .max(60, t('aiRouter.gateway.invalid')),
        priority: z
          .number({ error: t('aiRouter.gateway.invalid') })
          .int(t('aiRouter.gateway.invalid'))
          .min(0, t('aiRouter.gateway.invalid'))
          .max(10000, t('aiRouter.gateway.invalid')),
        authType: z.enum(['api_key', 'oauth', 'access_token', 'none']),
        apiKey: z.string().max(10000, t('aiRouter.gateway.invalid')),
        isActive: z.boolean(),
        allowedModels: z.string()
      })
    },
    onSubmit: async ({ value }) => {
      const input: ConnectionInput = {
        ...value,
        id: connection?.id,
        providerId: provider.id,
        apiKey:
          value.authType === 'api_key' || value.authType === 'access_token'
            ? value.apiKey || undefined
            : undefined,
        allowedModels: value.allowedModels
          .split('\n')
          .map((model) => model.trim())
          .filter(Boolean)
      };
      await mutation.mutateAsync(() => saveConnectionAction(input)).catch(() => undefined);
    }
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto'>
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
              {connection
                ? t('aiRouter.connections.edit', { name: connection.name })
                : t('aiRouter.connections.add')}
            </DialogTitle>
            <DialogDescription>
              {t('aiRouter.connections.forProvider', { name: provider.name })}
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={mutation.isPending} className='space-y-4'>
            <form.AppField
              name='name'
              children={(field) => (
                <field.TextField label={t('aiRouter.providers.name')} required maxLength={60} />
              )}
            />
            {connection?.authType === 'oauth' ? (
              <p className='text-muted-foreground text-sm'>{t('aiRouter.oauth.managed')}</p>
            ) : (
              <form.AppField
                name='authType'
                children={(field) => (
                  <field.SelectField
                    label={t('aiRouter.gateway.authType')}
                    options={[
                      { value: 'api_key', label: t('aiRouter.providers.apiKey') },
                      { value: 'access_token', label: t('aiRouter.gateway.accessToken') },
                      { value: 'none', label: t('aiRouter.gateway.noAuth') }
                    ]}
                  />
                )}
              />
            )}
            <form.Subscribe selector={(state) => state.values.authType}>
              {(authType) =>
                authType === 'api_key' || authType === 'access_token' ? (
                  <form.AppField
                    name='apiKey'
                    children={(field) => (
                      <field.TextField
                        type='password'
                        label={
                          authType === 'api_key'
                            ? t('aiRouter.providers.apiKey')
                            : t('aiRouter.gateway.accessToken')
                        }
                        description={
                          connection
                            ? t('aiRouter.providers.apiKeyKeep')
                            : t('aiRouter.connections.secretHint')
                        }
                      />
                    )}
                  />
                ) : null
              }
            </form.Subscribe>
            <form.AppField
              name='priority'
              children={(field) => (
                <field.TextField
                  type='number'
                  required
                  min={0}
                  max={10000}
                  label={t('aiRouter.providers.priority')}
                  description={t('aiRouter.connections.priorityHint')}
                />
              )}
            />
            <form.AppField
              name='allowedModels'
              children={(field) => (
                <field.TextareaField
                  rows={4}
                  label={t('aiRouter.connections.allowedModels')}
                  description={t('aiRouter.connections.modelsHint')}
                />
              )}
            />
            <form.AppField
              name='isActive'
              children={(field) => <field.SwitchField label={t('aiRouter.connections.active')} />}
            />
          </fieldset>
          {mutation.error && (
            <p role='alert' className='text-destructive text-sm'>
              {mutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type='button' variant='outline' disabled={mutation.isPending} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type='submit' isLoading={mutation.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RouterSettings({ settings }: { settings: AiRouterSettings }) {
  const t = useT();
  const mutation = useGatewayMutation(() => toast.success(t('aiRouter.settings.saved')));
  const form = useAppForm({
    defaultValues: { ...settings, defaultModel: settings.defaultModel ?? '' },
    validators: {
      onSubmit: z.object({
        defaultModel: z.string().max(200, t('aiRouter.gateway.invalid')),
        compressToolOutput: z.boolean(),
        maxToolOutputChars: z
          .number({ error: t('aiRouter.gateway.invalid') })
          .int(t('aiRouter.gateway.invalid'))
          .min(100, t('aiRouter.gateway.invalid'))
          .max(1000000, t('aiRouter.gateway.invalid'))
      })
    },
    onSubmit: async ({ value }) => {
      await mutation
        .mutateAsync(() =>
          saveRouterSettingsAction({ ...value, defaultModel: value.defaultModel.trim() || null })
        )
        .catch(() => undefined);
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('aiRouter.settings.title')}</CardTitle>
        <CardDescription>{t('aiRouter.settings.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className='space-y-4'
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <fieldset disabled={mutation.isPending} className='space-y-4'>
            <form.AppField
              name='defaultModel'
              children={(field) => (
                <field.TextField
                  label={t('aiRouter.settings.defaultModel')}
                  description={t('aiRouter.settings.defaultHint')}
                  maxLength={200}
                />
              )}
            />
            <form.AppField
              name='compressToolOutput'
              children={(field) => (
                <field.SwitchField
                  label={t('aiRouter.settings.compress')}
                  description={t('aiRouter.settings.compressHint')}
                />
              )}
            />
            <form.AppField
              name='maxToolOutputChars'
              children={(field) => (
                <field.TextField
                  type='number'
                  required
                  min={100}
                  max={1000000}
                  label={t('aiRouter.settings.limit')}
                  description={t('aiRouter.settings.limitHint')}
                />
              )}
            />
          </fieldset>
          {mutation.error && (
            <p role='alert' className='text-destructive text-sm'>
              {mutation.error.message}
            </p>
          )}
          <Button type='submit' isLoading={mutation.isPending}>
            {t('common.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
