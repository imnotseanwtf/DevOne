'use client';

import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  deleteEntryAction,
  listCollectionsAction,
  listEntriesAction,
  saveEntryAction
} from '@/features/database/document-actions';
import type {
  CollectionSummary,
  DocumentEntry,
  DocumentVocabulary
} from '@/lib/database/document/types';
import type { DatabaseProviderName } from '@/lib/database/types';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

const PAGE_SIZE = 50;

/** What a brand-new entry starts as in the editor, per engine. */
const NEW_ENTRY_TEMPLATE: Partial<Record<DatabaseProviderName, string>> = {
  MONGODB: '{\n  \n}',
  DYNAMODB: '{\n  \n}',
  REDIS: '{\n  "key": "my:key",\n  "type": "string",\n  "ttl": null,\n  "value": ""\n}'
};

interface EditorState {
  /** Null while creating. */
  id: string | null;
  text: string;
}

/** Browses and edits a MongoDB, Redis or DynamoDB database: collections, then entries. */
export function DocumentExplorer({
  connectionId,
  database,
  provider,
  readOnly
}: {
  connectionId: string;
  database: string;
  provider: DatabaseProviderName;
  readOnly: boolean;
}) {
  const [collections, setCollections] = useState<CollectionSummary[]>();
  const [vocabulary, setVocabulary] = useState<DocumentVocabulary>();
  const [collection, setCollection] = useState<string>();
  const [filterInput, setFilterInput] = useState('');
  const [filter, setFilter] = useState('');
  const [entries, setEntries] = useState<DocumentEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [loading, startLoading] = useTransition();
  const [editor, setEditor] = useState<EditorState>();
  const [saveError, setSaveError] = useState<string>();
  const [saving, startSaving] = useTransition();
  const [pendingDelete, setPendingDelete] = useState<string>();
  // Guards against a slow earlier response overwriting a newer one.
  const requestId = useRef(0);

  const loadCollections = useCallback(() => {
    setError(undefined);
    startLoading(async () => {
      const result = await listCollectionsAction({ connectionId, database });
      if (!result.ok) {
        setError(result.error ?? 'Could not list collections');
        return;
      }
      setCollections(result.collections ?? []);
      setVocabulary(result.vocabulary);
      setCollection((current) =>
        result.collections?.some((entry) => entry.name === current)
          ? current
          : result.collections?.[0]?.name
      );
    });
  }, [connectionId, database]);

  useEffect(() => {
    setCollections(undefined);
    setCollection(undefined);
    loadCollections();
  }, [loadCollections]);

  const loadEntries = useCallback(
    (cursor?: string) => {
      if (!collection) return;
      const current = ++requestId.current;
      setError(undefined);
      startLoading(async () => {
        const result = await listEntriesAction({
          connectionId,
          database,
          collection,
          cursor,
          filter: filter || undefined,
          limit: PAGE_SIZE
        });
        if (current !== requestId.current) return;
        if (!result.ok) {
          setError(result.error ?? 'Could not load entries');
          return;
        }
        setEntries((existing) =>
          cursor ? [...existing, ...(result.entries ?? [])] : (result.entries ?? [])
        );
        setNextCursor(result.nextCursor ?? null);
      });
    },
    [collection, connectionId, database, filter]
  );

  useEffect(() => {
    setEntries([]);
    setNextCursor(null);
    loadEntries();
  }, [loadEntries]);

  const save = () => {
    if (!editor || !collection) return;
    setSaveError(undefined);
    startSaving(async () => {
      const result = await saveEntryAction({
        connectionId,
        database,
        collection,
        id: editor.id,
        json: editor.text
      });
      if (!result.ok) {
        setSaveError(result.error ?? 'Could not save');
        return;
      }
      setEditor(undefined);
      loadEntries();
      loadCollections();
    });
  };

  const remove = (id: string) => {
    if (!collection) return;
    startSaving(async () => {
      const result = await deleteEntryAction({ connectionId, database, collection, id });
      setPendingDelete(undefined);
      if (!result.ok) {
        setError(result.error ?? 'Could not delete');
        return;
      }
      loadEntries();
      loadCollections();
    });
  };

  const noun = vocabulary?.entry ?? 'entry';

  return (
    <div className='flex flex-col gap-4 lg:flex-row'>
      <aside className='lg:w-60 lg:shrink-0'>
        <p className='text-muted-foreground mb-2 px-1 text-xs font-medium uppercase'>
          {vocabulary?.collection ?? 'collection'}s
        </p>
        {!collections ? (
          <p className='text-muted-foreground px-2 py-1.5 text-xs'>Loading…</p>
        ) : collections.length === 0 ? (
          <p className='text-muted-foreground px-2 py-1.5 text-xs'>Nothing here yet.</p>
        ) : (
          <ul className='max-h-[32rem] space-y-0.5 overflow-auto'>
            {collections.map((entry) => (
              <li key={entry.name}>
                <button
                  type='button'
                  onClick={() => {
                    setCollection(entry.name);
                    setFilterInput('');
                    setFilter('');
                  }}
                  aria-current={entry.name === collection ? 'true' : undefined}
                  className={cn(
                    'flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm',
                    entry.name === collection ? 'bg-muted font-medium' : 'hover:bg-muted/60'
                  )}
                >
                  <span className='flex items-center gap-2'>
                    <Icons.table className='text-muted-foreground size-3.5 shrink-0' />
                    <span className='min-w-0 flex-1 truncate'>{entry.name}</span>
                    {entry.count !== null && (
                      <span className='text-muted-foreground text-xs'>{entry.count}</span>
                    )}
                  </span>
                  {entry.description && (
                    <span className='text-muted-foreground mt-0.5 truncate pl-5.5 text-[11px]'>
                      {entry.description}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className='min-w-0 flex-1 space-y-3'>
        <form
          className='flex flex-wrap items-center gap-2'
          onSubmit={(event) => {
            event.preventDefault();
            setFilter(filterInput.trim());
          }}
        >
          <Input
            value={filterInput}
            onChange={(event) => setFilterInput(event.target.value)}
            placeholder={vocabulary?.filterHint ?? 'Filter'}
            className='h-8 min-w-48 flex-1 font-mono text-sm'
            aria-label={`Filter ${noun}s`}
          />
          <Button type='submit' size='sm' variant='outline' disabled={!collection}>
            <Icons.search className='size-3.5' />
            Filter
          </Button>
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => loadEntries()}
            disabled={!collection || loading}
          >
            <Icons.refresh className={cn('size-3.5', loading && 'animate-spin')} />
            <span className='sr-only'>Refresh</span>
          </Button>
          {!readOnly && (
            <Button
              type='button'
              size='sm'
              disabled={!collection}
              onClick={() => {
                setSaveError(undefined);
                setEditor({ id: null, text: NEW_ENTRY_TEMPLATE[provider] ?? '{}' });
              }}
            >
              <Icons.add className='size-3.5' />
              New {noun}
            </Button>
          )}
        </form>

        {error && <p className='text-destructive text-sm'>{error}</p>}

        {entries.length === 0 && !loading && !error ? (
          <p className='text-muted-foreground text-sm'>
            {collection
              ? `No ${noun}s match.`
              : `Pick a ${vocabulary?.collection ?? 'collection'}.`}
          </p>
        ) : (
          <ul className='space-y-2'>
            {entries.map((entry) => (
              <li key={entry.id} className='bg-card rounded-lg border'>
                <div className='flex items-center justify-between gap-2 border-b px-3 py-1.5'>
                  <span className='text-muted-foreground min-w-0 truncate font-mono text-xs'>
                    {entry.id}
                  </span>
                  <div className='flex shrink-0 items-center gap-1'>
                    {!readOnly &&
                      (pendingDelete === entry.id ? (
                        <>
                          <Button
                            type='button'
                            size='xs'
                            variant='destructive'
                            disabled={saving}
                            onClick={() => remove(entry.id)}
                          >
                            Delete {noun}
                          </Button>
                          <Button
                            type='button'
                            size='xs'
                            variant='ghost'
                            onClick={() => setPendingDelete(undefined)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            type='button'
                            size='icon-sm'
                            variant='ghost'
                            onClick={() => {
                              setSaveError(undefined);
                              setEditor({
                                id: entry.id,
                                text: JSON.stringify(entry.value, null, 2)
                              });
                            }}
                          >
                            <Icons.edit className='size-3.5' />
                            <span className='sr-only'>Edit {noun}</span>
                          </Button>
                          <Button
                            type='button'
                            size='icon-sm'
                            variant='ghost'
                            className='text-muted-foreground hover:text-destructive'
                            onClick={() => setPendingDelete(entry.id)}
                          >
                            <Icons.trash className='size-3.5' />
                            <span className='sr-only'>Delete {noun}</span>
                          </Button>
                        </>
                      ))}
                  </div>
                </div>
                <pre className='max-h-60 overflow-auto p-3 text-xs leading-relaxed'>
                  <code>{JSON.stringify(entry.value, null, 2)}</code>
                </pre>
              </li>
            ))}
          </ul>
        )}

        <div className='flex items-center gap-3'>
          {nextCursor && (
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={loading}
              onClick={() => loadEntries(nextCursor)}
            >
              Load more
            </Button>
          )}
          {entries.length > 0 && (
            <Badge variant='outline'>
              {entries.length} {noun}
              {entries.length === 1 ? '' : 's'}
              {nextCursor ? '+' : ''}
            </Badge>
          )}
        </div>
      </section>

      <Dialog open={!!editor} onOpenChange={(open) => !saving && !open && setEditor(undefined)}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{editor?.id === null ? `New ${noun}` : `Edit ${noun}`}</DialogTitle>
            <DialogDescription>
              {provider === 'REDIS'
                ? 'type is string, hash, list, set or zset. Saving replaces the whole key.'
                : provider === 'DYNAMODB'
                  ? 'Saving replaces the whole item. Key attributes cannot be changed.'
                  : 'Saving replaces the whole document. Use Extended JSON for ObjectId and dates, e.g. {"$oid": "…"}.'}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={editor?.text ?? ''}
            onChange={(event) =>
              setEditor((current) => current && { ...current, text: event.target.value })
            }
            spellCheck={false}
            className='min-h-80 font-mono text-xs'
            aria-label='JSON'
          />
          {saveError && <p className='text-destructive text-sm'>{saveError}</p>}
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => setEditor(undefined)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type='button' onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
