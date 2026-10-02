import PageContainer from '@/components/layout/page-container';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { DrawingWorkspace } from '@/features/drawings/components/drawing-workspace';
import { DrawingsSidebar } from '@/features/drawings/components/drawings-sidebar';
import { ImportDrawingButton } from '@/features/drawings/components/import-drawing-dialog';
import { NewDrawingButton } from '@/features/drawings/components/new-drawing-button';
import {
  getDrawing,
  listDrawingFolders,
  listDrawings,
  loadExcalidrawScene
} from '@/features/drawings/service';
import { listIssuesForLinking } from '@/features/platform/service';
import { ProjectWorkTabs } from '@/features/projects/components/project-work-tabs';
import { listProjectsForUser } from '@/features/projects/service';
import { requireUser } from '@/lib/auth/session';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createSearchParamsCache, parseAsString } from 'nuqs/server';

export const metadata: Metadata = { title: 'Drawings' };

const drawingsSearchParams = createSearchParamsCache({ drawing: parseAsString });

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

interface DrawingsPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DrawingsPage({ params, searchParams }: DrawingsPageProps) {
  const user = await requireUser();
  const { projectId } = await params;
  const { drawing: requested } = await drawingsSearchParams.parse(searchParams);

  const projects = await listProjectsForUser(user.id);
  const project = projects.find((entry) => entry.id === projectId);
  if (!project) notFound();

  const drawings = await listDrawings(user.id, project.id);
  const selectedId = requested ?? drawings[0]?.id;
  const [active, availableIssues, folders] = await Promise.all([
    selectedId ? getDrawing(user.id, project.id, selectedId) : null,
    listIssuesForLinking(user.id, project.id),
    listDrawingFolders(user.id, project.id)
  ]);

  return (
    <PageContainer
      pageTitle='Drawings'
      pageDescription='Sketch flows, architecture and ideas, and link them to tasks.'
    >
      <div className='space-y-6'>
        <ProjectWorkTabs projectId={project.id} active='drawings' />
        <div className='grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]'>
          <Collapsible
            defaultOpen
            render={
              <Card className='group/collapsible w-full self-start lg:w-12 lg:data-open:w-72' />
            }
          >
            <CardHeader>
              <CollapsibleTrigger
                render={<Button variant='ghost' className='-m-2 justify-between p-2' />}
              >
                <CardTitle className='lg:hidden lg:group-data-open/collapsible:block'>
                  Drawings ({drawings.length})
                </CardTitle>
                <Icons.chevronRight className='transition-transform group-data-open/collapsible:rotate-180' />
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <CardContent>
                <DrawingsSidebar
                  projectId={project.id}
                  activeId={active?.id}
                  folders={folders}
                  items={drawings.map((drawing) => ({
                    id: drawing.id,
                    title: drawing.title,
                    kind: drawing.kind,
                    folder: drawing.folder,
                    href: `/projects/${project.id}/drawings?drawing=${drawing.id}`,
                    meta: dateFormat.format(drawing.updatedAt)
                  }))}
                />
              </CardContent>
            </CollapsibleContent>
          </Collapsible>

          {active ? (
            <DrawingWorkspace
              key={active.id}
              projectId={project.id}
              drawingId={active.id}
              initialTitle={active.title}
              kind={active.kind}
              scene={active.scene}
              live={active.live}
              initialScene={
                active.kind === 'EXCALIDRAW' && !active.liveRoom
                  ? await loadExcalidrawScene(user.id, project.id, active.id)
                  : null
              }
              liveRoom={active.liveRoom}
              linkedIssues={active.issueLinks.map((link) => link.issue)}
              availableIssues={availableIssues}
            />
          ) : (
            <Empty className='border'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Icons.drawing aria-hidden='true' />
                </EmptyMedia>
                <EmptyTitle>{requested ? 'Drawing not found' : 'No drawings yet'}</EmptyTitle>
                <EmptyDescription>
                  Sketch together live with Excalidraw or build precise diagrams with draw.io, then
                  link them to tasks.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent className='flex-row flex-wrap justify-center gap-2'>
                <NewDrawingButton projectId={project.id} kind='EXCALIDRAW' live />
                <NewDrawingButton projectId={project.id} kind='EXCALIDRAW' variant='outline' />
                <NewDrawingButton projectId={project.id} kind='DRAWIO' variant='outline' />
                <ImportDrawingButton projectId={project.id} />
              </EmptyContent>
            </Empty>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
