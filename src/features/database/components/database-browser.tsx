'use client';

import { Icons } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { listDatabasesForConnectionAction } from '@/features/database/actions';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useMemo, useState, useTransition } from 'react';

/** Sidebar list of the databases on one connection; the picked one is highlighted. */
export function DatabaseBrowser({
  connectionId,
  base,
  defaultDatabase,
  currentDatabase
}: {
  connectionId: string;
  base: string;
  defaultDatabase: string | null;
  currentDatabase: string | null;
}) {
  const [search, setSearch] = useState('');
  const [databases, setDatabases] = useState<string[]>();
  const [error, setError] = useState<string>();
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    setError(undefined);
    startLoading(async () => {
      const result = await listDatabasesForConnectionAction({ connectionId });
      if (!result.ok) {
        setError(result.error ?? 'Could not list databases');
        return;
      }
      setDatabases(result.databases ?? []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = databases ?? [];
    return term ? list.filter((name) => name.toLowerCase().includes(term)) : list;
  }, [databases, search]);

  return (
    <div className='space-y-2'>
      <div className='relative'>
        <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2' />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder='Find a database…'
          className='h-8 pl-8 text-sm'
          aria-label='Find a database'
        />
      </div>

      {error ? (
        <p className='text-destructive px-2 py-1.5 text-xs'>{error}</p>
      ) : loading && !databases ? (
        <p className='text-muted-foreground px-2 py-1.5 text-xs'>Loading databases…</p>
      ) : filtered.length === 0 ? (
        <p className='text-muted-foreground px-2 py-1.5 text-xs'>
          {databases?.length ? `No databases match "${search}".` : 'No databases found.'}
        </p>
      ) : (
        <ul className='max-h-[32rem] space-y-0.5 overflow-auto'>
          {filtered.map((name) => {
            const isActive = name === currentDatabase;
            return (
              <li key={name}>
                <Link
                  href={`${base}?connection=${connectionId}&database=${encodeURIComponent(name)}`}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                    isActive ? 'bg-muted font-medium' : 'hover:bg-muted/60'
                  )}
                >
                  <Icons.database
                    className={cn('size-3.5 shrink-0', !isActive && 'text-muted-foreground')}
                  />
                  <span className='min-w-0 flex-1 truncate'>{name}</span>
                  {name === defaultDatabase && (
                    <span className='text-muted-foreground shrink-0 text-[10px]'>default</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
