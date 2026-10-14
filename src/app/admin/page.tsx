import { AuditList } from '@/components/audit/audit-list';
import PageContainer from '@/components/layout/page-container';
import { SettingsTabs } from '@/components/layout/settings-tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UsersTable } from '@/features/admin/components/users-table';
import { AiCombosSettings } from '@/features/ai-router/components/ai-combos-settings';
import { AiRouterSettings } from '@/features/ai-router/components/ai-router-settings';
import { AiProvidersSettings } from '@/features/ai-router/components/ai-providers-settings';
import { AiUsageCard } from '@/features/ai-router/components/ai-usage-card';
import { routerEndpoint } from '@/features/ai-router/endpoint';
import {
  listCombos,
  listProviders,
  loadRouterSettings,
  usageOverview
} from '@/features/ai-router/service';
import { listAuditEvents, listUsers, signInPolicy } from '@/features/admin/service';
import { getT } from '@/i18n/server';
import { requireUser } from '@/lib/auth/session';
import { isDemoMode } from '@/lib/demo';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'Admin' };

const TABS = ['users', 'ai', 'policy', 'audit'] as const;
type AdminTab = (typeof TABS)[number];

interface AdminPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const user = await requireUser();
  // Not "forbidden": to anyone else the page simply doesn't exist.
  if (user.role !== 'ADMIN') notFound();
  const t = await getT();
  const { tab } = await searchParams;
  const active: AdminTab = TABS.includes(tab as AdminTab) ? (tab as AdminTab) : 'users';

  return (
    <PageContainer pageTitle={t('admin.title')} pageDescription={t('admin.description')}>
      <div className='space-y-6'>
        <SettingsTabs
          basePath='/admin'
          label={t('admin.title')}
          active={active}
          tabs={TABS.map((id) => ({ id, label: t(`admin.tabs.${id}`) }))}
        />
        {active === 'users' && <UsersTab adminId={user.id} />}
        {active === 'ai' && <AiRouterTab adminId={user.id} />}
        {active === 'policy' && <PolicyTab />}
        {active === 'audit' && <AuditTab adminId={user.id} />}
      </div>
    </PageContainer>
  );
}

async function UsersTab({ adminId }: { adminId: string }) {
  const t = await getT();
  const users = await listUsers(adminId);
  return (
    <div className='space-y-3'>
      <p className='text-muted-foreground text-sm'>
        {t('admin.users.count', { count: users.length })}
      </p>
      <UsersTable users={users} currentUserId={adminId} />
    </div>
  );
}

async function AiRouterTab({ adminId }: { adminId: string }) {
  const t = await getT();
  if (isDemoMode()) {
    return <p className='text-muted-foreground text-sm'>{t('aiRouter.keys.disabledInDemo')}</p>;
  }
  const [providers, combos, usage, endpoint, settings] = await Promise.all([
    listProviders(adminId),
    listCombos(adminId),
    usageOverview(adminId),
    routerEndpoint(),
    loadRouterSettings()
  ]);
  return (
    <div className='space-y-6'>
      <div className='text-muted-foreground space-y-2 text-sm'>
        <p>{t('aiRouter.intro')}</p>
        <p>
          {t('aiRouter.endpoint')}:{' '}
          <code className='bg-muted rounded px-1.5 py-0.5'>{endpoint}</code>
        </p>
      </div>
      <AiProvidersSettings providers={providers} />
      <AiCombosSettings combos={combos} providers={providers} />
      <AiRouterSettings settings={settings} />
      <AiUsageCard usage={usage} />
    </div>
  );
}

function ValueList({ values, empty }: { values: string[]; empty: string }) {
  if (values.length === 0) return <span className='text-muted-foreground'>{empty}</span>;
  return (
    <span className='flex flex-wrap gap-1'>
      {values.map((value) => (
        <code key={value} className='bg-muted rounded px-1.5 py-0.5 text-xs'>
          {value}
        </code>
      ))}
    </span>
  );
}

async function PolicyTab() {
  const t = await getT();
  const policy = signInPolicy();
  const yesNo = (value: boolean) => (
    <Badge variant={value ? 'default' : 'secondary'}>
      {value ? t('common.yes') : t('common.no')}
    </Badge>
  );
  const rows: { label: string; variable: string; value: React.ReactNode }[] = [
    {
      label: t('admin.policy.providers'),
      variable: 'DEVONE_AUTH_PROVIDERS',
      value: <ValueList values={policy.providers} empty={t('common.none')} />
    },
    {
      label: t('admin.policy.registration'),
      variable: 'DEVONE_ALLOW_REGISTRATION',
      value: yesNo(policy.allowRegistration)
    },
    {
      label: t('admin.policy.bootstrap'),
      variable: 'DEVONE_ALLOW_BOOTSTRAP',
      value: yesNo(policy.allowBootstrap)
    },
    {
      label: t('admin.policy.githubOrgs'),
      variable: 'DEVONE_GITHUB_ALLOWED_ORGS',
      value: <ValueList values={policy.githubOrganizations} empty={t('admin.policy.anyone')} />
    },
    {
      label: t('admin.policy.gitlabGroups'),
      variable: 'DEVONE_GITLAB_ALLOWED_GROUPS',
      value: <ValueList values={policy.gitlabGroups} empty={t('admin.policy.anyone')} />
    },
    {
      label: t('admin.policy.trustProxy'),
      variable: 'DEVONE_TRUST_PROXY',
      value: yesNo(policy.trustProxy)
    }
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin.tabs.policy')}</CardTitle>
        <CardDescription>{t('admin.policy.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className='divide-border divide-y'>
          {rows.map(({ label, variable, value }) => (
            <div key={variable} className='grid gap-1 py-3 sm:grid-cols-[1fr_auto] sm:items-center'>
              <dt>
                <p className='text-sm font-medium'>{label}</p>
                <code className='text-muted-foreground text-xs'>{variable}</code>
              </dt>
              <dd className='text-sm'>{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

async function AuditTab({ adminId }: { adminId: string }) {
  const t = await getT();
  const events = await listAuditEvents(adminId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin.tabs.audit')}</CardTitle>
        <CardDescription>{t('admin.audit.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <AuditList events={events} empty={t('admin.audit.empty')} showProject />
      </CardContent>
    </Card>
  );
}
