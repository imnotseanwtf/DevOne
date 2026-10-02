import KBar from '@/components/kbar';
import AppSidebar from '@/components/layout/app-sidebar';
import Header from '@/components/layout/header';
import { InfoSidebar } from '@/components/layout/info-sidebar';
import { InfobarProvider } from '@/components/ui/infobar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { listProjectsForUser } from '@/features/projects/service';
import { requireUser } from '@/lib/auth/session';
import { cookies } from 'next/headers';

/** Shared dashboard shell: sidebar, header, project switcher, and providers. */
export default async function DashboardShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar_state')?.value === 'true';
  const projects = await listProjectsForUser(user.id);
  const switcherProjects = projects.map((project) => ({
    id: project.id,
    name: project.name,
    issuePrefix: project.issuePrefix,
    memberCount: project.memberCount
  }));
  return (
    <KBar>
      <SidebarProvider defaultOpen={defaultOpen}>
        <a
          href='#main-content'
          className='bg-background ring-ring sr-only rounded-md px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:ring-2'
        >
          Skip to content
        </a>
        <AppSidebar projects={switcherProjects} />
        <SidebarInset id='main-content' tabIndex={-1} className='scroll-mt-16'>
          <Header
            username={user.username}
            isAdmin={user.role === 'ADMIN'}
            projects={switcherProjects}
          />
          <InfobarProvider defaultOpen={false}>
            {children}
            <InfoSidebar side='right' />
          </InfobarProvider>
        </SidebarInset>
      </SidebarProvider>
    </KBar>
  );
}
