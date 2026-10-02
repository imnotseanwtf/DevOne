import { Icons } from '@/components/icons';
import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { ErdViewer } from '@/features/database/components/erd-viewer';
import { getLatestSchema, listConnectionsForProject } from '@/features/database/service';
import { listProjectsForUser } from '@/features/projects/service';
import { requireUser } from '@/lib/auth/session';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSearchParamsCache, parseAsString } from 'nuqs/server';

export const metadata: Metadata = { title: 'ERD' };

const erdSearchParams = createSearchParamsCache({
  connection: parseAsString
});

interface ErdPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ErdPage({ params, searchParams }: ErdPageProps) {
  const user = await requireUser();
  const { projectId } = await params;
  const { connection } = await erdSearchParams.parse(searchParams);

  const projects = await listProjectsForUser(user.id);
  const activeProject = projects.find((entry) => entry.id === projectId);
  if (!activeProject) notFound();

  const connections = await listConnectionsForProject(user.id, activeProject.id);
  const active = connections.find((entry) => entry.id === connection) ?? connections[0];
  if (!active) return <Shell>{empty('Connect a database to generate its diagram.')}</Shell>;

  const schema = await getLatestSchema(user.id, active.id);
  if (!schema || schema.tables.length === 0) {
    return <Shell>{empty('No schema has been scanned for this connection yet.')}</Shell>;
  }

  return (
    <Shell>
      <nav aria-label='Connections' className='flex flex-wrap gap-2'>
        {connections.map((entry) => (
          <Link key={entry.id} href={`/projects/${activeProject.id}/erd?connection=${entry.id}`}>
            <Badge variant={entry.id === active.id ? 'default' : 'outline'}>{entry.name}</Badge>
          </Link>
        ))}
      </nav>

      <ErdViewer schema={schema} provider={active.provider} connectionName={active.name} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer
      pageTitle='ERD'
      pageDescription='Understand database structure through automatically generated diagrams.'
    >
      <div className='space-y-6'>{children}</div>
    </PageContainer>
  );
}

function empty(description: string) {
  return (
    <Empty className='bg-card min-h-80 border'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <Icons.galleryVerticalEnd aria-hidden='true' />
        </EmptyMedia>
        <EmptyTitle>Nothing to diagram yet</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
