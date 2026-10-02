'use client';

import { Icons } from '@/components/icons';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton
} from '@/components/ui/sidebar';
import { getProjectPanelInfoAction } from '@/features/projects/actions';
import type { ProjectPanelInfo } from '@/features/projects/service';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

/** Details of the project in the URL — nothing else shows here. */
export function ProjectPanel() {
  return (
    <Suspense>
      <PanelInner />
    </Suspense>
  );
}

function PanelInner() {
  const params = useParams();
  const projectId = typeof params.projectId === 'string' ? params.projectId : null;
  const [info, setInfo] = useState<ProjectPanelInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getProjectPanelInfoAction(projectId).then((result) => {
      if (cancelled) return;
      setInfo(result.ok ? result.info : null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!projectId) return null;

  if ((loading && !info) || (!info && loading)) {
    return (
      <SidebarGroup className='py-0'>
        <SidebarGroupLabel>Project</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {[0, 1, 2].map((index) => (
              <SidebarMenuItem key={index}>
                <SidebarMenuSkeleton />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (!info) return null;

  return (
    <SidebarGroup className='py-0'>
      <SidebarGroupLabel>
        <span className='truncate'>{info.name}</span>
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href={`/projects/${info.id}/issues`} aria-label='Open issues' />}
              tooltip='Open issues'
            >
              <Icons.kanban aria-hidden='true' />
              <span>Open issues</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>{info.openIssues}</SidebarMenuBadge>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href={`/projects/${info.id}/git`} aria-label='Repositories' />}
              tooltip='Repositories'
            >
              <Icons.github aria-hidden='true' />
              <span>Repositories</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>{info.repos.length}</SidebarMenuBadge>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href={`/projects/${info.id}/database`} aria-label='Databases' />}
              tooltip='Databases'
            >
              <Icons.product aria-hidden='true' />
              <span>Databases</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>{info.databaseCount}</SidebarMenuBadge>
          </SidebarMenuItem>
        </SidebarMenu>

        {info.repos.length > 0 && (
          <>
            <SidebarGroupLabel className='mt-2'>Linked repos</SidebarGroupLabel>
            <SidebarMenu>
              {info.repos.slice(0, 5).map((repository) => (
                <SidebarMenuItem key={repository.id}>
                  <SidebarMenuButton
                    render={
                      <Link
                        href={`/projects/${info.id}/git?repo=${repository.id}`}
                        title={repository.fullName}
                        aria-label={repository.fullName}
                      />
                    }
                    tooltip={repository.fullName}
                  >
                    <Icons.github aria-hidden='true' />
                    <span className='truncate'>{repository.fullName}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </>
        )}

        {info.members.length > 0 && (
          <>
            <SidebarGroupLabel className='mt-2'>Members</SidebarGroupLabel>
            <SidebarMenu>
              {info.members.slice(0, 5).map((member) => (
                <SidebarMenuItem key={member.userId}>
                  <div className='flex items-center gap-2 px-2 py-1 text-sm'>
                    <span className='bg-primary/10 text-primary flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase'>
                      {member.username.slice(0, 1)}
                    </span>
                    <span className='flex-1 truncate'>{member.username}</span>
                    <span className='text-muted-foreground text-[11px]'>{member.role}</span>
                  </div>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </>
        )}

        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href='/projects' aria-label='Manage projects' />}
              tooltip='Manage projects'
            >
              <Icons.settings aria-hidden='true' />
              <span>Manage projects</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
