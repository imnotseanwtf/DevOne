import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getConnectionProvider,
  getSnapshotPair,
  listConnectionsForProject,
  listSchemaHistory
} from '@/features/database/service';
import { listProjectsForUser } from '@/features/projects/service';
import { requireUser } from '@/lib/auth/session';
import { diffSchemas, isEmptyDiff, summarizeDiff } from '@/lib/database/diff';
import { generateMigrationSql } from '@/lib/database/migration';
import type { DatabaseProviderName } from '@/lib/database/types';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSearchParamsCache, parseAsString } from 'nuqs/server';

export const metadata: Metadata = { title: 'Schema diff' };

const diffSearchParams = createSearchParamsCache({
  connection: parseAsString,
  from: parseAsString,
  to: parseAsString
});

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

interface DiffPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SchemaDiffPage({ params, searchParams }: DiffPageProps) {
  const user = await requireUser();
  const { projectId } = await params;
  const { connection, from, to } = await diffSearchParams.parse(searchParams);

  const projects = await listProjectsForUser(user.id);
  const activeProject = projects.find((entry) => entry.id === projectId);
  if (!activeProject) notFound();

  const connections = await listConnectionsForProject(user.id, activeProject.id);
  const active = connections.find((entry) => entry.id === connection) ?? connections[0];
  if (!active) {
    return (
      <Shell>
        <Muted>Connect a database first.</Muted>
      </Shell>
    );
  }

  const history = await listSchemaHistory(user.id, active.id);
  if (history.length < 2) {
    return (
      <Shell>
        <ConnectionNav
          connections={connections}
          activeId={active.id}
          projectId={activeProject.id}
        />
        <Muted>
          Only {history.length} snapshot recorded. A diff needs two, so rescan after the schema
          changes.
        </Muted>
      </Shell>
    );
  }

  // History is newest-first, so compare the previous snapshot with the latest by default.
  const toSnapshot = to ?? history[0].id;
  const fromSnapshot = from ?? history[1].id;
  const pair = await getSnapshotPair(user.id, active.id, fromSnapshot, toSnapshot);
  const provider = (await getConnectionProvider(user.id, active.id)) as DatabaseProviderName;

  const diff = diffSchemas(pair.from.schema, pair.to.schema);
  const lines = summarizeDiff(diff);
  const sql = generateMigrationSql(diff, provider);

  return (
    <Shell>
      <ConnectionNav connections={connections} activeId={active.id} projectId={activeProject.id} />

      <div className='flex flex-wrap items-center gap-2 text-sm'>
        <span className='text-muted-foreground'>Comparing</span>
        <Badge variant='outline'>{dateFormat.format(pair.from.createdAt)}</Badge>
        <span aria-hidden='true'>→</span>
        <Badge variant='outline'>{dateFormat.format(pair.to.createdAt)}</Badge>
      </div>

      <div className='grid gap-6 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>Schema changes</CardTitle>
          </CardHeader>
          <CardContent>
            {isEmptyDiff(diff) ? (
              <Muted>No differences between these snapshots.</Muted>
            ) : (
              <ul className='space-y-1 font-mono text-xs'>
                {lines.map((line) => (
                  <li key={line} className={lineClass(line)}>
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Generated migration</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className='bg-muted max-h-[28rem] overflow-auto rounded-lg p-4 text-xs'>
              <code>{sql}</code>
            </pre>
            <p className='text-muted-foreground mt-2 text-xs'>
              Review before running. Destructive statements are emitted commented out.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Snapshots</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className='divide-border divide-y text-sm'>
            {history.map((snapshot, index) => (
              <li key={snapshot.id} className='flex flex-wrap items-center gap-3 py-2'>
                <span className='font-medium'>v{history.length - index}</span>
                <code className='text-muted-foreground text-xs'>
                  {snapshot.contentHash.slice(0, 12)}
                </code>
                <span className='text-muted-foreground text-xs'>
                  {dateFormat.format(snapshot.createdAt)}
                </span>
                <span className='ml-auto flex gap-3'>
                  <Link
                    href={`/projects/${activeProject.id}/schema-diff?connection=${active.id}&from=${snapshot.id}&to=${toSnapshot}`}
                    className='text-xs underline-offset-4 hover:underline'
                  >
                    Use as before
                  </Link>
                  <Link
                    href={`/projects/${activeProject.id}/schema-diff?connection=${active.id}&from=${fromSnapshot}&to=${snapshot.id}`}
                    className='text-xs underline-offset-4 hover:underline'
                  >
                    Use as after
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </Shell>
  );
}

function lineClass(line: string): string {
  if (line.startsWith('+')) return 'text-emerald-600 dark:text-emerald-400';
  if (line.startsWith('-')) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

function ConnectionNav({
  connections,
  activeId,
  projectId
}: {
  connections: { id: string; name: string }[];
  activeId: string;
  projectId: string;
}) {
  return (
    <nav aria-label='Connections' className='flex flex-wrap gap-2'>
      {connections.map((entry) => (
        <Link key={entry.id} href={`/projects/${projectId}/schema-diff?connection=${entry.id}`}>
          <Badge variant={entry.id === activeId ? 'default' : 'outline'}>{entry.name}</Badge>
        </Link>
      ))}
    </nav>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer
      pageTitle='Schema diff'
      pageDescription='Compare schema snapshots and generate the migration between them.'
    >
      <div className='space-y-6'>{children}</div>
    </PageContainer>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className='text-muted-foreground text-sm'>{children}</p>;
}
