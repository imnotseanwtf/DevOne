import PageContainer from '@/components/layout/page-container';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { Icons } from '@/components/icons';
import { ProjectCard } from '@/features/projects/components/project-card';
import {
  listConnectionsForUser,
  listProjectRepositories,
  listProviderRepositories
} from '@/features/git/service';
import { LinkNewProjectForm } from '@/features/git/components/link-repository-form';
import { listProjectMembers, listProjectsForUser } from '@/features/projects/service';
import { requireUser } from '@/lib/auth/session';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Projects' };

export default async function ProjectsPage() {
  const user = await requireUser();
  const projects = await listProjectsForUser(user.id);
  const membersByProject = new Map(
    await Promise.all(
      projects.map(async (project) => {
        const members = await listProjectMembers(user.id, project.id).catch(() => []);
        return [project.id, members] as const;
      })
    )
  );
  const linkedByProject = new Map(
    await Promise.all(
      projects.map(async (project) => {
        const linked = await listProjectRepositories(user.id, project.id).catch(() => []);
        return [project.id, linked] as const;
      })
    )
  );
  const connections = await listConnectionsForUser(user.id);
  const providerRepos = (
    await Promise.all(
      connections.map(async (connection) => {
        const repositories = await listProviderRepositories(user.id, connection.id).catch(() => []);
        return repositories.map((repository) => ({
          connectionId: connection.id,
          providerRepositoryId: repository.providerRepositoryId,
          fullName: repository.fullName
        }));
      })
    )
  ).flat();

  return (
    <PageContainer
      pageTitle='Projects'
      pageDescription='Connect repositories, issues, databases, and environments in one project.'
    >
      <div className='grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]'>
        <section aria-label='Your projects'>
          {projects.length === 0 ? (
            <Empty className='bg-card min-h-80 border'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Icons.workspace aria-hidden='true' />
                </EmptyMedia>
                <EmptyTitle>No projects yet</EmptyTitle>
                <EmptyDescription>
                  Link a repository below and its project is created automatically.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className='grid gap-4 md:grid-cols-2'>
              {projects.map((project) => {
                const members = membersByProject.get(project.id) ?? [];
                const isOwner = members.some(
                  (member) => member.userId === user.id && member.role === 'OWNER'
                );
                const linked = linkedByProject.get(project.id) ?? [];
                const linkedNames = new Set(linked.map((repository) => repository.fullName));
                return (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    members={members}
                    currentUserId={user.id}
                    isOwner={isOwner}
                    linkedRepos={linked.map((repository) => ({
                      id: repository.id,
                      fullName: repository.fullName
                    }))}
                    linkableRepos={providerRepos.filter(
                      (repository) => !linkedNames.has(repository.fullName)
                    )}
                  />
                );
              })}
            </div>
          )}
        </section>
        <aside aria-label='Start a project'>
          <LinkNewProjectForm repositories={providerRepos} />
        </aside>
      </div>
    </PageContainer>
  );
}
