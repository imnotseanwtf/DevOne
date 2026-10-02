'use client';

import { Icons } from '@/components/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { connectSessionAction, runQueryAction, saveQueryAction } from '@/features/database/actions';
import { SqlInput } from '@/features/database/components/sql-input';
import { STICKY_TABLE_SCROLLER } from '@/features/database/components/sticky-table';
import { cn } from '@/lib/utils';
import type { DatabaseProviderName, QueryResult } from '@/lib/database/types';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

interface SqlEditorProps {
  connectionId: string;
  /** Set when browsing a database other than the connection's saved default. */
  database?: string;
  provider: DatabaseProviderName;
  readOnly: boolean;
  schema: Record<string, string[]>;
  savedQueries: { id: string; name: string; sql: string }[];
}

export function SqlEditor({
  connectionId,
  database,
  provider,
  readOnly,
  schema,
  savedQueries
}: SqlEditorProps) {
  const router = useRouter();
  const [sql, setSql] = useState('SELECT 1;');
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<QueryResult>();
  const [allowWrite, setAllowWrite] = useState(false);
  const [pending, startTransition] = useTransition();

  // Connected automatically: one session per database is opened in the
  // background and reused for every run. It lives in sessionStorage, so tab
  // switches and reloads keep it; the server's idle timeout ends it, and the
  // next run quietly reconnects. Without a session, each run still works on a
  // connection of its own.
  const sessionKey = `devone:db-session:${connectionId}:${database ?? 'default'}`;
  const [sessionId, setSessionIdState] = useState<string>();

  const setSessionId = (id: string | undefined) => {
    setSessionIdState(id);
    try {
      if (id) sessionStorage.setItem(sessionKey, id);
      else sessionStorage.removeItem(sessionKey);
    } catch {
      // Nothing to persist to; the in-memory state still works this visit.
    }
  };

  const openSession = async (): Promise<string | undefined> => {
    const response = await connectSessionAction({ connectionId, database });
    const id = response.ok ? response.sessionId : undefined;
    setSessionId(id);
    return id;
  };

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(sessionKey);
    } catch {
      // Blocked storage: open a fresh session below.
    }
    setSessionIdState(stored ?? undefined);
    if (!stored) void openSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  const run = () => {
    setError(undefined);
    startTransition(async () => {
      const execute = (id: string | undefined) =>
        runQueryAction({ connectionId, sql, allowWrite, sessionId: id, database });
      let response = await execute(sessionId);
      if (!response.ok && sessionId && response.error?.includes('Session not found or expired')) {
        response = await execute(await openSession());
      }
      if (!response.ok) {
        setResult(undefined);
        setError(response.error ?? 'The query failed');
        return;
      }
      setResult(response.result);
    });
  };

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-end gap-2'>
        <Badge variant={readOnly ? 'secondary' : 'destructive'}>
          {readOnly ? 'Read-only' : 'Writes allowed'}
        </Badge>
      </div>

      <div className='space-y-3'>
        <SqlInput
          value={sql}
          onChange={setSql}
          dialect={provider}
          schema={schema}
          onSubmit={run}
          aria-label='SQL statement'
          className='min-h-40 rounded-lg border border-input bg-transparent px-2.5 py-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30'
        />

        <div className='flex flex-wrap items-center gap-3'>
          <Button onClick={run} disabled={pending}>
            <Icons.run className='size-3.5' />
            {pending ? 'Running…' : 'Run'}
          </Button>
          <span className='text-muted-foreground hidden text-xs md:inline'>
            or press Ctrl/⌘+Enter
          </span>

          {!readOnly && (
            <label className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                className='size-4'
                aria-label='Allow writes for this run'
                checked={allowWrite}
                onChange={(event) => setAllowWrite(event.target.checked)}
              />
              Allow writes for this run
            </label>
          )}

          <span className='flex items-center gap-2'>
            <Input
              aria-label='Saved query name'
              placeholder='Save as…'
              value={name}
              onChange={(event) => setName(event.target.value)}
              className='h-8 w-40'
            />
            <Button
              variant='outline'
              size='sm'
              disabled={pending || name.trim() === ''}
              onClick={() => {
                startTransition(async () => {
                  const response = await saveQueryAction({ connectionId, name, sql });
                  if (!response.ok) {
                    setError(response.error ?? 'Could not save the query');
                    return;
                  }
                  setName('');
                  router.refresh();
                });
              }}
            >
              Save
            </Button>
          </span>
        </div>

        {savedQueries.length > 0 && (
          <div className='flex flex-wrap gap-2'>
            {savedQueries.map((query) => (
              <Button key={query.id} variant='outline' size='sm' onClick={() => setSql(query.sql)}>
                {query.name}
              </Button>
            ))}
          </div>
        )}

        {error && (
          <Alert variant='destructive'>
            <AlertDescription className='font-mono text-xs'>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      {result && <ResultTable result={result} />}
    </div>
  );
}

function ResultTable({ result }: { result: QueryResult }) {
  return (
    <div className='space-y-2 rounded-lg border'>
      <div className='flex items-center justify-between gap-4 border-b px-3 py-2'>
        <p className='text-sm font-medium'>
          {result.rowCount} row{result.rowCount === 1 ? '' : 's'}
        </p>
        <span className='text-muted-foreground text-xs'>{result.durationMs} ms</span>
      </div>
      {result.truncated && (
        <p className='text-muted-foreground px-3 text-xs'>
          Showing the first {result.rows.length} rows.
        </p>
      )}
      <div className={cn('max-h-[28rem]', STICKY_TABLE_SCROLLER)}>
        <Table>
          <TableHeader className='bg-muted sticky top-0 z-10'>
            <TableRow>
              {result.columns.map((column, index) => (
                <TableHead key={`${column}-${index}`}>{column}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <TableCell key={cellIndex} className='font-mono text-xs'>
                    {renderCell(cell)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function renderCell(value: unknown): string {
  if (value === null) return 'NULL';
  if (value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
