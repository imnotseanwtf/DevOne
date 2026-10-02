import { AuditList } from '@/components/audit/audit-list';
import PageContainer from '@/components/layout/page-container';
import { SettingsTabs } from '@/components/layout/settings-tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getRepositoryBranches } from '@/features/git/service';
import { DevopsSettings } from '@/features/project-settings/components/devops-settings';
import { GeneralSettings } from '@/features/project-settings/components/general-settings';
import { MembersSettings } from '@/features/project-settings/components/members-settings';
import { RepositorySettings } from '@/features/project-settings/components/repository-settings';
import { PROJECT_SETTINGS_TABS, type ProjectSettingsTab } from '@/features/project-settings/schema';
import {
  getProjectSettings,
  listProjectActivity,
  listProjectRepositorySettings
} from '@/features/project-settings/service';
import { ProjectAccessError } from '@/features/projects/service';
import { getT } from '@/i18n/server';
import { requireUser } from '@/lib/auth/session';
import { getPrisma } from '@/lib/db/prisma';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'Settings' };

interface SettingsPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function ProjectSettingsPage({ params, searchParams }: SettingsPageProps) {
  const user = await requireUser();
  const { projectId } = await params;
  const { tab: requested } = await searchParams;
  const t = await getT();

  const settings = await getProjectSettings(user.id, projectId).catch((error: unknown) => {
    if (error instanceof ProjectAccessError) notFound();
    throw error;
  });
  const { project, role } = settings;
  const isOwner = role === 'OWNER';
  // Activity is the owners' audit trail; members don't get the tab.
  const tabs = PROJECT_SETTINGS_TABS.filter((tab) => tab !== 'activity' || isOwner);
  const active: ProjectSettingsTab = tabs.includes(requested as ProjectSettingsTab)
    ? (requested as ProjectSettingsTab)
    : 'general';

  return (
    <PageContainer
      pageTitle={t('projectSettings.title')}
      pageDescription={t('projectSettings.description')}
    >
      <div className='space-y-6'>
        <SettingsTabs
          basePath={`/projects/${project.id}/settings`}
          label={t('projectSettings.title')}
          active={active}
          tabs={tabs.map((tab) => ({ id: tab, label: t(`projectSettings.tabs.${tab}`) }))}
        />
        {active === 'general' && <GeneralSettings project={project} isOwner={isOwner} />}
        {active === 'members' && (
          <MembersTab projectId={project.id} userId={user.id} isOwner={isOwner} />
        )}
        {active === 'repositories' && (
          <RepositoriesTab projectId={project.id} userId={user.id} isOwner={isOwner} />
        )}
        {active === 'devops' && (
          <DevopsSettings
            projectId={project.id}
            isOwner={isOwner}
            settings={{
              terminalAccess: project.terminalAccess,
              sshAllowedHosts: project.sshAllowedHosts,
              hiddenPipelineBranches: project.hiddenPipelineBranches
            }}
          />
        )}
        {active === 'activity' && <ActivityTab projectId={project.id} userId={user.id} />}
      </div>
    </PageContainer>
  );
}

interface TabProps {
  projectId: string;
  userId: string;
  isOwner: boolean;
}

async function MembersTab({ projectId, userId, isOwner }: TabProps) {
  const members = await getPrisma().projectMember.findMany({
    where: { projectId },
    include: { user: { select: { id: true, username: true, name: true, avatarUrl: true } } },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }]
  });
  return (
    <MembersSettings
      projectId={projectId}
      currentUserId={userId}
      isOwner={isOwner}
      members={members.map((member) => ({
        userId: member.user.id,
        username: member.user.username,
        name: member.user.name,
        avatarUrl: member.user.avatarUrl,
        role: member.role,
        joinedAt: member.createdAt
      }))}
    />
  );
}

async function RepositoriesTab({ projectId, userId, isOwner }: TabProps) {
  const repositories = await listProjectRepositorySettings(userId, projectId);
  const withBranches = await Promise.all(
    repositories.map(async (repository) => ({
      ...repository,
      branches: isOwner
        ? (await getRepositoryBranches(userId, repository.repositoryId).catch(() => [])).map(
            (branch) => branch.name
          )
        : []
    }))
  );
  return <RepositorySettings projectId={projectId} repositories={withBranches} isOwner={isOwner} />;
}

async function ActivityTab({ projectId, userId }: Omit<TabProps, 'isOwner'>) {
  const t = await getT();
  const events = await listProjectActivity(userId, projectId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('projectSettings.activity.title')}</CardTitle>
        <CardDescription>{t('projectSettings.activity.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <AuditList events={events} empty={t('projectSettings.activity.empty')} />
      </CardContent>
    </Card>
  );
}
