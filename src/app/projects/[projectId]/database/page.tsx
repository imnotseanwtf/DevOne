import { Icons } from '@/components/icons';
import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { AddConnectionDialog } from '@/features/database/components/add-connection-dialog';
import { CollapsibleSidebar } from '@/features/database/components/collapsible-sidebar';
import { DatabaseBrowser } from '@/features/database/components/database-browser';
import { DeleteConnectionButton } from '@/features/database/components/delete-connection-button';
import { EditConnectionDialog } from '@/features/database/components/edit-connection-dialog';
import { ErdViewer } from '@/features/database/components/erd-viewer';
import { ConnectionStatus } from '@/features/database/components/connection-status';
import { ScanSchemaButton } from '@/features/database/components/scan-schema-button';
import { SetDefaultDatabaseButton } from '@/features/database/components/set-default-database-button';
import { SqlEditor } from '@/features/database/components/sql-editor';
import { TableExplorer } from '@/features/database/components/table-explorer';
import {
  getLatestSchema,
  getLiveSchema,
  listConnectionsForProject,
  listSavedQueries,
  listSchemaHistory
} from '@/features/database/service';
import { listProjectsForUser } from '@/features/projects/service';
import { listResources } from '@/features/resources/service';
import type { ConnectionResourceOption } from '@/features/database/components/connection-form';
import { requireUser } from '@/lib/auth/session';
import type { Table } from '@/lib/database/types';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSearchParamsCache, parseAsString, parseAsStringEnum } from 'nuqs/server';

export const metadata: Metadata = { title: 'Database' };

/**
 * The default database's tables come from the stored schema snapshot; any
 * other database is browsed live, since only the default gets scanned and
 * tracked. A live read failure (bad network, dropped privileges) degrades to
 * an empty table list rather than crashing the page.
 */
async function loadTables(
  userId: string,
  connectionId: string,
  database: string,
  isDefaultDatabase: boolean
): Promise<Table[]> {
  if (isDefaultDatabase) {
    return (await getLatestSchema(userId, connectionId))?.tables ?? [];
  }
  try {
    return (await getLiveSchema(userId, connectionId, database)).tables;
  } catch {
    return [];
  }
}

/** Table name -> column names, plus `schema.table` for disambiguation. */
function schemaForCompletion(tables: Table[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const table of tables) {
    const columns = table.columns.map((column) => column.name);
    map[table.name] = columns;
    map[`${table.schema}.${table.name}`] = columns;
  }
  return map;
}

const VIEWS = [
  { id: 'tables', label: 'Tables', icon: Icons.table },
  { id: 'sql', label: 'SQL editor', icon: Icons.code },
  { id: 'history', label: 'History', icon: Icons.clock },
  { id: 'erd', label: 'ERD', icon: Icons.galleryVerticalEnd }
] as const;

const databaseSearchParams = createSearchParamsCache({
  connection: parseAsString,
  view: parseAsStringEnum(VIEWS.map((entry) => entry.id)).withDefault('tables'),
  table: parseAsString,
  database: parseAsString
});

const dateFormat = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

interface DatabasePageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DatabasePage({ params, searchParams }: DatabasePageProps) {
  const user = await requireUser();
  const { projectId } = await params;
  const {
    connection,
    view,
    table,
    database: databaseParam
  } = await databaseSearchParams.parse(searchParams);

  const projects = await listProjectsForUser(user.id);
  const activeProject = projects.find((entry) => entry.id === projectId);
  if (!activeProject) notFound();

  const [connections, resources] = await Promise.all([
    listConnectionsForProject(user.id, activeProject.id),
    listResources(user.id, activeProject.id)
  ]);
  const active = connections.find((entry) => entry.id === connection);
  const resourceOptions = resources.map(({ id, name, environment }) => ({ id, name, environment }));
  const resourceName = (id: string | null) =>
    resources.find((resource) => resource.id === id)?.name;

  const base = `/projects/${activeProject.id}/database`;
  // Picking a connection card lands on its database list first - there is no
  // auto-jump to a "default" database, even if one is set. A database is only
  // ever browsed after being explicitly picked from the sidebar.
  const database = databaseParam;
  const isDefaultDatabase = !!database && database === active?.databaseName;

  if (connections.length === 0) {
    return (
      <Shell projectId={activeProject.id} resources={resourceOptions} showAddAction={false}>
        <Empty className='bg-card min-h-96 border'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Icons.database aria-hidden='true' />
            </EmptyMedia>
            <EmptyTitle>No databases connected</EmptyTitle>
            <EmptyDescription>
              Connect to a Postgres or MySQL server to browse tables, run SQL, and generate an ERD.
            </EmptyDescription>
          </EmptyHeader>
          <AddConnectionDialog
            projectId={activeProject.id}
            resources={resourceOptions}
            variant='empty'
          />
        </Empty>
      </Shell>
    );
  }

  if (!active) {
    return (
      <Shell projectId={activeProject.id} resources={resourceOptions} showAddAction>
        <ul className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
          {connections.map((entry) => (
            <li key={entry.id}>
              <Card className='hover:border-foreground/20 relative h-full transition-colors'>
                <CardHeader className='flex-row items-start justify-between gap-3'>
                  <div className='min-w-0 space-y-1'>
                    <CardTitle className='flex items-center gap-2'>
                      <Icons.database className='text-muted-foreground size-4 shrink-0' />
                      <Link
                        href={`${base}?connection=${entry.id}`}
                        className='truncate after:absolute after:inset-0 after:rounded-xl'
                      >
                        {entry.name}
                      </Link>
                    </CardTitle>
                    <CardDescription className='flex items-center gap-1.5 font-mono text-xs'>
                      <Icons.server className='size-3 shrink-0' />
                      <span className='truncate'>
                        {entry.username}@{entry.host}:{entry.port}
                      </span>
                    </CardDescription>
                  </div>
                  <div className='relative z-10 flex shrink-0 items-center'>
                    <EditConnectionDialog connection={entry} resources={resourceOptions} />
                    <DeleteConnectionButton connectionId={entry.id} connectionName={entry.name} />
                  </div>
                </CardHeader>
                <CardContent className='flex flex-wrap items-center gap-2'>
                  <ConnectionStatus connectionId={entry.id} className='mb-1 w-full' />
                  <Badge variant='outline'>
                    {entry.provider === 'POSTGRES' ? 'PostgreSQL' : 'MySQL'}
                  </Badge>
                  <Badge variant={entry.readOnly ? 'secondary' : 'destructive'}>
                    {entry.readOnly ? 'Read-only' : 'Writes allowed'}
                  </Badge>
                  <ResourceBadge
                    projectId={activeProject.id}
                    name={resourceName(entry.resourceId)}
                  />
                  {entry.databaseName && (
                    <span className='text-muted-foreground ml-auto truncate text-xs'>
                      default: {entry.databaseName}
                    </span>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </Shell>
    );
  }

  return (
    <Shell projectId={activeProject.id} resources={resourceOptions} showAddAction>
      <div className='flex flex-col gap-4 lg:flex-row lg:items-start'>
        <CollapsibleSidebar label='Databases' storageKey='devone:database-sidebar-collapsed'>
          <Link
            href={base}
            className='text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1.5 px-1 text-xs'
          >
            <Icons.chevronLeft className='size-3.5' />
            All connections
          </Link>
          <DatabaseBrowser
            connectionId={active.id}
            base={base}
            defaultDatabase={active.databaseName}
            currentDatabase={database ?? null}
          />
        </CollapsibleSidebar>

        <Card className='min-w-0 flex-1'>
          <CardHeader className='flex-row flex-wrap items-center justify-between gap-3'>
            <div className='min-w-0'>
              <CardTitle className='flex items-center gap-2'>
                <Icons.database className='text-muted-foreground size-4' />
                {active.name}
              </CardTitle>
              <p className='text-muted-foreground mt-1 flex items-center gap-1.5 font-mono text-xs'>
                <Icons.server className='size-3' />
                {active.username}@{active.host}:{active.port}
              </p>
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              {database && database !== active.databaseName && (
                <SetDefaultDatabaseButton connectionId={active.id} database={database} />
              )}
              <ConnectionStatus connectionId={active.id} />
              <EditConnectionDialog connection={active} resources={resourceOptions} />
              {isDefaultDatabase && <ScanSchemaButton connectionId={active.id} />}
              <Badge variant='outline'>
                {active.provider === 'POSTGRES' ? 'PostgreSQL' : 'MySQL'}
              </Badge>
              <Badge variant={active.readOnly ? 'secondary' : 'destructive'}>
                {active.readOnly ? 'Read-only' : 'Writes allowed'}
              </Badge>
              <ResourceBadge projectId={activeProject.id} name={resourceName(active.resourceId)} />
            </div>
          </CardHeader>
          <CardContent className='space-y-4'>
            {!database ? (
              <Empty className='min-h-64 border border-dashed'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <Icons.database aria-hidden='true' />
                  </EmptyMedia>
                  <EmptyTitle>Pick a database</EmptyTitle>
                  <EmptyDescription>
                    Choose a database from the list to browse its tables, run SQL, and view schema
                    history.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                <div className='flex flex-wrap items-center justify-between gap-3 border-b'>
                  <nav aria-label='Database views' className='flex items-center gap-1'>
                    {VIEWS.map((entry) => {
                      const disabled = entry.id === 'history' && !isDefaultDatabase;
                      return disabled ? (
                        <span
                          key={entry.id}
                          title='Only tracked for the default database'
                          className='text-muted-foreground/50 flex cursor-not-allowed items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm'
                        >
                          <entry.icon className='size-3.5' />
                          {entry.label}
                        </span>
                      ) : (
                        <Link
                          key={entry.id}
                          // Keeps the selected table, so the ERD opens focused on it and back.
                          href={`${base}?connection=${active.id}&database=${encodeURIComponent(database)}&view=${entry.id}${table ? `&table=${encodeURIComponent(table)}` : ''}`}
                          aria-current={entry.id === view ? 'page' : undefined}
                          className='text-muted-foreground hover:text-foreground -mb-px flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm aria-[current=page]:border-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground'
                        >
                          <entry.icon className='size-3.5' />
                          {entry.label}
                        </Link>
                      );
                    })}
                  </nav>
                </div>

                {isDefaultDatabase ? (
                  <p className='text-muted-foreground flex items-center gap-1.5 text-xs'>
                    <Icons.refresh className='size-3' />
                    Schema last scanned:{' '}
                    {active.lastScannedAt ? dateFormat.format(active.lastScannedAt) : 'never'}
                  </p>
                ) : (
                  <p className='text-muted-foreground flex items-center gap-1.5 text-xs'>
                    <Icons.eyeOff className='size-3' />
                    Live view of &ldquo;{database}&rdquo; — not scanned or tracked. Use &ldquo;Set
                    as default&rdquo; to enable that.
                  </p>
                )}

                {view === 'sql' ? (
                  <SqlEditor
                    connectionId={active.id}
                    database={isDefaultDatabase ? undefined : database}
                    provider={active.provider}
                    readOnly={active.readOnly}
                    schema={schemaForCompletion(
                      await loadTables(user.id, active.id, database, isDefaultDatabase)
                    )}
                    savedQueries={(await listSavedQueries(user.id, active.id)).map((query) => ({
                      id: query.id,
                      name: query.name,
                      sql: query.sql
                    }))}
                  />
                ) : view === 'history' ? (
                  <SchemaHistory userId={user.id} connectionId={active.id} />
                ) : view === 'erd' ? (
                  <ErdViewer
                    schema={{
                      tables: await loadTables(user.id, active.id, database, isDefaultDatabase)
                    }}
                    provider={active.provider === 'POSTGRES' ? 'PostgreSQL' : 'MySQL'}
                    connectionName={`${active.name}-${database}`}
                  />
                ) : (
                  <TableExplorer
                    tables={await loadTables(user.id, active.id, database, isDefaultDatabase)}
                    connectionId={active.id}
                    database={isDefaultDatabase ? undefined : database}
                    provider={active.provider}
                    readOnly={active.readOnly}
                  />
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

/** The resource (environment) a connection belongs to, linking to its card. */
function ResourceBadge({ projectId, name }: { projectId: string; name: string | undefined }) {
  if (!name) return null;
  return (
    <Link href={`/projects/${projectId}/resources`} className='relative z-10'>
      <Badge variant='outline' className='gap-1'>
        <Icons.server className='size-3' />
        {name}
      </Badge>
    </Link>
  );
}

function Shell({
  projectId,
  resources,
  showAddAction,
  children
}: {
  projectId: string;
  resources: ConnectionResourceOption[];
  showAddAction: boolean;
  children: React.ReactNode;
}) {
  return (
    <PageContainer
      pageTitle='Database'
      pageDescription='Browse connected databases, tables, queries, and schema history.'
      pageHeaderAction={
        showAddAction ? (
          <AddConnectionDialog projectId={projectId} resources={resources} />
        ) : undefined
      }
    >
      <div className='space-y-6'>{children}</div>
    </PageContainer>
  );
}

async function SchemaHistory({ userId, connectionId }: { userId: string; connectionId: string }) {
  const history = await listSchemaHistory(userId, connectionId);
  if (history.length === 0) {
    return (
      <p className='text-muted-foreground flex items-center gap-1.5 text-sm'>
        <Icons.clock className='size-4' />
        No snapshots yet — scan the schema to start tracking changes.
      </p>
    );
  }

  return (
    <ul className='divide-border divide-y text-sm'>
      {history.map((snapshot, index) => (
        <li key={snapshot.id} className='flex items-center justify-between gap-4 py-2'>
          <Badge variant='outline'>v{history.length - index}</Badge>
          <code className='text-muted-foreground text-xs'>{snapshot.contentHash.slice(0, 12)}</code>
          <span className='text-muted-foreground flex items-center gap-1.5 text-xs'>
            <Icons.clock className='size-3' />
            {dateFormat.format(snapshot.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
