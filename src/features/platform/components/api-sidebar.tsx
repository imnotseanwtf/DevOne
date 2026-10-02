'use client';

import { Icons } from '@/components/icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  clearHistoryAction,
  createApiRequestAction,
  createCollectionAction,
  deleteApiRequestAction,
  deleteCollectionAction,
  deleteFolderAction,
  duplicateApiRequestAction,
  renameCollectionAction,
  renameFolderAction,
  setApiRequestFolderAction
} from '@/features/platform/actions';
import { normalizeFolder } from '@/lib/api-client/types';
import { cn } from '@/lib/utils';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  buildFolderTree,
  EMPTY_DRAFT,
  folderPaths,
  type ApiCollectionView,
  type ApiHistoryView,
  type FolderNode,
  type SavedApiRequest
} from './api-client-state';
import { MethodBadge, statusTone } from './api-method-badge';

interface ApiSidebarProps {
  projectId: string;
  collections: ApiCollectionView[];
  history: ApiHistoryView[];
  activeRequestId: string | null;
  onOpenRequest: (request: SavedApiRequest) => void;
  onOpenHistory: (entry: ApiHistoryView) => void;
  onNewScratch: () => void;
  onImportCurl: () => void;
  onImportOpenApi: () => void;
  onRequestsRemoved: (requestIds: string[]) => void;
}

type NameDialogState =
  | { kind: 'createCollection' }
  | { kind: 'renameCollection'; collection: ApiCollectionView }
  | { kind: 'newFolder'; collection: ApiCollectionView; parent: string }
  | { kind: 'renameFolder'; collection: ApiCollectionView; path: string }
  | { kind: 'moveRequest'; collection: ApiCollectionView; request: SavedApiRequest }
  | null;

type ConfirmState =
  | { kind: 'collection'; collection: ApiCollectionView }
  | { kind: 'folder'; collection: ApiCollectionView; folder: FolderNode }
  | { kind: 'request'; request: SavedApiRequest }
  | null;

type ActionResult = { ok: boolean; error?: string };

const rowMenuClass =
  'size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100';

type SetUpdater = (update: (current: Set<string>) => Set<string>) => void;

/** Toggles a key in a Set state, or forces it in/out with `force`. */
function toggleIn(setter: SetUpdater) {
  return (key: string, force?: boolean) =>
    setter((current) => {
      const next = new Set(current);
      if (force ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });
}

function folderKey(collectionId: string, path: string): string {
  return `${collectionId}:${path}`;
}

export function ApiSidebar({
  projectId,
  collections,
  history,
  activeRequestId,
  onOpenRequest,
  onOpenHistory,
  onNewScratch,
  onImportCurl,
  onImportOpenApi,
  onRequestsRemoved
}: ApiSidebarProps) {
  const [search, setSearch] = useState('');
  // Collections start open and folders start closed, so a 27-tag import stays tidy.
  const [collapsedCollections, setCollapsedCollections] = useState<Set<string>>(new Set());
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(true);
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [pending, startTransition] = useTransition();

  const term = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!term) return collections;
    return collections
      .map((collection) => ({
        ...collection,
        requests: collection.requests.filter(
          (request) =>
            request.name.toLowerCase().includes(term) ||
            request.draft.url.toLowerCase().includes(term) ||
            request.folder?.toLowerCase().includes(term) ||
            collection.name.toLowerCase().includes(term)
        )
      }))
      .filter((collection) => collection.requests.length > 0);
  }, [collections, term]);

  const toggleCollection = toggleIn(setCollapsedCollections);
  const toggleFolder = toggleIn(setOpenFolders);

  /** Opens a folder and all its parents, so a new or moved request is visible. */
  const reveal = (collectionId: string, path: string | null) => {
    toggleCollection(collectionId, false);
    const segments = normalizeFolder(path)?.split('/') ?? [];
    segments.forEach((_, index) =>
      toggleFolder(folderKey(collectionId, segments.slice(0, index + 1).join('/')), true)
    );
  };

  const run = <T extends ActionResult>(action: () => Promise<T>, onSuccess?: (result: T) => void) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) onSuccess?.(result);
      else toast.error(result.error ?? 'Something went wrong');
    });

  /** Folders exist through their requests, so a new folder starts with one. */
  const newRequestIn = (collection: ApiCollectionView, folder: string | null) =>
    run(
      () =>
        createApiRequestAction({
          collectionId: collection.id,
          name: 'New request',
          draft: EMPTY_DRAFT,
          folder
        }),
      (result) => {
        reveal(collection.id, folder);
        setNameDialog(null);
        if (result.requestId) {
          onOpenRequest({
            id: result.requestId,
            collectionId: collection.id,
            folder,
            name: 'New request',
            draft: EMPTY_DRAFT
          });
        }
      }
    );

  const submitName = (value: string) => {
    const state = nameDialog;
    if (!state) return;
    const close = () => setNameDialog(null);

    switch (state.kind) {
      case 'createCollection':
        return run(() => createCollectionAction({ projectId, name: value }), close);
      case 'renameCollection':
        return run(
          () => renameCollectionAction({ collectionId: state.collection.id, name: value }),
          close
        );
      case 'newFolder':
        return newRequestIn(state.collection, state.parent ? `${state.parent}/${value}` : value);
      case 'renameFolder':
        return run(
          () =>
            renameFolderAction({ collectionId: state.collection.id, from: state.path, to: value }),
          () => {
            reveal(state.collection.id, value);
            close();
          }
        );
      case 'moveRequest':
        return run(
          () => setApiRequestFolderAction({ requestId: state.request.id, folder: value }),
          () => {
            reveal(state.collection.id, value || null);
            close();
          }
        );
    }
  };

  const renderRequest = (request: SavedApiRequest, collection: ApiCollectionView) => (
    <li
      key={request.id}
      className={cn(
        'group flex items-center rounded-md',
        request.id === activeRequestId ? 'bg-muted' : 'hover:bg-muted/60'
      )}
    >
      <button
        type='button'
        onClick={() => onOpenRequest(request)}
        aria-current={request.id === activeRequestId ? 'true' : undefined}
        title={request.draft.url}
        className='flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-sm'
      >
        <MethodBadge method={request.draft.method} />
        <span className='truncate'>{request.name}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant='ghost'
              size='icon'
              className={rowMenuClass}
              aria-label={`${request.name} actions`}
            />
          }
        >
          <Icons.ellipsis className='size-3.5' />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-44'>
          <DropdownMenuItem
            disabled={pending}
            onClick={() => run(() => duplicateApiRequestAction({ requestId: request.id }))}
          >
            <Icons.copy /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setNameDialog({ kind: 'moveRequest', collection, request })}
          >
            <Icons.folder /> Move to folder…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant='destructive'
            onClick={() => setConfirm({ kind: 'request', request })}
          >
            <Icons.trash /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );

  const renderFolder = (folder: FolderNode, collection: ApiCollectionView) => {
    const isOpen = Boolean(term) || openFolders.has(folderKey(collection.id, folder.path));
    return (
      <li key={folder.path}>
        <div className='group hover:bg-muted/60 flex items-center rounded-md'>
          <button
            type='button'
            onClick={() => toggleFolder(folderKey(collection.id, folder.path))}
            aria-expanded={isOpen}
            className='flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left text-sm'
          >
            <Icons.chevronRight
              className={cn(
                'text-muted-foreground size-3.5 shrink-0 transition-transform',
                isOpen && 'rotate-90'
              )}
            />
            <Icons.folder className='text-muted-foreground size-3.5 shrink-0' />
            <span className='truncate'>{folder.name}</span>
            <span className='text-muted-foreground ml-auto text-[10px] tabular-nums'>
              {folder.count}
            </span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon'
                  className={rowMenuClass}
                  aria-label={`${folder.name} folder actions`}
                />
              }
            >
              <Icons.ellipsis className='size-3.5' />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-44'>
              <DropdownMenuItem
                disabled={pending}
                onClick={() => newRequestIn(collection, folder.path)}
              >
                <Icons.add /> New request
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  setNameDialog({ kind: 'newFolder', collection, parent: folder.path })
                }
              >
                <Icons.folderPlus /> New subfolder
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  setNameDialog({ kind: 'renameFolder', collection, path: folder.path })
                }
              >
                <Icons.edit /> Rename or move
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant='destructive'
                onClick={() => setConfirm({ kind: 'folder', collection, folder })}
              >
                <Icons.trash /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {isOpen && renderContents(folder, collection)}
      </li>
    );
  };

  const renderContents = (node: FolderNode, collection: ApiCollectionView) => (
    <ul className='mt-0.5 ml-3 space-y-0.5 border-l pl-1.5'>
      {node.folders.length === 0 && node.requests.length === 0 && (
        <li className='text-muted-foreground px-2 py-1 text-xs'>Empty</li>
      )}
      {node.folders.map((folder) => renderFolder(folder, collection))}
      {node.requests.map((request) => renderRequest(request, collection))}
    </ul>
  );

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex items-center gap-1.5 border-b p-2'>
        <div className='relative flex-1'>
          <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2' />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='Search requests'
            aria-label='Search requests'
            className='h-8 pl-8 text-sm'
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant='outline' size='icon' className='size-8' aria-label='Add' />}
          >
            <Icons.add className='size-4' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-60'>
            <DropdownMenuItem onClick={onNewScratch}>
              <Icons.send /> New request
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setNameDialog({ kind: 'createCollection' })}>
              <Icons.folderPlus /> New collection
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onImportCurl}>
              <Icons.terminal /> Import cURL
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onImportOpenApi}>
              <Icons.import /> Import JSON (OpenAPI, Postman)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className='min-h-0 flex-1 overflow-auto p-1.5'>
        {collections.length === 0 ? (
          <div className='text-muted-foreground space-y-3 px-2 py-6 text-center text-xs'>
            <p>No collections yet. Save a request, or import an OpenAPI document.</p>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setNameDialog({ kind: 'createCollection' })}
            >
              <Icons.folderPlus className='size-3.5' /> New collection
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className='text-muted-foreground px-2 py-4 text-xs'>No requests match.</p>
        ) : (
          <ul className='space-y-0.5'>
            {filtered.map((collection) => {
              const isOpen = Boolean(term) || !collapsedCollections.has(collection.id);
              return (
                <li key={collection.id}>
                  <div className='group hover:bg-muted/60 flex items-center rounded-md'>
                    <button
                      type='button'
                      onClick={() => toggleCollection(collection.id)}
                      aria-expanded={isOpen}
                      className='flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1.5 text-left text-sm font-medium'
                    >
                      <Icons.chevronRight
                        className={cn(
                          'text-muted-foreground size-3.5 shrink-0 transition-transform',
                          isOpen && 'rotate-90'
                        )}
                      />
                      <Icons.server className='text-muted-foreground size-3.5 shrink-0' />
                      <span className='truncate'>{collection.name}</span>
                      <span className='text-muted-foreground ml-auto text-[10px] tabular-nums'>
                        {collection.requests.length}
                      </span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant='ghost'
                            size='icon'
                            className={rowMenuClass}
                            aria-label={`${collection.name} actions`}
                          />
                        }
                      >
                        <Icons.ellipsis className='size-3.5' />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end' className='w-44'>
                        <DropdownMenuItem
                          disabled={pending}
                          onClick={() => newRequestIn(collection, null)}
                        >
                          <Icons.add /> New request
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            setNameDialog({ kind: 'newFolder', collection, parent: '' })
                          }
                        >
                          <Icons.folderPlus /> New folder
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setNameDialog({ kind: 'renameCollection', collection })}
                        >
                          <Icons.edit /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant='destructive'
                          onClick={() => setConfirm({ kind: 'collection', collection })}
                        >
                          <Icons.trash /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {isOpen && renderContents(buildFolderTree(collection.requests), collection)}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className='flex max-h-[40%] min-h-0 flex-col border-t'>
        <div className='flex items-center px-1.5 py-1'>
          <button
            type='button'
            onClick={() => setHistoryOpen((open) => !open)}
            aria-expanded={historyOpen}
            className='text-muted-foreground flex flex-1 items-center gap-1.5 px-1.5 py-1 text-left text-xs font-medium tracking-wide uppercase'
          >
            <Icons.chevronRight
              className={cn('size-3.5 transition-transform', historyOpen && 'rotate-90')}
            />
            <Icons.history className='size-3.5' /> History
          </button>
          {history.length > 0 && (
            <Button
              variant='ghost'
              size='sm'
              className='text-muted-foreground h-6 px-2 text-xs'
              disabled={pending}
              onClick={() => run(() => clearHistoryAction({ projectId }))}
            >
              Clear
            </Button>
          )}
        </div>
        {historyOpen && (
          <ul className='min-h-0 flex-1 space-y-0.5 overflow-auto px-1.5 pb-1.5'>
            {history.length === 0 && (
              <li className='text-muted-foreground px-2 py-1 text-xs'>Nothing sent yet.</li>
            )}
            {history.map((entry) => (
              <li key={entry.id}>
                <button
                  type='button'
                  onClick={() => onOpenHistory(entry)}
                  title={entry.draft.url}
                  className='hover:bg-muted/60 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs'
                >
                  <MethodBadge method={entry.draft.method} />
                  <span className='min-w-0 flex-1 truncate font-mono'>
                    {shortUrl(entry.draft.url)}
                  </span>
                  <span className={cn('font-mono tabular-nums', statusTone(entry.status))}>
                    {entry.status ?? 'ERR'}
                  </span>
                  <span className='text-muted-foreground w-8 shrink-0 text-right'>
                    {ago(entry.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <NameDialog
        state={nameDialog}
        pending={pending}
        onClose={() => setNameDialog(null)}
        onSubmit={submitName}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;
              {confirm?.kind === 'collection'
                ? confirm.collection.name
                : confirm?.kind === 'folder'
                  ? confirm.folder.name
                  : confirm?.request.name}
              &rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'collection'
                ? `This deletes the collection and its ${confirm.collection.requests.length} saved request(s).`
                : confirm?.kind === 'folder'
                  ? `This deletes the folder, its subfolders and ${confirm.folder.count} saved request(s).`
                  : 'This deletes the saved request.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={pending}
              onClick={() => {
                const state = confirm;
                if (!state) return;
                const done = (requestIds: string[]) => {
                  onRequestsRemoved(requestIds);
                  setConfirm(null);
                };
                if (state.kind === 'collection') {
                  run(
                    () => deleteCollectionAction({ collectionId: state.collection.id }),
                    () => done(state.collection.requests.map((request) => request.id))
                  );
                } else if (state.kind === 'folder') {
                  run(
                    () =>
                      deleteFolderAction({
                        collectionId: state.collection.id,
                        path: state.folder.path
                      }),
                    (result) => done(result.requestIds ?? [])
                  );
                } else {
                  run(
                    () => deleteApiRequestAction({ requestId: state.request.id }),
                    () => done([state.request.id])
                  );
                }
              }}
            >
              {pending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function dialogCopy(state: NonNullable<NameDialogState>) {
  switch (state.kind) {
    case 'createCollection':
      return { title: 'New collection', label: 'Collection name', value: '', action: 'Create' };
    case 'renameCollection':
      return {
        title: 'Rename collection',
        label: 'Collection name',
        value: state.collection.name,
        action: 'Rename'
      };
    case 'newFolder':
      return {
        title: state.parent ? `New folder in ${state.parent}` : 'New folder',
        label: 'Folder name',
        value: '',
        action: 'Create',
        description: 'The folder starts with a new request, which you can rename or replace.'
      };
    case 'renameFolder':
      return {
        title: 'Rename or move folder',
        label: 'Folder path',
        value: state.path,
        action: 'Save',
        description: 'Use / to nest it, e.g. Store/Products. Subfolders move with it.'
      };
    case 'moveRequest':
      return {
        title: `Move “${state.request.name}”`,
        label: 'Folder path',
        value: state.request.folder ?? '',
        action: 'Move',
        description:
          'Pick a folder or type a new path like Store/Products. Leave empty for the top level.'
      };
  }
}

function NameDialog({
  state,
  pending,
  onClose,
  onSubmit
}: {
  state: NameDialogState;
  pending: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const copy = state ? dialogCopy(state) : null;
  // Moving and renaming folders suggest the collection's existing paths.
  const suggestions =
    state?.kind === 'moveRequest' || state?.kind === 'renameFolder'
      ? folderPaths(state.collection.requests)
      : [];
  const allowEmpty = state?.kind === 'moveRequest';

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-sm'>
        {state && copy && (
          <form
            className='space-y-4'
            onSubmit={(event) => {
              event.preventDefault();
              const value = String(new FormData(event.currentTarget).get('name') ?? '').trim();
              if (value || allowEmpty) onSubmit(value);
            }}
          >
            <DialogHeader>
              <DialogTitle>{copy.title}</DialogTitle>
              {copy.description && <DialogDescription>{copy.description}</DialogDescription>}
            </DialogHeader>
            <Input
              name='name'
              aria-label={copy.label}
              defaultValue={copy.value}
              placeholder={copy.label === 'Folder path' ? 'Store/Products' : 'Users API'}
              maxLength={copy.label === 'Folder path' ? 200 : 80}
              list={suggestions.length ? 'api-folder-paths' : undefined}
              autoComplete='off'
              autoFocus
              required={!allowEmpty}
            />
            {suggestions.length > 0 && (
              <datalist id='api-folder-paths'>
                {suggestions.map((path) => (
                  <option key={path} value={path}>
                    {path}
                  </option>
                ))}
              </datalist>
            )}
            <DialogFooter>
              <Button type='button' variant='outline' onClick={onClose}>
                Cancel
              </Button>
              <Button type='submit' disabled={pending}>
                {copy.action}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Drops the scheme so the path, the part that differs, fits in the sidebar. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/** Compact relative time for the history list: 12s, 5m, 3h, 2d. */
function ago(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
