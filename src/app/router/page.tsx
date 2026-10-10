import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import PageContainer from '@/components/layout/page-container';
import { SettingsTabs } from '@/components/layout/settings-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  gatewayAdminQueryOptions,
  gatewayEndpointQueryOptions
} from '@/features/ai-router/api/queries';
import { AiGatewayPanel } from '@/features/ai-router/components/ai-gateway-panel';
import { AiKeysSettings } from '@/features/ai-router/components/ai-keys-settings';
import { AiUsageCard } from '@/features/ai-router/components/ai-usage-card';
import { usageOverview } from '@/features/ai-router/service';
import { requireUser } from '@/lib/auth/session';
import { isDemoMode } from '@/lib/demo';
import { getQueryClient } from '@/lib/query-client';
import { getT } from '@/i18n/server';

export const metadata: Metadata = { title: 'Router' };
const TABS = ['providers', 'endpoint', 'combos', 'usage', 'settings'] as const;

export default async function RouterPage({
  searchParams
}: {
  searchParams: Promise<{ tab?: string; provider?: string; aiOAuth?: string }>;
}) {
  const user = await requireUser();
  const t = await getT();
  const params = await searchParams;
  const tabs = user.role === 'ADMIN' ? TABS : (['endpoint'] as const);
  const active = tabs.find((id) => id === params.tab) ?? tabs[0];
  return (
    <PageContainer
      pageTitle={t('aiRouter.workspace.title')}
      pageDescription={t('aiRouter.workspace.description')}
    >
      <div className='space-y-7'>
        <SettingsTabs
          basePath='/router'
          label={t('aiRouter.workspace.title')}
          active={active}
          tabs={tabs.map((id) => ({ id, label: t(`aiRouter.workspace.tabs.${id}`) }))}
        />
        {isDemoMode() ? (
          <p className='text-muted-foreground text-sm'>{t('aiRouter.keys.disabledInDemo')}</p>
        ) : (
          <Suspense fallback={<Skeleton className='h-72 w-full' />}>
            <RouterContent
              userId={user.id}
              active={active}
              providerId={params.provider}
              oauthResult={params.aiOAuth}
            />
          </Suspense>
        )}
      </div>
    </PageContainer>
  );
}

async function RouterContent({
  userId,
  active,
  providerId,
  oauthResult
}: {
  userId: string;
  active: (typeof TABS)[number];
  providerId?: string;
  oauthResult?: string;
}) {
  if (active === 'providers' || active === 'settings' || active === 'combos') {
    const queryClient = getQueryClient();
    void queryClient.prefetchQuery(gatewayAdminQueryOptions(userId));
    return (
      <HydrationBoundary state={dehydrate(queryClient)}>
        <AiGatewayPanel
          userId={userId}
          view={active}
          providerId={providerId}
          oauthResult={oauthResult}
        />
      </HydrationBoundary>
    );
  }
  if (active === 'usage') return <AiUsageCard usage={await usageOverview(userId)} />;
  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(gatewayEndpointQueryOptions(userId));
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AiKeysSettings userId={userId} />
    </HydrationBoundary>
  );
}
