'use client';

import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table as DataTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { CollapsibleSidebar } from '@/features/database/components/collapsible-sidebar';
import { DataGrid } from '@/features/database/components/data-grid';
import { PendingChanges } from '@/features/database/components/pending-changes';
import { STICKY_TABLE_SCROLLER } from '@/features/database/components/sticky-table';
import {
  ColumnDialog,
  ForeignKeyDialog,
  IndexDialog
} from '@/features/database/components/schema-change-dialogs';
import {
  effectiveTable,
  stageChange,
  type PendingChange,
  type PendingStatus
} from '@/features/database/schema-changes';
import { cn } from '@/lib/utils';
import {
  qualifiedName,
  type DatabaseProviderName,
  type SchemaChange,
  type Table
} from '@/lib/database/types';
import { parseAsString, useQueryState } from 'nuqs';
import { useEffect, useMemo, useState } from 'react';

function StatusBadge({ status }: { status?: PendingStatus }) {
  if (!status) return null;
  return (
    <Badge
      variant={status === 'dropped' ? 'destructive' : 'outline'}
      className='border-primary/50 text-[10px]'
    >
      {status === 'added' ? 'new' : status === 'altered' ? 'edited' : 'drop'}
    </Badge>
  );
}

function DropButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type='button'
      variant='ghost'
      size='icon-sm'
      className='text-muted-foreground hover:text-destructive'
      aria-label={label}
      onClick={onClick}
    >
      <Icons.trash className='size-3.5' />
    </Button>
  );
}

export function TableExplorer({
  tables,
  connectionId,
  database,
  provider,
  readOnly
}: {
  tables: Table[];
  connectionId: string;
  database?: string;
  provider: DatabaseProviderName;
  readOnly: boolean;
}) {
  // The active tab lives in React state, mirrored to `?table=` for reloads,
  // shared links and the ERD view. It is deliberately not read back from the
  // URL: nuqs syncs the URL in a transition and can briefly report the
  // previous value, which flipped the panels old -> new for a frame (a blink).
  const [urlTable, setUrlTable] = useQueryState('table', parseAsString);
  const [selected, setSelectedState] = useState(urlTable);
  const setSelected = (name: string | null) => {
    setSelectedState(name);
    void setUrlTable(name);
  };
  const [search, setSearch] = useState('');
  const openTabs = useOpenTabs(connectionId, database, tables, selected);
  // Staged across tables, so one Execute can apply related edits together.
  const [pending, setPending] = useState<PendingChange[]>([]);
  const stage = (change: SchemaChange) => setPending((prev) => stageChange(prev, change));

  const grouped = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? tables.filter((table) => qualifiedName(table).toLowerCase().includes(term))
      : tables;

    const bySchema = new Map<string, Table[]>();
    for (const table of filtered) {
      const list = bySchema.get(table.schema) ?? [];
      list.push(table);
      bySchema.set(table.schema, list);
    }
    return bySchema;
  }, [tables, search]);

  const tableByName = useMemo(
    () => new Map(tables.map((table) => [qualifiedName(table), table])),
    [tables]
  );

  const openTable = (name: string) => {
    openTabs.add(name);
    setSelected(name);
  };

  const closeTable = (name: string) => {
    const remaining = openTabs.remove(name);
    if (name !== selected) return;
    // Like an editor: land on the tab to the right, else the one to the left.
    const index = openTabs.names.indexOf(name);
    setSelected(remaining[index] ?? remaining[index - 1] ?? null);
  };

  const closeOthers = (name: string) => {
    openTabs.keepOnly([name]);
    setSelected(name);
  };

  const closeToTheRight = (name: string) => {
    const keep = openTabs.names.slice(0, openTabs.names.indexOf(name) + 1);
    openTabs.keepOnly(keep);
    if (selected && !keep.includes(selected)) setSelected(name);
  };

  const closeAll = () => {
    openTabs.keepOnly([]);
    setSelected(null);
  };

  if (tables.length === 0) {
    return (
      <Empty className='min-h-64 border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.table aria-hidden='true' />
          </EmptyMedia>
          <EmptyTitle>No tables yet</EmptyTitle>
          <EmptyDescription>
            Rescan the schema to pick up tables from the database.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className='space-y-4'>
      {!readOnly && (
        <PendingChanges
          pending={pending}
          connectionId={connectionId}
          database={database}
          provider={provider}
          onRemove={(id) => setPending((prev) => prev.filter((entry) => entry.id !== id))}
          onDiscard={() => setPending([])}
          onApplied={(count) => setPending((prev) => prev.slice(count))}
        />
      )}
      <div className='flex flex-col gap-4 md:flex-row md:items-start'>
        <CollapsibleSidebar
          label='Tables'
          storageKey='devone:tables-sidebar-collapsed'
          expandedClassName='md:w-64'
        >
          <div className='space-y-2'>
            <div className='relative'>
              <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2' />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder='Find a table…'
                className='h-8 pl-8 text-sm'
                aria-label='Find a table'
              />
            </div>

            <div className='max-h-[28rem] space-y-3 overflow-auto pr-1'>
              {grouped.size === 0 && (
                <p className='text-muted-foreground px-1 text-xs'>
                  No tables match &ldquo;{search}&rdquo;.
                </p>
              )}
              {[...grouped.entries()].map(([schema, schemaTables]) => (
                <div key={schema}>
                  <p className='text-muted-foreground px-1 pb-1 text-xs font-medium tracking-wide uppercase'>
                    {schema}
                  </p>
                  <ul className='space-y-0.5'>
                    {schemaTables.map((table) => {
                      const name = qualifiedName(table);
                      const isActive = name === selected;
                      return (
                        <li key={name}>
                          <button
                            type='button'
                            onClick={() => openTable(name)}
                            aria-current={isActive ? 'true' : undefined}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted',
                              isActive && 'bg-muted font-medium'
                            )}
                          >
                            <Icons.table className='text-muted-foreground size-3.5 shrink-0' />
                            <span className='truncate'>{table.name}</span>
                            {pending.some(
                              ({ change }) =>
                                change.schema === table.schema && change.table === table.name
                            ) && (
                              <span
                                className='bg-primary ml-auto size-1.5 shrink-0 rounded-full'
                                title='Has pending changes'
                              />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </CollapsibleSidebar>

        <div className='min-w-0 flex-1 space-y-3'>
          {openTabs.names.length > 0 && (
            <div
              role='tablist'
              aria-label='Open tables'
              className='flex items-end gap-1 overflow-x-auto border-b'
            >
              {openTabs.names.map((name) => {
                const isActive = name === selected;
                const index = openTabs.names.indexOf(name);
                return (
                  <ContextMenu key={name}>
                    <ContextMenuTrigger
                      className={cn(
                        'group -mb-px flex shrink-0 items-center rounded-t-md border border-b-0 text-sm',
                        isActive
                          ? 'bg-background border-border'
                          : 'text-muted-foreground hover:text-foreground border-transparent'
                      )}
                    >
                      <button
                        type='button'
                        role='tab'
                        aria-selected={isActive}
                        title={name}
                        onClick={() => setSelected(name)}
                        // Middle-click closes, as in browsers and editors.
                        onAuxClick={(event) => event.button === 1 && closeTable(name)}
                        className='flex max-w-52 items-center gap-1.5 py-1.5 pl-3'
                      >
                        <Icons.table className='size-3.5 shrink-0' />
                        <span className='truncate'>{tableByName.get(name)?.name ?? name}</span>
                      </button>
                      <button
                        type='button'
                        aria-label={`Close ${name}`}
                        onClick={() => closeTable(name)}
                        className={cn(
                          'hover:bg-muted mx-1 rounded p-0.5',
                          !isActive && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                        )}
                      >
                        <Icons.close className='size-3' />
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent className='w-48'>
                      <ContextMenuItem onClick={() => closeTable(name)}>Close</ContextMenuItem>
                      <ContextMenuItem
                        disabled={openTabs.names.length < 2}
                        onClick={() => closeOthers(name)}
                      >
                        Close others
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={index === openTabs.names.length - 1}
                        onClick={() => closeToTheRight(name)}
                      >
                        Close to the right
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={closeAll}>Close all</ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      className='ml-auto mb-1 shrink-0'
                      aria-label='Tab actions'
                      title='Tab actions'
                    />
                  }
                >
                  <Icons.moreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-48'>
                  <DropdownMenuItem
                    disabled={!selected || openTabs.names.length < 2}
                    onClick={() => selected && closeOthers(selected)}
                  >
                    Close others
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!selected || openTabs.names.at(-1) === selected}
                    onClick={() => selected && closeToTheRight(selected)}
                  >
                    Close to the right
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant='destructive' onClick={closeAll}>
                    Close all tabs
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/*
            Every open tab stays mounted, so switching back never reloads its rows.
            Inactive tabs are made invisible rather than `display: none`: that
            keeps their layout, so the WHERE editor doesn't re-measure (flash)
            and the grid keeps its scroll position. They sit stacked under the
            active tab, clipped so they can't stretch the page.
          */}
          <div className='relative overflow-clip [overflow-clip-margin:4px]'>
            {openTabs.names.map((name) => {
              const table = tableByName.get(name);
              const isActive = name === selected;
              return table ? (
                <div
                  key={name}
                  role='tabpanel'
                  aria-hidden={!isActive}
                  inert={!isActive}
                  className={cn(!isActive && 'invisible absolute inset-x-0 top-0')}
                >
                  <TableDetail
                    table={table}
                    tables={tables}
                    pending={pending}
                    onStage={stage}
                    connectionId={connectionId}
                    database={database}
                    provider={provider}
                    readOnly={readOnly}
                  />
                </div>
              ) : null;
            })}
          </div>

          {!(selected && tableByName.has(selected)) && (
            <div className='text-muted-foreground flex min-h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm'>
              <Icons.table className='size-6' />
              Select a table to inspect its columns, indexes, and foreign keys.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The tables open as tabs. The list is kept in sessionStorage per database,
 * so the tabs survive a trip to the SQL editor or ERD and back; a table opened
 * some other way (a shared `?table=` link, the ERD focus) joins the list too.
 */
function useOpenTabs(
  connectionId: string,
  database: string | undefined,
  tables: Table[],
  selected: string | null
) {
  const storageKey = `devone:table-tabs:${connectionId}:${database ?? ''}`;
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    let stored: string[] = [];
    try {
      stored = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
    } catch {
      // Blocked or corrupt storage: start with no tabs.
    }
    const known = new Set(tables.map(qualifiedName));
    const restored = (Array.isArray(stored) ? stored : []).filter((name) => known.has(name));
    if (selected && known.has(selected) && !restored.includes(selected)) restored.push(selected);
    setNames(restored);
    // Only on mount / database change; later updates go through add/remove.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // A table dropped by a schema change closes its tab.
  useEffect(() => {
    const known = new Set(tables.map(qualifiedName));
    setNames((prev) =>
      prev.every((name) => known.has(name)) ? prev : prev.filter((name) => known.has(name))
    );
  }, [tables]);

  // A table selected from outside the list (e.g. the ERD's focus picker) gets a tab.
  useEffect(() => {
    if (!selected || !tables.some((table) => qualifiedName(table) === selected)) return;
    setNames((prev) => (prev.includes(selected) ? prev : [...prev, selected]));
  }, [selected, tables]);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(names));
    } catch {
      // Nothing to persist to; tabs still work until the page unloads.
    }
  }, [storageKey, names]);

  return {
    names,
    add: (name: string) => setNames((prev) => (prev.includes(name) ? prev : [...prev, name])),
    /** Keeps only `keep`, in their current order. */
    keepOnly: (keep: string[]) => setNames((prev) => prev.filter((name) => keep.includes(name))),
    /** Returns the tabs left open, for picking the next active one. */
    remove: (name: string) => {
      const remaining = names.filter((entry) => entry !== name);
      setNames(remaining);
      return remaining;
    }
  };
}

function TableDetail({
  table,
  tables,
  pending,
  onStage,
  connectionId,
  database,
  provider,
  readOnly
}: {
  table: Table;
  tables: Table[];
  pending: PendingChange[];
  onStage: (change: SchemaChange) => void;
  connectionId: string;
  database?: string;
  provider: DatabaseProviderName;
  readOnly: boolean;
}) {
  const view = useMemo(() => effectiveTable(table, pending), [table, pending]);
  const target = { schema: table.schema, table: table.name };
  const liveColumns = view.columns
    .filter((column) => column.status !== 'dropped')
    .map((column) => column.name);
  const columnsOf = (other: Table) =>
    effectiveTable(other, pending)
      .columns.filter((column) => column.status !== 'dropped')
      .map((column) => column.name);
  const editable = !readOnly;
  const [loadedRows, setLoadedRows] = useState<{ count: number; more: boolean } | null>(null);

  return (
    <div className='min-w-0 space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <h3 className='font-mono text-sm font-medium'>{qualifiedName(table)}</h3>
        <Badge variant='outline'>
          {table.columns.length} column{table.columns.length === 1 ? '' : 's'}
        </Badge>
        {table.primaryKeys.length > 0 && (
          <Badge variant='outline' className='gap-1'>
            <Icons.primaryKey className='size-3' />
            {table.primaryKeys.join(', ')}
          </Badge>
        )}
      </div>

      <Tabs defaultValue='data'>
        <TabsList variant='line'>
          <TabsTrigger value='data'>
            Data
            {loadedRows && ` (${loadedRows.count}${loadedRows.more ? '+' : ''})`}
          </TabsTrigger>
          <TabsTrigger value='columns'>Columns ({liveColumns.length})</TabsTrigger>
          <TabsTrigger value='indexes'>Indexes ({table.indexes.length})</TabsTrigger>
          <TabsTrigger value='foreignKeys'>Foreign keys ({table.foreignKeys.length})</TabsTrigger>
        </TabsList>

        <TabsContent value='data' className='mt-3'>
          <DataGrid
            onRowsLoaded={(count, more) => setLoadedRows({ count, more })}
            connectionId={connectionId}
            database={database}
            provider={provider}
            readOnly={readOnly}
            table={table}
          />
        </TabsContent>

        <TabsContent value='columns' className='mt-3 space-y-3'>
          {editable && (
            <div className='flex justify-end'>
              <ColumnDialog table={table} provider={provider} onStage={onStage} />
            </div>
          )}
          <div className={cn('max-h-[32rem] rounded-lg border', STICKY_TABLE_SCROLLER)}>
            <DataTable>
              <TableHeader className='bg-muted sticky top-0 z-10'>
                <TableRow>
                  <TableHead>Column</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Null</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Key</TableHead>
                  {editable && <TableHead className='w-20' />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.columns.map((column) => {
                  const dropped = column.status === 'dropped';
                  return (
                    <TableRow key={column.name} className={cn(dropped && 'opacity-60')}>
                      <TableCell className='font-medium'>
                        <span className='flex items-center gap-2'>
                          <span className={cn(dropped && 'line-through')}>{column.name}</span>
                          <StatusBadge status={column.status} />
                        </span>
                      </TableCell>
                      <TableCell className='text-muted-foreground font-mono text-xs'>
                        {column.dataType}
                      </TableCell>
                      <TableCell className='text-muted-foreground text-xs'>
                        {column.nullable ? 'yes' : 'no'}
                      </TableCell>
                      <TableCell className='text-muted-foreground font-mono text-xs'>
                        {column.defaultValue ?? '—'}
                      </TableCell>
                      <TableCell>
                        <div className='flex gap-1'>
                          {column.isPrimaryKey && (
                            <Badge variant='secondary' className='gap-1' title='Primary key'>
                              <Icons.primaryKey className='size-3' />
                              PK
                            </Badge>
                          )}
                          {view.foreignKeys.some((key) => key.columns.includes(column.name)) && (
                            <Badge variant='outline' className='gap-1' title='Foreign key'>
                              <Icons.foreignKey className='size-3' />
                              FK
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      {editable && (
                        <TableCell>
                          {!dropped && (
                            <div className='flex justify-end'>
                              <ColumnDialog
                                table={table}
                                column={column}
                                provider={provider}
                                onStage={onStage}
                              />
                              <DropButton
                                label={`Drop ${column.name}`}
                                onClick={() =>
                                  onStage({ kind: 'dropColumn', ...target, column: column.name })
                                }
                              />
                            </div>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </DataTable>
          </div>
        </TabsContent>

        <TabsContent value='indexes' className='mt-3 space-y-3'>
          {editable && (
            <div className='flex justify-end'>
              <IndexDialog table={table} columns={liveColumns} onStage={onStage} />
            </div>
          )}
          {view.indexes.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No indexes.</p>
          ) : (
            <div className={cn('max-h-[32rem] rounded-lg border', STICKY_TABLE_SCROLLER)}>
              <DataTable>
                <TableHeader className='bg-muted sticky top-0 z-10'>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Columns</TableHead>
                    <TableHead>Unique</TableHead>
                    {editable && <TableHead className='w-10' />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.indexes.map((index) => {
                    const dropped = index.status === 'dropped';
                    return (
                      <TableRow key={index.name} className={cn(dropped && 'opacity-60')}>
                        <TableCell className='font-medium'>
                          <span className='flex items-center gap-1.5'>
                            <Icons.index className='text-muted-foreground size-3.5' />
                            <span className={cn(dropped && 'line-through')}>{index.name}</span>
                            <StatusBadge status={index.status} />
                          </span>
                        </TableCell>
                        <TableCell className='text-muted-foreground font-mono text-xs'>
                          {index.columns.join(', ')}
                        </TableCell>
                        <TableCell className='text-muted-foreground text-xs'>
                          {index.unique ? 'yes' : 'no'}
                        </TableCell>
                        {editable && (
                          <TableCell>
                            {!dropped && (
                              <DropButton
                                label={`Drop index ${index.name}`}
                                onClick={() =>
                                  onStage({ kind: 'dropIndex', ...target, name: index.name })
                                }
                              />
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </DataTable>
            </div>
          )}
        </TabsContent>

        <TabsContent value='foreignKeys' className='mt-3 space-y-3'>
          {editable && (
            <div className='flex justify-end'>
              <ForeignKeyDialog
                table={table}
                columns={liveColumns}
                tables={tables}
                columnsOf={columnsOf}
                onStage={onStage}
              />
            </div>
          )}
          {view.foreignKeys.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No foreign keys.</p>
          ) : (
            <div className={cn('max-h-[32rem] rounded-lg border', STICKY_TABLE_SCROLLER)}>
              <DataTable>
                <TableHeader className='bg-muted sticky top-0 z-10'>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Columns</TableHead>
                    <TableHead>References</TableHead>
                    {editable && <TableHead className='w-10' />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.foreignKeys.map((key) => {
                    const dropped = key.status === 'dropped';
                    return (
                      <TableRow key={key.name} className={cn(dropped && 'opacity-60')}>
                        <TableCell className='font-medium'>
                          <span className='flex items-center gap-1.5'>
                            <Icons.foreignKey className='text-muted-foreground size-3.5' />
                            <span className={cn(dropped && 'line-through')}>{key.name}</span>
                            <StatusBadge status={key.status} />
                          </span>
                        </TableCell>
                        <TableCell className='text-muted-foreground font-mono text-xs'>
                          {key.columns.join(', ')}
                        </TableCell>
                        <TableCell className='text-muted-foreground font-mono text-xs'>
                          {key.referencedSchema}.{key.referencedTable} (
                          {key.referencedColumns.join(', ')})
                        </TableCell>
                        {editable && (
                          <TableCell>
                            {!dropped && (
                              <DropButton
                                label={`Drop foreign key ${key.name}`}
                                onClick={() =>
                                  onStage({ kind: 'dropForeignKey', ...target, name: key.name })
                                }
                              />
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </DataTable>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
