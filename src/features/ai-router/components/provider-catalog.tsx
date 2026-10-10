'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { parseAsString, useQueryState } from 'nuqs';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n/client';
import { cn } from '@/lib/utils';
import { AI_PROVIDER_PRESETS } from '@/lib/ai-router/presets';
import type { AiConnectionSummary, AiProviderSummary } from '../api/types';
import { providerAccountStats, providerPresetId } from '../provider-catalog';
import { ProviderDialog } from './ai-providers-settings';
import { authorizeProviderType } from './gateway-mutation';
import { Button } from './gateway-button';
import { connectFreeProviderAction } from '../actions';
import { aiGatewayKeys } from '../api/queries';
import { useQueryClient } from '@tanstack/react-query';

interface ProviderCatalogProps {
  providers: AiProviderSummary[];
  connections: AiConnectionSummary[];
}

const groupFor = (item: { presetId: string; provider?: AiProviderSummary }) => {
  if (item.presetId === 'custom') return 'custom';
  const preset = AI_PROVIDER_PRESETS.find((entry) => entry.id === item.presetId);
  if (preset?.category === 'free') return 'free';
  const authType = item.provider?.authType ?? preset?.authType;
  return authType === 'oauth' ? 'oauth' : item.presetId === 'ollama' ? 'local' : 'api';
};
function ProviderMark({ type }: { type: string }) {
  const Icon =
    type === 'opencode' || type === 'opencode-zen'
      ? Icons.terminal
      : type === 'openai' || type === 'codex'
        ? Icons.openai
        : type === 'claude' || type === 'anthropic'
          ? Icons.sparkles
          : type === 'gemini'
            ? Icons.google
            : Icons.server;
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg',
        type === 'claude' || type === 'anthropic'
          ? 'bg-orange-500/15 text-orange-600 dark:text-orange-300'
          : type === 'codex' || type === 'openai'
            ? 'bg-foreground/10'
            : 'bg-primary/10 text-primary'
      )}
    >
      <Icon className='size-6' />
    </span>
  );
}

export function ProviderCatalog({ providers, connections }: ProviderCatalogProps) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const free = useMutation({
    mutationFn: async () => {
      const result = await connectFreeProviderAction();
      if (!result.ok) throw new Error(result.error);
      return result.providerId;
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: aiGatewayKeys.all });
      if (id) router.push(`/router?tab=providers&provider=${encodeURIComponent(id)}`);
    },
    onError: (error) => toast.error(error.message)
  });
  const [search, setSearch] = useQueryState(
    'q',
    parseAsString.withDefault('').withOptions({ shallow: true })
  );
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState<{ presetId: string; format?: 'openai' | 'claude' } | null>(
    null
  );
  const oauth = useMutation({
    mutationFn: authorizeProviderType,
    onError: (error) => toast.error(error.message)
  });
  const items = [
    ...providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      presetId: providerPresetId(provider),
      provider
    })),
    ...AI_PROVIDER_PRESETS.filter(
      (preset) =>
        preset.id !== 'custom' &&
        !providers.some((provider) => providerPresetId(provider) === preset.id)
    ).map((preset) => ({
      id: preset.id,
      name: preset.name,
      presetId: preset.id,
      provider: undefined
    }))
  ].filter((item) => {
    const stats = item.provider
      ? providerAccountStats(item.provider, connections)
      : { total: 0, available: 0 };
    return (
      item.name.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'connected' && stats.total > 0) ||
        (filter === 'available' && stats.available > 0))
    );
  });
  const groups = [
    { id: 'custom', title: t('aiRouter.workspace.customProviders') },
    { id: 'oauth', title: t('aiRouter.workspace.oauthProviders') },
    { id: 'free', title: t('aiRouter.workspace.freeProviders') },
    { id: 'api', title: t('aiRouter.workspace.apiProviders') },
    { id: 'local', title: t('aiRouter.workspace.localProviders') }
  ];
  return (
    <div className='space-y-8'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-lg font-semibold'>{t('aiRouter.providers.title')}</h2>
          <p className='text-muted-foreground text-sm'>{t('aiRouter.workspace.providerHint')}</p>
        </div>
        <div className='flex w-full gap-2 sm:w-auto'>
          <div className='relative min-w-0 flex-1 sm:w-64'>
            <Icons.search className='text-muted-foreground absolute top-2.5 left-3 size-4' />
            <Input
              aria-label={t('aiRouter.workspace.search')}
              placeholder={t('aiRouter.workspace.search')}
              value={search}
              onChange={(event) => void setSearch(event.target.value)}
              className='pl-9'
            />
          </div>
          <select
            aria-label={t('aiRouter.workspace.filter')}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className='bg-background rounded-md border px-3 text-sm'
          >
            <option value='all'>{t('aiRouter.workspace.all')}</option>
            <option value='connected'>{t('aiRouter.workspace.connected')}</option>
            <option value='available'>{t('aiRouter.workspace.available')}</option>
          </select>
        </div>
      </div>
      {groups.map((group) => {
        const entries = items.filter((item) => groupFor(item) === group.id);
        if (!entries.length && group.id !== 'custom') return null;
        return (
          <section key={group.id} aria-labelledby={`providers-${group.id}`} className='space-y-3'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <h3 id={`providers-${group.id}`} className='text-base font-semibold'>
                {group.title}
              </h3>
              {group.id === 'custom' && (
                <div className='flex flex-wrap gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setAdding({ presetId: 'custom', format: 'claude' })}
                  >
                    <Icons.add /> {t('aiRouter.workspace.addAnthropic')}
                  </Button>
                  <Button
                    size='sm'
                    onClick={() => setAdding({ presetId: 'custom', format: 'openai' })}
                  >
                    <Icons.add /> {t('aiRouter.workspace.addOpenai')}
                  </Button>
                </div>
              )}
            </div>
            {!entries.length ? (
              <div className='text-muted-foreground rounded-xl border border-dashed p-5 text-center text-sm'>
                {t('aiRouter.workspace.emptyCustom')}
              </div>
            ) : (
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
                {entries.map((item) => {
                  const stats = item.provider
                    ? providerAccountStats(item.provider, connections)
                    : { total: 0, available: 0 };
                  const content = (
                    <>
                      <ProviderMark type={item.presetId} />
                      <span className='min-w-0 flex-1 space-y-1'>
                        <span className='block truncate text-sm font-semibold'>{item.name}</span>
                        <span className='text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs'>
                          {stats.available > 0 && (
                            <span className='size-1.5 rounded-full bg-emerald-500' />
                          )}
                          {stats.total
                            ? t('aiRouter.workspace.accountCount', {
                                total: stats.total,
                                available: stats.available
                              })
                            : item.presetId === 'opencode'
                              ? t('aiRouter.workspace.noKeyNeeded')
                              : t('aiRouter.workspace.noConnections')}
                          {item.provider && !item.provider.enabled && (
                            <span>{t('aiRouter.providers.off')}</span>
                          )}
                        </span>
                      </span>
                      <Icons.chevronRight className='text-muted-foreground size-4 shrink-0' />
                    </>
                  );
                  const className =
                    'bg-card hover:bg-muted/60 focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:ring-2';
                  return item.provider ? (
                    <Link
                      key={item.id}
                      className={className}
                      href={`/router?tab=providers&provider=${encodeURIComponent(item.id)}`}
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      key={item.id}
                      type='button'
                      className={className}
                      disabled={oauth.isPending || free.isPending}
                      aria-busy={(item.presetId === 'opencode' && free.isPending) || undefined}
                      onClick={() =>
                        item.presetId === 'opencode'
                          ? free.mutate()
                          : item.presetId === 'claude' || item.presetId === 'codex'
                            ? oauth.mutate(item.presetId)
                            : setAdding({ presetId: item.presetId })
                      }
                    >
                      {content}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      {items.length === 0 && (
        <p role='status' className='text-muted-foreground text-sm'>
          {t('aiRouter.workspace.noResults')}
        </p>
      )}
      {adding && (
        <ProviderDialog
          provider={null}
          presetId={adding.presetId}
          initialFormat={adding.format}
          nextPriority={(providers.at(-1)?.priority ?? 0) + 10}
          onClose={() => setAdding(null)}
          onSaved={(id) => {
            setAdding(null);
            toast.success(t('aiRouter.providers.saved'));
            if (id) router.push(`/router?tab=providers&provider=${encodeURIComponent(id)}`);
            else router.refresh();
          }}
        />
      )}
    </div>
  );
}
