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
import { Checkbox } from '@/components/ui/checkbox';
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
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
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

export interface AiProviderRow {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  priority: number;
  enabled: boolean;
  hasApiKey: boolean;
  cooldownUntil: Date | null;
  lastError: string | null;
}

type Editing = { mode: 'add' } | { mode: 'edit'; provider: AiProviderRow } | null;

export function AiProvidersSettings({ providers }: { providers: AiProviderRow[] }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<AiProviderRow | null>(null);
  const timeFormat = new Intl.DateTimeFormat(locale, { timeStyle: 'short' });
  const now = new Date();

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? t('common.somethingWrong'));
        return;
      }
      if (success) toast.success(success);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-4'>
        <div className='space-y-1.5'>
          <CardTitle>{t('aiRouter.providers.title')}</CardTitle>
          <CardDescription>{t('aiRouter.providers.description')}</CardDescription>
        </div>
        <Button size='sm' onClick={() => setEditing({ mode: 'add' })}>
          <Icons.add /> {t('aiRouter.providers.add')}
        </Button>
      </CardHeader>
      <CardContent>
        {providers.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('aiRouter.providers.empty')}</p>
        ) : (
          <ul className='divide-border divide-y rounded-md border'>
            {providers.map((provider) => {
              const resting = provider.cooldownUntil && provider.cooldownUntil > now;
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
                    <p className='flex flex-wrap items-center gap-2 text-sm font-medium'>
                      {provider.name}
                      <Badge variant='outline'>#{provider.priority}</Badge>
                      {!provider.enabled && (
                        <Badge variant='secondary'>{t('aiRouter.providers.off')}</Badge>
                      )}
                      {!provider.hasApiKey && (
                        <Badge variant='secondary'>{t('aiRouter.providers.noKey')}</Badge>
                      )}
                      {resting && provider.cooldownUntil && (
                        <Badge variant='destructive'>
                          {t('aiRouter.providers.resting', {
                            time: timeFormat.format(provider.cooldownUntil)
                          })}
                        </Badge>
                      )}
                    </p>
                    <p className='text-muted-foreground text-xs'>
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
                      onClick={() => setEditing({ mode: 'edit', provider })}
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
          provider={editing.mode === 'edit' ? editing.provider : null}
          nextPriority={(providers.at(-1)?.priority ?? 0) + 10}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast.success(t('aiRouter.providers.saved'));
            router.refresh();
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

function ProviderDialog({
  provider,
  nextPriority,
  onClose,
  onSaved
}: {
  provider: AiProviderRow | null;
  nextPriority: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [presetId, setPresetId] = useState(provider ? 'custom' : AI_PROVIDER_PRESETS[0].id);
  const preset = AI_PROVIDER_PRESETS.find((candidate) => candidate.id === presetId);
  const [name, setName] = useState(provider?.name ?? AI_PROVIDER_PRESETS[0].name);
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? AI_PROVIDER_PRESETS[0].baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [models, setModels] = useState(
    (provider?.models ?? AI_PROVIDER_PRESETS[0].models).join('\n')
  );
  const [priority, setPriority] = useState(String(provider?.priority ?? nextPriority));
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [fetching, startFetching] = useTransition();

  const choosePreset = (id: string) => {
    const next = AI_PROVIDER_PRESETS.find((candidate) => candidate.id === id);
    setPresetId(id);
    if (!next) return;
    setName(next.name);
    setBaseUrl(next.baseUrl);
    setModels(next.models.join('\n'));
  };

  const fetchModels = () =>
    startFetching(async () => {
      setError(undefined);
      const result = await fetchProviderModelsAction({
        providerId: provider?.id,
        baseUrl,
        apiKey: apiKey || undefined
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Keep the models already chosen first, then the rest of what the provider offers.
      const chosen = modelLines(models);
      setModels([...new Set([...chosen, ...result.models])].join('\n'));
      toast.success(t('aiRouter.providers.fetched', { count: result.models.length }));
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-lg'>
        <form
          className='space-y-4'
          autoComplete='off'
          onSubmit={(event) => {
            event.preventDefault();
            setError(undefined);
            startTransition(async () => {
              const result = await saveProviderAction({
                id: provider?.id,
                name,
                baseUrl,
                apiKey: apiKey || undefined,
                clearApiKey,
                models: modelLines(models),
                priority: Number(priority) || 0,
                enabled
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              onSaved();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {provider
                ? t('aiRouter.providers.editTitle', { name: provider.name })
                : t('aiRouter.providers.addTitle')}
            </DialogTitle>
            {preset?.hint && <DialogDescription>{preset.hint}</DialogDescription>}
          </DialogHeader>
          {!provider && (
            <div className='space-y-2'>
              <Label htmlFor='ai-provider-preset'>{t('aiRouter.providers.preset')}</Label>
              <NativeSelect
                id='ai-provider-preset'
                className='w-full'
                value={presetId}
                onChange={(event) => choosePreset(event.target.value)}
              >
                {AI_PROVIDER_PRESETS.map((candidate) => (
                  <NativeSelectOption key={candidate.id} value={candidate.id}>
                    {candidate.name || 'Custom'}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}
          <div className='grid gap-4 sm:grid-cols-[1fr_7rem]'>
            <div className='space-y-2'>
              <Label htmlFor='ai-provider-name'>{t('aiRouter.providers.name')}</Label>
              <Input
                id='ai-provider-name'
                required
                maxLength={60}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ai-provider-priority'>{t('aiRouter.providers.priority')}</Label>
              <Input
                id='ai-provider-priority'
                type='number'
                min={0}
                max={10000}
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              />
            </div>
          </div>
          <p className='text-muted-foreground -mt-2 text-xs'>
            {t('aiRouter.providers.nameHint', { name: name || 'Provider' })}{' '}
            {t('aiRouter.providers.priorityHint')}
          </p>
          <div className='space-y-2'>
            <Label htmlFor='ai-provider-url'>{t('aiRouter.providers.baseUrl')}</Label>
            <Input
              id='ai-provider-url'
              required
              placeholder='https://api.example.com/v1'
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='ai-provider-key'>{t('aiRouter.providers.apiKey')}</Label>
            <Input
              id='ai-provider-key'
              type='password'
              value={apiKey}
              disabled={clearApiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            {provider?.hasApiKey && (
              <>
                <p className='text-muted-foreground text-xs'>
                  {t('aiRouter.providers.apiKeyKeep')}
                </p>
                <Label className='text-sm font-normal'>
                  <Checkbox
                    checked={clearApiKey}
                    onCheckedChange={(checked) => setClearApiKey(checked === true)}
                  />
                  {t('aiRouter.providers.clearKey')}
                </Label>
              </>
            )}
          </div>
          <div className='space-y-2'>
            <div className='flex items-center justify-between gap-2'>
              <Label htmlFor='ai-provider-models'>{t('aiRouter.providers.models')}</Label>
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={fetching || !baseUrl.trim()}
                onClick={fetchModels}
              >
                {fetching ? <Icons.spinner className='animate-spin' /> : <Icons.download />}
                {t('aiRouter.providers.fetchModels')}
              </Button>
            </div>
            <Textarea
              id='ai-provider-models'
              rows={5}
              className='font-mono text-xs'
              value={models}
              onChange={(event) => setModels(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>{t('aiRouter.providers.modelsHint')}</p>
          </div>
          <Label className='text-sm font-normal'>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            {t('aiRouter.providers.enabled')}
          </Label>
          {error && <p className='text-destructive text-sm'>{error}</p>}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type='submit' disabled={pending}>
              {pending && <Icons.spinner className='animate-spin' />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
