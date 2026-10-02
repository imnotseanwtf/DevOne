import PageContainer from '@/components/layout/page-container';
import { SettingsTabs } from '@/components/layout/settings-tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ConnectionsSettings } from '@/features/account/components/connections-settings';
import { PreferencesForm } from '@/features/account/components/preferences-form';
import { SessionsSettings } from '@/features/account/components/sessions-settings';
import { SshServersSettings } from '@/features/account/components/ssh-servers-settings';
import { getProfile, listConnections, listSessions } from '@/features/account/service';
import { listAllSshHosts } from '@/features/devops/ssh-service';
import { getLocale, getT } from '@/i18n/server';
import { getCurrentSessionId, requireUser } from '@/lib/auth/session';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'My account' };

const TABS = ['profile', 'connections', 'ssh', 'sessions', 'preferences'] as const;
type AccountTab = (typeof TABS)[number];

interface AccountPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const user = await requireUser();
  const t = await getT();
  const { tab } = await searchParams;
  const active: AccountTab = TABS.includes(tab as AccountTab) ? (tab as AccountTab) : 'profile';

  return (
    <PageContainer pageTitle={t('account.title')} pageDescription={t('account.description')}>
      <div className='space-y-6'>
        <SettingsTabs
          basePath='/account'
          label={t('account.title')}
          active={active}
          tabs={TABS.map((id) => ({ id, label: t(`account.tabs.${id}`) }))}
        />
        {active === 'profile' && <ProfileTab userId={user.id} />}
        {active === 'connections' && (
          <ConnectionsSettings connections={await listConnections(user.id)} />
        )}
        {active === 'ssh' && <SshServersSettings servers={await listAllSshHosts(user.id)} />}
        {active === 'sessions' && (
          <SessionsSettings
            sessions={await listSessions(user.id)}
            currentSessionId={await getCurrentSessionId()}
          />
        )}
        {active === 'preferences' && (
          <PreferencesForm preferences={(await getProfile(user.id)).preferences} />
        )}
      </div>
    </PageContainer>
  );
}

async function ProfileTab({ userId }: { userId: string }) {
  const t = await getT();
  const locale = await getLocale();
  const profile = await getProfile(userId);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'long' });
  const provider = profile.provider === 'GITHUB' ? 'GitHub' : 'GitLab';

  const facts = [
    [t('account.profile.role'), profile.role === 'ADMIN' ? t('common.admin') : t('common.member')],
    [t('account.profile.memberSince'), dateFormat.format(profile.createdAt)],
    [t('account.profile.lastSignIn'), dateFormat.format(profile.lastLoginAt)],
    [t('account.profile.projects'), String(profile.projectCount)]
  ];

  return (
    <Card>
      <CardContent className='flex flex-col gap-6 py-6 sm:flex-row sm:items-center'>
        <Avatar className='size-20'>
          {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} alt='' />}
          <AvatarFallback className='text-xl'>
            {profile.username.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className='flex-1 space-y-1'>
          <h2 className='text-xl font-semibold'>{profile.name ?? profile.username}</h2>
          <p className='text-muted-foreground'>@{profile.username}</p>
          <Badge variant='secondary'>{t('account.profile.signedInWith', { provider })}</Badge>
          <p className='text-muted-foreground pt-2 text-xs'>
            {t('account.profile.fromProvider', { provider })}
          </p>
        </div>
        <dl className='grid grid-cols-2 gap-x-8 gap-y-3 text-sm'>
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className='text-muted-foreground text-xs'>{label}</dt>
              <dd className='font-medium'>{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
