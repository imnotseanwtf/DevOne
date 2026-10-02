import PageContainer from '@/components/layout/page-container';
import { DevOpsTabs } from '@/features/devops/components/devops-tabs';
import { SshWorkspace } from '@/features/devops/components/ssh-workspace';
import { getPreferences } from '@/features/account/service';
import { listSshHosts } from '@/features/devops/ssh-service';
import { getTerminalPolicy } from '@/features/project-settings/service';
import { listProjectsForUser } from '@/features/projects/service';
import { requireUser } from '@/lib/auth/session';
import { getT } from '@/i18n/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'Terminal' };

interface TerminalPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function TerminalPage({ params }: TerminalPageProps) {
  const user = await requireUser();
  const { projectId } = await params;

  const projects = await listProjectsForUser(user.id);
  const project = projects.find((entry) => entry.id === projectId);
  if (!project) notFound();

  const t = await getT();
  const [savedHosts, policy, preferences] = await Promise.all([
    listSshHosts(user.id, project.id),
    getTerminalPolicy(user.id, project.id),
    getPreferences(user.id)
  ]);

  return (
    <PageContainer pageTitle={t('devops.title')} pageDescription={t('devops.description')}>
      <div className='space-y-6'>
        <DevOpsTabs projectId={project.id} active='terminal' />
        <SshWorkspace
          projectId={project.id}
          savedHosts={savedHosts}
          policy={{
            allowed: policy.allowed,
            access: policy.terminalAccess,
            allowedHosts: policy.sshAllowedHosts,
            isOwner: policy.role === 'OWNER'
          }}
          fontSize={preferences.terminalFontSize}
        />
      </div>
    </PageContainer>
  );
}
