'use client';

import { Icons } from '@/components/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table as DataTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { applyTableRowChangesAction, fetchTableRowsAction } from '@/features/database/actions';
import { ColumnFilterButton, describeFilter } from '@/features/database/components/column-filter';
import { DateTimePicker } from '@/features/database/components/date-time-picker';
import { SqlInput } from '@/features/database/components/sql-input';
import { STICKY_TABLE_SCROLLER } from '@/features/database/components/sticky-table';
import { valueKindOf, type ColumnFilter } from '@/lib/database/column-filters';
import { renderRowStatement, type RowChange } from '@/lib/database/row-changes';
import type { DatabaseProviderName, RowValues, Table } from '@/lib/database/types';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useState, useTransition } from 'react';

const PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

function isBooleanColumn(dataType: string): boolean {
  return dataType.toLowerCase().includes('bool');
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function DataGrid({
  connectionId,
  database,
  provider,
  readOnly,
  table,
  onRowsLoaded
}: {
  /** Rows loaded so far (through the current page) and whether more exist. */
  onRowsLoaded?: (count: number, hasMore: boolean) => void;
  connectionId: string;
  database?: string;
  provider: DatabaseProviderName;
  readOnly: boolean;
  table: Table;
}) {
  const tableKey = `${table.schema}.${table.name}`;
  const hasPk = table.primaryKeys.length > 0;
  const canEdit = !readOnly && hasPk;
  const canInsert = !readOnly;

  const columnNames = useMemo(() => table.columns.map((c) => c.name), [table]);

  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [filterInput, setFilterInput] = useState('');
  const [filter, setFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [columnFilters, setColumnFilters] = useState<ColumnFilter[]>([]);
  const columnMetaByName = useMemo(
    () => new Map(table.columns.map((column) => [column.name, column])),
    [table]
  );
  const [error, setError] = useState<string>();
  const [loading, startLoading] = useTransition();

  const [editing, setEditing] = useState<{ row: number; column: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  const [newRow, setNewRow] = useState<Record<string, string>>();

  // Edits wait here until "Execute": keyed by each row's primary key, so they
  // survive paging, searching and refreshing.
  const [updates, setUpdates] = useState<Record<string, { where: RowValues; values: RowValues }>>(
    {}
  );
  const [deletes, setDeletes] = useState<Record<string, RowValues>>({});
  const [inserts, setInserts] = useState<{ id: number; values: RowValues }[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewError, setReviewError] = useState<string>();
  const [executing, startExecuting] = useTransition();

  const stagedChanges = useMemo<RowChange[]>(
    () => [
      ...inserts.map(({ values }) => ({ kind: 'insert' as const, values })),
      ...Object.entries(updates)
        .filter(([key]) => !(key in deletes))
        .map(([, { where, values }]) => ({ kind: 'update' as const, values, where })),
      ...Object.values(deletes).map((where) => ({ kind: 'delete' as const, where }))
    ],
    [inserts, updates, deletes]
  );

  const discardStaged = () => {
    setUpdates({});
    setDeletes({});
    setInserts([]);
  };

  const load = (
    nextOffset: number,
    {
      filter: nextFilter = filter,
      search: nextSearch = search,
      pageSize: nextPageSize = pageSize,
      columnFilters: nextColumnFilters = columnFilters
    }: {
      filter?: string;
      search?: string;
      pageSize?: number;
      columnFilters?: ColumnFilter[];
    } = {}
  ) => {
    setError(undefined);
    startLoading(async () => {
      const response = await fetchTableRowsAction({
        connectionId,
        schema: table.schema,
        table: table.name,
        limit: nextPageSize,
        offset: nextOffset,
        filter: nextFilter || undefined,
        search: nextSearch || undefined,
        searchColumns: nextSearch ? columnNames : undefined,
        columnFilters: nextColumnFilters.length > 0 ? nextColumnFilters : undefined,
        database
      });
      if (!response.ok || !response.page) {
        setError(response.error ?? 'Could not load rows');
        return;
      }
      setColumns(response.page.columns);
      setRows(response.page.rows);
      setHasMore(response.page.hasMore);
      setOffset(nextOffset);
      onRowsLoaded?.(nextOffset + response.page.rows.length, response.page.hasMore);
    });
  };

  useEffect(() => {
    setFilterInput('');
    setFilter('');
    setSearchInput('');
    setSearch('');
    setColumnFilters([]);
    setEditing(null);
    setNewRow(undefined);
    discardStaged();
    load(0, { filter: '', search: '', columnFilters: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableKey]);

  // Search as you type, once typing pauses.
  useEffect(() => {
    const term = searchInput.trim();
    if (term === search) return;
    const timer = setTimeout(() => {
      setSearch(term);
      load(0, { search: term });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const rowObject = (row: unknown[]): RowValues =>
    Object.fromEntries(columns.map((column, index) => [column, row[index]]));

  const primaryKeyWhere = (row: unknown[]): RowValues => {
    const record = rowObject(row);
    return Object.fromEntries(table.primaryKeys.map((pk) => [pk, record[pk]]));
  };

  const rowKey = (row: unknown[]) => JSON.stringify(primaryKeyWhere(row));

  /** What a cell shows: its staged value when it has one, else what the database has. */
  const displayValue = (row: unknown[], column: string): unknown => {
    const staged = updates[rowKey(row)]?.values;
    return staged && Object.hasOwn(staged, column) ? staged[column] : row[columns.indexOf(column)];
  };

  /** Stages one cell; setting it back to the database's value unstages it. */
  const stageCell = (row: unknown[], column: string, value: unknown) => {
    const key = rowKey(row);
    const original = row[columns.indexOf(column)];
    setUpdates((current) => {
      const { [column]: _previous, ...others } = current[key]?.values ?? {};
      const values =
        cellText(value) === cellText(original) && (value === null) === (original === null)
          ? others
          : { ...others, [column]: value };
      const { [key]: _row, ...rest } = current;
      return Object.keys(values).length === 0
        ? rest
        : { ...rest, [key]: { where: primaryKeyWhere(row), values } };
    });
  };

  const startEdit = (rowIndex: number, column: string, currentValue: unknown) => {
    if (!canEdit || rowKey(rows[rowIndex]) in deletes) return;
    setEditing({ row: rowIndex, column });
    setEditValue(cellText(currentValue));
  };

  /** `nextValue` lets a date picker commit what was just picked, before state catches up. */
  const commitEdit = (nextValue = editValue) => {
    if (!editing) return;
    const { row: rowIndex, column } = editing;
    const columnMeta = table.columns.find((c) => c.name === column);
    const value = nextValue === '' && columnMeta?.nullable ? null : nextValue;
    stageCell(rows[rowIndex], column, value);
    setEditing(null);
  };

  /** Dates go back the way each database reads them; MySQL's DATETIME rejects ISO's `Z`. */
  const formatDate = (date: Date, kind: 'date' | 'datetime') =>
    kind === 'date'
      ? date.toISOString().slice(0, 10)
      : provider === 'MYSQL'
        ? date.toISOString().slice(0, 19).replace('T', ' ')
        : date.toISOString();

  const applyColumnFilter = (column: string, next: ColumnFilter | null) => {
    const updated = [
      ...columnFilters.filter((entry) => entry.column !== column),
      ...(next ? [next] : [])
    ];
    setColumnFilters(updated);
    load(0, { columnFilters: updated });
  };

  const toggleBoolean = (rowIndex: number, column: string, currentValue: unknown) => {
    if (!canEdit || rowKey(rows[rowIndex]) in deletes) return;
    stageCell(
      rows[rowIndex],
      column,
      !(currentValue === true || currentValue === 1 || currentValue === '1')
    );
  };

  const startNewRow = () => {
    setNewRow(Object.fromEntries(table.columns.map((c) => [c.name, ''])));
  };

  const stageNewRow = () => {
    if (!newRow) return;
    const values = Object.fromEntries(Object.entries(newRow).filter(([, value]) => value !== ''));
    setInserts((current) => [...current, { id: Date.now(), values }]);
    setNewRow(undefined);
  };

  const toggleDelete = (row: unknown[]) => {
    const key = rowKey(row);
    setDeletes((current) => {
      const { [key]: removed, ...rest } = current;
      return removed ? rest : { ...current, [key]: primaryKeyWhere(row) };
    });
  };

  const execute = () => {
    setReviewError(undefined);
    startExecuting(async () => {
      const response = await applyTableRowChangesAction({
        connectionId,
        schema: table.schema,
        table: table.name,
        changes: stagedChanges,
        database
      });
      if (!response.ok) {
        setReviewError(response.error ?? 'Could not apply the changes');
        return;
      }
      discardStaged();
      setReviewOpen(false);
      load(offset);
    });
  };

  const applyFilter = () => {
    setFilter(filterInput);
    load(0, { filter: filterInput });
  };

  return (
    <div className='space-y-3'>
      <div className='relative max-w-sm'>
        <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2' />
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder='Search all columns…'
          className='h-8 pl-8 text-sm'
          aria-label='Search rows'
        />
      </div>
      <form
        className='flex flex-wrap items-center gap-2'
        onSubmit={(event) => {
          event.preventDefault();
          applyFilter();
        }}
      >
        <span className='text-muted-foreground text-sm'>WHERE</span>
        <SqlInput
          value={filterInput}
          onChange={setFilterInput}
          dialect={provider}
          schema={{ [table.name]: columnNames }}
          defaultTable={table.name}
          singleLine
          onSubmit={applyFilter}
          placeholder="id > 100 AND status = 'active'"
          className='h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30'
          aria-label='Filter rows'
        />
        <Button type='submit' variant='outline' size='sm' disabled={loading}>
          <Icons.search className='size-3.5' />
          Apply
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={loading}
          onClick={() => load(offset)}
        >
          <Icons.refresh className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
        {canInsert && !newRow && (
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={startNewRow}
            disabled={loading}
          >
            <Icons.add className='size-3.5' />
            Add row
          </Button>
        )}
        {stagedChanges.length > 0 && (
          <>
            <Button type='button' variant='ghost' size='sm' onClick={discardStaged}>
              Discard
            </Button>
            <Button
              type='button'
              size='sm'
              className='relative'
              onClick={() => {
                setReviewError(undefined);
                setReviewOpen(true);
              }}
            >
              <Icons.run className='size-3.5' />
              Execute
              <span
                className='bg-destructive absolute -top-2 -right-2 min-w-5 rounded-full px-1 text-center text-[11px] leading-5 font-semibold text-white tabular-nums'
                aria-label={`${stagedChanges.length} pending`}
              >
                {stagedChanges.length}
              </span>
            </Button>
          </>
        )}
      </form>

      {columnFilters.length > 0 && (
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-muted-foreground text-xs'>Filters</span>
          {columnFilters.map((entry) => (
            <span
              key={entry.column}
              className='bg-primary/10 text-primary flex items-center gap-1 rounded-md py-0.5 pr-0.5 pl-2 font-mono text-xs'
            >
              <Icons.filter className='size-3' aria-hidden='true' />
              {describeFilter(entry)}
              <button
                type='button'
                aria-label={`Remove filter on ${entry.column}`}
                onClick={() => applyColumnFilter(entry.column, null)}
                className='hover:bg-primary/15 grid size-5 place-items-center rounded'
              >
                <Icons.close className='size-3' />
              </button>
            </span>
          ))}
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-6 text-xs'
            onClick={() => {
              setColumnFilters([]);
              load(0, { columnFilters: [] });
            }}
          >
            Clear all
          </Button>
        </div>
      )}

      {readOnly && (
        <p className='text-muted-foreground text-xs'>Read-only connection — editing disabled.</p>
      )}
      {!readOnly && !hasPk && (
        <p className='text-muted-foreground text-xs'>
          No primary key — rows can be viewed and added, but not edited or deleted.
        </p>
      )}

      {error && (
        <Alert variant='destructive'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div
        aria-busy={loading}
        className={cn('max-h-[32rem] rounded-lg border', STICKY_TABLE_SCROLLER)}
      >
        <DataTable>
          <TableHeader className='bg-muted sticky top-0 z-10'>
            <TableRow>
              {(columns.length > 0 ? columns : columnNames).map((column) => (
                <TableHead key={column}>
                  <span className='flex items-center justify-between gap-2'>
                    {column}
                    {columnMetaByName.get(column) && (
                      <ColumnFilterButton
                        column={columnMetaByName.get(column)!}
                        filter={columnFilters.find((entry) => entry.column === column)}
                        format={formatDate}
                        onApply={(next) => applyColumnFilter(column, next)}
                      />
                    )}
                  </span>
                </TableHead>
              ))}
              {(canEdit || canInsert) && <TableHead className='w-9' />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {newRow && (
              <TableRow className='bg-muted/30'>
                {table.columns.map((column) => (
                  <TableCell key={column.name}>
                    <Input
                      value={newRow[column.name] ?? ''}
                      onChange={(event) =>
                        setNewRow((prev) => ({ ...prev, [column.name]: event.target.value }))
                      }
                      placeholder={column.nullable ? 'NULL' : column.name}
                      className='h-7 font-mono text-xs'
                    />
                  </TableCell>
                ))}
                <TableCell>
                  <div className='flex items-center gap-1'>
                    <Button
                      type='button'
                      size='icon-sm'
                      onClick={stageNewRow}
                      aria-label='Stage new row'
                    >
                      <Icons.check className='size-3.5' />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      onClick={() => setNewRow(undefined)}
                      aria-label='Cancel new row'
                    >
                      <Icons.close className='size-3.5' />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}

            {inserts.map((insert) => (
              <TableRow
                key={insert.id}
                className='bg-emerald-500/10 hover:bg-emerald-500/15'
                title='New row, runs on Execute'
              >
                {columns.map((column) => (
                  <TableCell
                    key={column}
                    className={cn(
                      'font-mono text-xs',
                      !Object.hasOwn(insert.values, column) && 'text-muted-foreground italic'
                    )}
                  >
                    {Object.hasOwn(insert.values, column)
                      ? cellText(insert.values[column])
                      : 'DEFAULT'}
                  </TableCell>
                ))}
                <TableCell>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    onClick={() =>
                      setInserts((current) => current.filter((entry) => entry.id !== insert.id))
                    }
                    aria-label='Remove new row'
                  >
                    <Icons.close className='size-3.5' />
                  </Button>
                </TableCell>
              </TableRow>
            ))}

            {loading &&
              Array.from({ length: Math.min(pageSize, 8) }, (_, index) => (
                <TableRow key={`skeleton-${index}`} aria-hidden='true'>
                  {(columns.length > 0 ? columns : columnNames).map((column, columnIndex) => (
                    <TableCell key={column}>
                      <Skeleton
                        className='h-4'
                        style={{ width: `${45 + ((index * 7 + columnIndex * 13) % 45)}%` }}
                      />
                    </TableCell>
                  ))}
                  {(canEdit || canInsert) && <TableCell />}
                </TableRow>
              ))}

            {!loading &&
              rows.map((row, rowIndex) => {
                const key = canEdit ? rowKey(row) : String(rowIndex);
                const deleted = key in deletes;
                const staged = updates[key]?.values;
                return (
                  <TableRow
                    key={rowIndex}
                    className={cn(
                      deleted && 'bg-destructive/10 hover:bg-destructive/15 line-through opacity-70'
                    )}
                  >
                    {columns.map((column) => {
                      const value = canEdit
                        ? displayValue(row, column)
                        : row[columns.indexOf(column)];
                      const changed = !!staged && Object.hasOwn(staged, column);
                      const columnMeta = table.columns.find((c) => c.name === column);
                      const isEditing = editing?.row === rowIndex && editing.column === column;

                      if (columnMeta && isBooleanColumn(columnMeta.dataType)) {
                        return (
                          <TableCell key={column}>
                            <input
                              type='checkbox'
                              className={cn('size-4', changed && 'accent-amber-500')}
                              checked={value === true || value === 1 || value === '1'}
                              disabled={!canEdit || deleted}
                              onChange={() => toggleBoolean(rowIndex, column, value)}
                              aria-label={`${column} for row ${rowIndex + 1}`}
                            />
                          </TableCell>
                        );
                      }

                      const kind = columnMeta ? valueKindOf(columnMeta.dataType) : 'text';
                      if (isEditing && (kind === 'datetime' || kind === 'date')) {
                        return (
                          <TableCell key={column}>
                            <DateTimePicker
                              value={editValue}
                              onChange={setEditValue}
                              mode={kind}
                              format={(date) => formatDate(date, kind)}
                              defaultOpen
                              aria-label={`Edit ${column}`}
                              className='h-7 w-full'
                              onOpenChange={(open) => {
                                if (!open) commitEdit();
                              }}
                            />
                          </TableCell>
                        );
                      }

                      if (isEditing) {
                        return (
                          <TableCell key={column}>
                            <Input
                              autoFocus
                              value={editValue}
                              onChange={(event) => setEditValue(event.target.value)}
                              onBlur={() => commitEdit()}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') commitEdit();
                                if (event.key === 'Escape') setEditing(null);
                              }}
                              className='h-7 font-mono text-xs'
                            />
                          </TableCell>
                        );
                      }

                      return (
                        <TableCell
                          key={column}
                          onClick={() => startEdit(rowIndex, column, value)}
                          className={cn(
                            'font-mono text-xs',
                            canEdit && !deleted && 'hover:bg-muted cursor-text',
                            value === null && 'text-muted-foreground italic',
                            changed && 'bg-amber-500/15 hover:bg-amber-500/20'
                          )}
                          title={changed ? 'Edited, runs on Execute' : undefined}
                        >
                          {value === null ? 'NULL' : cellText(value)}
                        </TableCell>
                      );
                    })}
                    {(canEdit || canInsert) && (
                      <TableCell>
                        {canEdit && (
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-sm'
                            className={cn(
                              !deleted && 'text-muted-foreground hover:text-destructive'
                            )}
                            onClick={() => toggleDelete(row)}
                            aria-label={deleted ? 'Keep row' : 'Delete row'}
                            title={deleted ? 'Keep this row' : 'Delete row (runs on Execute)'}
                          >
                            {deleted ? (
                              <Icons.discard className='size-3.5' />
                            ) : (
                              <Icons.trash className='size-3.5' />
                            )}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}

            {!loading && rows.length === 0 && !newRow && inserts.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={columns.length + 1}
                  className='text-muted-foreground text-center'
                >
                  No rows{filter || search || columnFilters.length > 0 ? ' match' : ''}.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </DataTable>
      </div>

      <div className='flex items-center justify-between'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={loading || offset === 0}
          onClick={() => load(Math.max(0, offset - pageSize))}
        >
          Previous
        </Button>
        <div className='text-muted-foreground flex items-center gap-3 text-xs'>
          <label className='flex items-center gap-1.5'>
            Rows per page
            <NativeSelect
              size='sm'
              value={String(pageSize)}
              onChange={(event) => {
                const next = Number(event.target.value);
                setPageSize(next);
                load(0, { pageSize: next });
              }}
              aria-label='Rows per page'
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </NativeSelect>
          </label>
          <span>
            {loading
              ? 'Loading…'
              : rows.length === 0
                ? 'No rows'
                : `Rows ${offset + 1}–${offset + rows.length}${hasMore ? '' : ' (end of results)'}`}
          </span>
        </div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={loading || !hasMore}
          onClick={() => load(offset + pageSize)}
        >
          Next
        </Button>
      </div>

      <Dialog open={reviewOpen} onOpenChange={(open) => !executing && setReviewOpen(open)}>
        <DialogContent className='sm:max-w-3xl'>
          <DialogHeader>
            <DialogTitle>
              Execute {stagedChanges.length} change{stagedChanges.length === 1 ? '' : 's'}
            </DialogTitle>
            <DialogDescription>
              This SQL runs on {table.schema}.{table.name} in one transaction: every statement
              lands, or none do.
            </DialogDescription>
          </DialogHeader>
          <pre className='bg-muted max-h-[50svh] overflow-auto rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap'>
            <code>
              {stagedChanges
                .map((change) => renderRowStatement(provider, table.schema, table.name, change))
                .join('\n')}
            </code>
          </pre>
          {reviewError && (
            <Alert variant='destructive'>
              <AlertDescription>{reviewError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              disabled={executing}
              onClick={() => setReviewOpen(false)}
            >
              Cancel
            </Button>
            <Button type='button' disabled={executing} onClick={execute}>
              {executing ? (
                <Icons.spinner className='size-3.5 animate-spin' />
              ) : (
                <Icons.run className='size-3.5' />
              )}
              Execute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
