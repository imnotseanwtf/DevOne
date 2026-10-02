import PageContainer from '@/components/layout/page-container';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { DocEditor } from '@/features/platform/components/doc-editor';
import { DocsSidebar } from '@/features/platform/components/docs-sidebar';
import { NewDocButton } from '@/features/platform/components/new-doc-button';
import {
  getDoc,
  listDocFolders,
  listDocs,
  listIssuesForLinking,
  listLinkedIssues
} from '@/features/platform/service';
import { ProjectWorkTabs } from '@/features/projects/components/project-work-tabs';
import { listProjectsForUser } from '@/features/projects/service';
import { requireUser } from '@/lib/auth/session';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createSearchParamsCache, parseAsString } from 'nuqs/server';

export const metadata: Metadata = { title: 'Docs' };

const docsSearchParams = createSearchParamsCache({
  page: parseAsString
});

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

interface DocsPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DocsPage({ params, searchParams }: DocsPageProps) {
  const user = await requireUser();
  const { projectId } = await params;
  const { page } = await docsSearchParams.parse(searchParams);

  const projects = await listProjectsForUser(user.id);
  const activeProject = projects.find((entry) => entry.id === projectId);
  if (!activeProject) notFound();

  const docs = await listDocs(user.id, activeProject.id);
  const selectedSlug = page ?? docs[0]?.slug;
  const active = selectedSlug ? await getDoc(user.id, activeProject.id, selectedSlug) : null;
  const [availableIssues, folders] = await Promise.all([
    listIssuesForLinking(user.id, activeProject.id),
    listDocFolders(user.id, activeProject.id)
  ]);
  const linkedIssues = active ? await listLinkedIssues(user.id, activeProject.id, active.id) : [];

  return (
    <Shell>
      <ProjectWorkTabs projectId={activeProject.id} active='docs' />
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
                Pages ({docs.length})
              </CardTitle>
              <Icons.chevronRight className='transition-transform group-data-open/collapsible:rotate-180' />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              <DocsSidebar
                projectId={activeProject.id}
                activeId={active?.id}
                folders={folders}
                items={docs.map((doc) => ({
                  id: doc.id,
                  title: doc.title,
                  folder: doc.folder,
                  href: `/projects/${activeProject.id}/docs?page=${doc.slug}`,
                  meta: dateFormat.format(doc.updatedAt)
                }))}
              />
            </CardContent>
          </CollapsibleContent>
        </Collapsible>

        {active ? (
          <DocEditor
            key={active.id}
            docId={active.id}
            projectId={activeProject.id}
            initialTitle={active.title}
            initialBody={active.body}
            availableIssues={availableIssues}
            initialLinkedIssues={linkedIssues}
          />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{page ? 'Page not found' : 'No pages yet'}</EmptyTitle>
              <EmptyDescription>Select a page or create one to start writing.</EmptyDescription>
            </EmptyHeader>
            <NewDocButton projectId={activeProject.id} />
          </Empty>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer
      pageTitle='Docs'
      pageDescription='Keep architecture, API, database, and deployment documentation together.'
    >
      <div className='space-y-6'>{children}</div>
    </PageContainer>
  );
}
