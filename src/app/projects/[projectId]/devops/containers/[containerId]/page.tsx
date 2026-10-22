import PageContainer from '@/components/layout/page-container';
import { getPreferences } from '@/features/account/service';
import { ContainerDetail } from '@/features/devops/components/container-detail';
import { DevOpsTabs } from '@/features/devops/components/devops-tabs';
import { listSshHosts } from '@/features/devops/ssh-service';
import { getTerminalPolicy } from '@/features/project-settings/service';
import { listProjectsForUser } from '@/features/projects/service';
import { requireUser } from '@/lib/auth/session';
import { CONTAINER_ID } from '@/lib/docker/containers';
import { getT } from '@/i18n/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'Container' };

interface ContainerPageProps {
  params: Promise<{ projectId: string; containerId: string }>;
  searchParams: Promise<{ source?: string }>;
}

export default async function ContainerPage({ params, searchParams }: ContainerPageProps) {
  const user = await requireUser();
  const { projectId, containerId } = await params;
  const { source = 'local' } = await searchParams;
  if (!CONTAINER_ID.test(containerId)) notFound();

  const projects = await listProjectsForUser(user.id);
  const project = projects.find((entry) => entry.id === projectId);
  if (!project) notFound();

  const t = await getT();
  const [savedHosts, policy, preferences] = await Promise.all([
    listSshHosts(user.id, project.id),
    getTerminalPolicy(user.id, project.id),
    getPreferences(user.id)
  ]);
  const host = savedHosts.find((entry) => entry.id === source);
  if (source !== 'local' && !host) notFound();

  return (
    <PageContainer pageTitle={t('devops.title')} pageDescription={t('devops.description')}>
      <div className='space-y-6'>
        <DevOpsTabs projectId={project.id} active='containers' />
        <ContainerDetail
          projectId={project.id}
          source={source}
          sourceName={host ? host.name : t('devops.containers.local')}
          containerId={containerId}
          allowed={policy.allowed && (source !== 'local' || policy.role === 'OWNER')}
          isOwner={policy.role === 'OWNER'}
          fontSize={preferences.terminalFontSize}
        />
      </div>
    </PageContainer>
  );
}
