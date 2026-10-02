'use client';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail
} from '@/components/ui/sidebar';
import { navGroups } from '@/config/nav-config';
import { useFilteredNavGroups } from '@/hooks/use-nav';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { Icons } from '@/components/icons';
import { ProjectSwitcherMenu, type FabProject } from '@/components/layout/project-switcher-fab';
import { useT } from '@/i18n/client';

const PROJECT_SLUG_PREFIX = '/projects/';

export default function AppSidebar({ projects }: { projects: FabProject[] }) {
  const pathname = usePathname();
  const params = useParams();
  const filteredGroups = useFilteredNavGroups(navGroups);
  const t = useT();
  /** "/dashboard/devops" → the translated "DevOps"; unknown entries keep their own title. */
  const titleOf = (url: string, fallback: string) =>
    t.maybe(`nav.${url.split('/').filter(Boolean).at(-1)}`) ?? fallback;

  const routeProjectId = typeof params.projectId === 'string' ? params.projectId : null;
  const activeProjectId =
    routeProjectId && projects.some((project) => project.id === routeProjectId)
      ? routeProjectId
      : null;
  const linkProjectId = activeProjectId ?? projects[0]?.id ?? null;

  /** Module links stay inside the active project; otherwise fall back to the list. */
  function hrefFor(url: string): string {
    if (!url.startsWith('/dashboard/')) return url;
    const slug = url.slice('/dashboard/'.length);
    if (!linkProjectId) return '/projects';
    if (slug === 'overview' || slug === '') return `${PROJECT_SLUG_PREFIX}${linkProjectId}`;
    return `${PROJECT_SLUG_PREFIX}${linkProjectId}/${slug}`;
  }

  const visibleGroups = linkProjectId ? filteredGroups : [];

  return (
    <Sidebar collapsible='icon'>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size='lg'
              render={<Link href='/dashboard/overview' aria-label='DevOne home' />}
            >
              <span className='bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg'>
                <Icons.logo aria-hidden='true' className='size-5' />
              </span>
              <span
                className='truncate text-base font-semibold group-data-[collapsible=icon]:hidden'
                translate='no'
              >
                DevOne
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <ProjectSwitcherMenu projects={projects} />
      </SidebarHeader>
      <SidebarContent className='overflow-x-hidden'>
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.label || 'ungrouped'} className='py-0'>
            {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = item.icon ? Icons[item.icon] : Icons.logo;
                const href = hrefFor(item.url);
                const isDashboard = item.url === '/dashboard/overview';
                const title = isDashboard ? t('nav.dashboard') : titleOf(item.url, item.title);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      render={<Link href={href} aria-label={title} />}
                      tooltip={title}
                      isActive={
                        isDashboard
                          ? pathname === href
                          : [item.url, ...(item.activeFor ?? [])].some((url) => {
                              const target = hrefFor(url);
                              return pathname === target || pathname.startsWith(`${target}/`);
                            })
                      }
                    >
                      <Icon aria-hidden='true' />
                      <span>{title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
