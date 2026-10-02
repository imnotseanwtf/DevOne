'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Icons } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from '@/components/ui/sidebar';
import {
  linkRepositoryToNewProjectAction,
  listAllProviderRepositoriesAction
} from '@/features/git/actions';
import type { LinkableRepository } from '@/features/git/components/link-repository-form';
import { RepositoryPicker, suggestProjectName } from '@/features/git/components/repository-picker';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState, useTransition, type TransitionStartFunction } from 'react';

export interface FabProject {
  id: string;
  name: string;
  issuePrefix: string;
  memberCount: number;
}

/** Stays inside the current module when one is open; otherwise lands on issues. */
function projectPath(pathname: string, projectId: string): string {
  const match = pathname.match(/^\/projects\/[^/]+(\/.*)?$/);
  if (match) return `/projects/${projectId}${match[1] ?? ''}`;
  return `/projects/${projectId}`;
}

export function ProjectSwitcherMenu({ projects }: { projects: FabProject[] }) {
  return (
    <Suspense>
      <MenuInner projects={projects} />
    </Suspense>
  );
}

function MenuInner({ projects }: { projects: FabProject[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const { isMobile } = useSidebar();
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pending, startTransition] = useTransition();
  // Pending until the next project's page has rendered.
  const [switching, startSwitch] = useTransition();

  const routeProjectId = typeof params.projectId === 'string' ? params.projectId : null;
  const active = projects.find((project) => project.id === routeProjectId) ?? null;

  function goToProject(projectId: string) {
    startSwitch(() => router.push(projectPath(pathname, projectId)));
  }

  const visible = projects.filter((project) =>
    project.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <>
      <div className='pb-2'>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size='lg'
                    tooltip={active?.name ?? 'Select a project'}
                    className='data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground'
                  />
                }
              >
                <span
                  aria-busy={switching}
                  className='bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold uppercase'
                >
                  {active?.name.slice(0, 1) ?? '+'}
                </span>
                <span className='grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden'>
                  <span className='truncate font-semibold'>
                    {active?.name ?? 'Select a project'}
                  </span>
                  <span className='text-muted-foreground truncate text-xs'>
                    {switching ? 'Switching…' : 'Project'}
                  </span>
                </span>
                <Icons.chevronsUpDown
                  aria-hidden='true'
                  className='ml-auto size-4 group-data-[collapsible=icon]:hidden'
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className='w-(--anchor-width) min-w-56 rounded-lg'
                side={isMobile ? 'top' : 'right'}
                align='end'
                sideOffset={4}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Projects</DropdownMenuLabel>
                </DropdownMenuGroup>
                <div className='px-1 pb-1'>
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder='Search projects…'
                    aria-label='Search projects'
                  />
                </div>
                {visible.length === 0 ? (
                  <p className='text-muted-foreground px-2 py-2 text-sm'>No projects found.</p>
                ) : (
                  visible.map((project) => (
                    <DropdownMenuItem key={project.id} onClick={() => goToProject(project.id)}>
                      <Icons.workspace aria-hidden='true' />
                      <span className='truncate'>{project.name}</span>
                      {active?.id === project.id && <Icons.check className='ml-auto' />}
                    </DropdownMenuItem>
                  ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                  <Icons.add aria-hidden='true' />
                  Create project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </div>

      {createOpen && (
        <Dialog open onOpenChange={(next) => !next && setCreateOpen(false)}>
          <DialogContent className='max-h-[85svh] overflow-y-auto sm:max-w-md'>
            <DialogHeader>
              <DialogTitle>Create project</DialogTitle>
              <DialogDescription>Link a repository to start a new project.</DialogDescription>
            </DialogHeader>

            <div className='space-y-4'>
              <StartFromRepo
                pending={pending}
                startTransition={startTransition}
                onCreated={(projectId) => {
                  setCreateOpen(false);
                  router.push(projectPath(pathname, projectId));
                  router.refresh();
                }}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function StartFromRepo({
  pending,
  startTransition,
  onCreated
}: {
  pending: boolean;
  startTransition: TransitionStartFunction;
  onCreated: (projectId: string) => void;
}) {
  const [repos, setRepos] = useState<LinkableRepository[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      const result = await listAllProviderRepositoriesAction();
      if (cancelled) return;
      if (result.ok) {
        setRepos(result.repositories);
        setSelected((current) => {
          if (current) return current;
          const first = result.repositories[0];
          return first ? `${first.connectionId}:${first.providerRepositoryId}` : '';
        });
      } else {
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [startTransition]);

  if (failed) return null;

  const active = repos?.find(
    (repository) => `${repository.connectionId}:${repository.providerRepositoryId}` === selected
  );
  const suggestion = suggestProjectName(active?.fullName ?? '');

  return (
    <div className='space-y-3 border-t pt-4'>
      <p className='text-xs font-semibold tracking-wide uppercase'>Start from a repository</p>
      {!repos ? (
        <p className='text-muted-foreground text-sm'>Loading repositories…</p>
      ) : repos.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          No repositories reachable. Sign in with a token that can see one.
        </p>
      ) : (
        <form
          className='space-y-3'
          onSubmit={(event) => {
            event.preventDefault();
            setError(undefined);
            const [connectionId, ...rest] = selected.split(':');
            const projectName = (touched ? name : name || suggestion).trim();
            startTransition(async () => {
              const result = await linkRepositoryToNewProjectAction({
                connectionId,
                providerRepositoryId: rest.join(':'),
                projectName: projectName || undefined
              });
              if (!result.ok || !result.projectId) {
                setError(result.error ?? 'Could not create the project');
                return;
              }
              onCreated(result.projectId);
            });
          }}
        >
          <RepositoryPicker
            repositories={repos}
            value={selected}
            onChange={(next) => {
              setSelected(next);
              if (!touched) setName('');
            }}
            disabled={pending}
            placeholder='Search repositories…'
          />
          <div className='space-y-2'>
            <Label htmlFor='fab-project-name'>Project name</Label>
            <Input
              id='fab-project-name'
              value={touched ? name : name || suggestion}
              onChange={(event) => {
                setTouched(true);
                setName(event.target.value);
              }}
              maxLength={80}
              minLength={2}
              required
              autoComplete='off'
              disabled={pending}
            />
          </div>
          {error && (
            <Alert variant='destructive'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type='submit' disabled={pending} className='w-full'>
            {pending ? 'Creating…' : 'Create project & link'}
          </Button>
        </form>
      )}
    </div>
  );
}
