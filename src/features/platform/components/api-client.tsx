'use client';

import { Icons } from '@/components/icons';
import { ENVIRONMENT_LABELS } from '@/features/resources/labels';
import {
  Empty,
  EmptyContent,
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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import {
  createApiRequestAction,
  createCollectionAction,
  getApiRequestDocsAction,
  sendRequestAction,
  updateApiRequestAction
} from '@/features/platform/actions';
import { CurlParseError, parseCurl } from '@/lib/api-client/curl';
import { HTTP_METHODS, type ApiMethod, type ApiRequestDraft } from '@/lib/api-client/types';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  createTab,
  fingerprint,
  folderPaths,
  isDirty,
  tabFromSaved,
  toDraft,
  withDocs,
  withDraft,
  withUrl,
  type ApiCollectionView,
  type ApiEnvironmentView,
  type ApiHistoryView,
  type RequestTab,
  type SavedApiRequest
} from './api-client-state';
import { ApiEnvironmentsDialog } from './api-environments-dialog';
import { ApiImportDialog, type ImportKind } from './api-import-dialog';
import { METHOD_COLORS, MethodBadge } from './api-method-badge';
import { ApiRequestEditor } from './api-request-editor';
import { ApiResponseViewer } from './api-response-viewer';
import { ApiSidebar } from './api-sidebar';

interface ApiClientProps {
  projectId: string;
  collections: ApiCollectionView[];
  environments: ApiEnvironmentView[];
  history: ApiHistoryView[];
}

const MAX_TABS = 12;

/**
 * A Scalar-style API client: collections on the left, the request in the
 * middle, the response on the right. Requests run on the server (see
 * `sendRequest`), so any public API can be tested without CORS getting in the way.
 */
export function ApiClient({ projectId, collections, environments, history }: ApiClientProps) {
  // Nothing opens until a request is picked from the sidebar or a new one is started.
  const [tabs, setTabs] = useState<RequestTab[]>([]);
  const [activeKey, setActiveKey] = useState('');
  // Starts on an environment rather than "No environment": the last one used
  // in this project, else the first that isn't production.
  const [environmentId, setEnvironmentId] = useState(() => defaultEnvironmentId(environments));
  const environmentStorageKey = `devone:api-environment:${projectId}`;
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(environmentStorageKey);
      if (stored !== null && (stored === '' || environments.some((env) => env.id === stored))) {
        setEnvironmentId(stored);
      }
    } catch {
      // Storage can be unavailable (private mode); the default stands.
    }
    // Re-reading after the list refreshes is harmless: picks are stored as they're made.
  }, [environments, environmentStorageKey]);
  // A deleted environment falls back to the default.
  const selectedEnvironmentId =
    environmentId && !environments.some((env) => env.id === environmentId)
      ? defaultEnvironmentId(environments)
      : environmentId;
  const selectEnvironment = (id: string) => {
    setEnvironmentId(id);
    try {
      window.localStorage.setItem(environmentStorageKey, id);
    } catch {
      // Not remembered, but still selected for this visit.
    }
  };
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saving, startSaving] = useTransition();
  const isDesktop = useIsDesktop();

  const active: RequestTab | undefined = tabs.find((tab) => tab.key === activeKey) ?? tabs[0];

  const patchTab = useCallback((key: string, patch: Partial<RequestTab>) => {
    setTabs((current) => current.map((tab) => (tab.key === key ? { ...tab, ...patch } : tab)));
  }, []);

  const openTab = (tab: RequestTab) => {
    setTabs((current) => {
      // Reuse an untouched blank tab instead of piling up empties.
      const blank = current.find(
        (entry) => entry.key === activeKey && !entry.requestId && !entry.url && !entry.result
      );
      if (blank) return current.map((entry) => (entry.key === blank.key ? tab : entry));
      const next = [...current, tab];
      return next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next;
    });
    setActiveKey(tab.key);
  };

  const openSaved = (request: SavedApiRequest) => {
    const existing = tabs.find((tab) => tab.requestId === request.id);
    if (existing) {
      setActiveKey(existing.key);
      return;
    }
    const tab = tabFromSaved(request);
    openTab(tab);
    void getApiRequestDocsAction({ requestId: request.id }).then((result) => {
      const docs = result.ok ? result.docs : null;
      if (!docs) return;
      // Merge against the tab as it is now; the user may have typed meanwhile.
      setTabs((current) =>
        current.map((entry) =>
          entry.key === tab.key ? { ...entry, ...withDocs(entry, docs) } : entry
        )
      );
    });
  };

  const openDraft = (draft: ApiRequestDraft, name = nameFromUrl(draft.url)) =>
    openTab(createTab({ draft, name }));

  const closeTab = (key: string) => {
    const index = tabs.findIndex((tab) => tab.key === key);
    const next = tabs.filter((tab) => tab.key !== key);
    setTabs(next);
    if (key === activeKey) setActiveKey(next[Math.max(0, index - 1)]?.key ?? '');
  };

  /** Keeps only `keys` open, landing on `focus` if the active tab was closed. */
  const keepTabs = (keys: string[], focus: string) => {
    const next = tabs.filter((tab) => keys.includes(tab.key));
    setTabs(next);
    if (!next.some((tab) => tab.key === activeKey)) {
      setActiveKey(next.find((tab) => tab.key === focus)?.key ?? next[0]?.key ?? '');
    }
  };

  const removeRequests = (requestIds: string[]) => {
    const removed = new Set(requestIds);
    // The request is gone; its open tab stays as an unsaved scratch copy.
    setTabs((current) =>
      current.map((tab) =>
        tab.requestId && removed.has(tab.requestId)
          ? { ...tab, requestId: null, collectionId: null, savedFingerprint: null }
          : tab
      )
    );
  };

  const send = useCallback(() => {
    const tab = active;
    if (!tab || tab.sending) return;
    if (!tab.url.trim()) {
      toast.error('Enter a URL');
      return;
    }
    patchTab(tab.key, { sending: true, result: undefined });
    void sendRequestAction({
      projectId,
      draft: toDraft(tab),
      environmentId: selectedEnvironmentId || null
    }).then(
      (result) => patchTab(tab.key, { sending: false, result }),
      () =>
        patchTab(tab.key, {
          sending: false,
          result: { ok: false, error: 'The request failed' }
        })
    );
  }, [active, selectedEnvironmentId, patchTab, projectId]);

  const save = useCallback(() => {
    const tab = active;
    if (!tab) return;
    if (!tab.requestId || !tab.collectionId) {
      setSaveAsOpen(true);
      return;
    }
    const requestId = tab.requestId;
    const collectionId = tab.collectionId;
    const name = tab.name.trim() || 'Untitled request';
    startSaving(async () => {
      const result = await updateApiRequestAction({
        requestId,
        collectionId,
        name,
        draft: toDraft(tab)
      });
      if (!result.ok) {
        toast.error(result.error ?? 'Could not save the request');
        return;
      }
      patchTab(tab.key, { name, savedFingerprint: fingerprint({ ...tab, name }) });
      toast.success('Saved');
    });
  }, [active, patchTab]);

  const saveAs = (
    collection: { id: string } | { newName: string },
    name: string,
    folder: string
  ) => {
    const tab = active;
    if (!tab) return;
    startSaving(async () => {
      let collectionId = 'id' in collection ? collection.id : '';
      if ('newName' in collection) {
        const created = await createCollectionAction({ projectId, name: collection.newName });
        if (!created.ok || !created.collectionId) {
          toast.error(created.error ?? 'Could not create the collection');
          return;
        }
        collectionId = created.collectionId;
      }

      const result = await createApiRequestAction({
        collectionId,
        name,
        folder: folder || null,
        draft: toDraft(tab)
      });
      if (!result.ok || !result.requestId) {
        toast.error(result.error ?? 'Could not save the request');
        return;
      }
      const saved = { ...tab, name, collectionId, requestId: result.requestId };
      patchTab(tab.key, {
        name,
        collectionId,
        requestId: result.requestId,
        savedFingerprint: fingerprint(saved)
      });
      setSaveAsOpen(false);
      toast.success('Saved');
    });
  };

  // ⌘/Ctrl+Enter sends and ⌘/Ctrl+S saves from anywhere on the page. The body
  // editor handles its own ⌘+Enter and marks the event handled.
  const shortcuts = useRef({ send, save });
  shortcuts.current = { send, save };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        shortcuts.current.send();
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        shortcuts.current.save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const sidebar = (
    <ApiSidebar
      projectId={projectId}
      collections={collections}
      history={history}
      activeRequestId={active?.requestId ?? null}
      onOpenRequest={openSaved}
      onOpenHistory={(entry) => openDraft(entry.draft)}
      onNewScratch={() => openTab(createTab({}))}
      onImportCurl={() => setImportKind('curl')}
      onImportOpenApi={() => setImportKind('openapi')}
      onRequestsRemoved={removeRequests}
    />
  );

  const collectionName = collections.find((entry) => entry.id === active?.collectionId)?.name;

  const workspace = (
    <div className='flex h-full min-h-0 flex-col'>
      <TabStrip
        tabs={tabs}
        activeKey={active?.key ?? ''}
        onSelect={setActiveKey}
        onClose={closeTab}
        onCloseOthers={(key) => keepTabs([key], key)}
        onCloseToTheRight={(key) =>
          keepTabs(
            tabs.slice(0, tabs.findIndex((tab) => tab.key === key) + 1).map((tab) => tab.key),
            key
          )
        }
        onCloseAll={() => keepTabs([], '')}
        onNew={() => openTab(createTab({}))}
      />

      {active ? (
        <>
          <div className='space-y-2 border-b p-2'>
            <div className='flex items-center gap-2'>
              <span className='text-muted-foreground flex min-w-0 items-center gap-1 text-xs'>
                <Icons.folder className='size-3.5 shrink-0' />
                <span className='truncate'>{collectionName ?? 'Not saved'}</span>
                <Icons.chevronRight className='size-3 shrink-0' />
              </span>
              <Input
                aria-label='Request name'
                value={active.name}
                onChange={(event) => patchTab(active.key, { name: event.target.value })}
                maxLength={80}
                className='h-7 min-w-0 flex-1 border-transparent bg-transparent px-1 text-sm font-medium shadow-none hover:border-input'
              />
              <Button variant='outline' size='sm' disabled={saving} onClick={save}>
                {active.requestId ? 'Save' : 'Save as…'}
              </Button>
            </div>

            <div className='flex flex-wrap items-center gap-2 sm:flex-nowrap'>
              <div className='border-input focus-within:ring-ring/50 flex min-w-0 flex-1 items-center overflow-hidden rounded-md border focus-within:ring-[3px]'>
                <select
                  aria-label='Method'
                  value={active.method}
                  onChange={(event) =>
                    patchTab(active.key, { method: event.target.value as ApiMethod })
                  }
                  className={cn(
                    'bg-muted/40 h-9 shrink-0 border-r px-2 font-mono text-xs font-semibold outline-none',
                    METHOD_COLORS[active.method]
                  )}
                >
                  {HTTP_METHODS.map((method) => (
                    <option key={method} value={method} className='text-foreground'>
                      {method}
                    </option>
                  ))}
                </select>
                <input
                  aria-label='URL'
                  value={active.url}
                  onChange={(event) => patchTab(active.key, withUrl(active, event.target.value))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) send();
                  }}
                  onPaste={(event) => {
                    // Pasting a curl command fills in the whole request, as Scalar does.
                    const text = event.clipboardData.getData('text');
                    if (!/^\s*curl\s/.test(text)) return;
                    event.preventDefault();
                    try {
                      patchTab(active.key, withDraft(parseCurl(text)));
                      toast.success('Imported the curl command');
                    } catch (error) {
                      toast.error(
                        error instanceof CurlParseError
                          ? error.message
                          : 'Could not read that command'
                      );
                    }
                  }}
                  placeholder='https://api.example.com/users/{{id}}'
                  spellCheck={false}
                  className='h-9 min-w-0 flex-1 bg-transparent px-3 font-mono text-sm outline-none'
                />
              </div>
              <NativeSelect
                aria-label='Resource'
                value={selectedEnvironmentId}
                onChange={(event) => selectEnvironment(event.target.value)}
              >
                <option value=''>No resource</option>
                {environments.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.name} · {ENVIRONMENT_LABELS[environment.environment]}
                    {environment.personal ? ' (only me)' : ''}
                  </option>
                ))}
              </NativeSelect>
              <ApiEnvironmentsDialog projectId={projectId} environments={environments} />
              <Button onClick={send} disabled={active.sending} className='min-w-20'>
                {active.sending ? (
                  <Icons.spinner className='size-4 animate-spin' />
                ) : (
                  <Icons.send className='size-4' />
                )}
                Send
              </Button>
            </div>
          </div>

          {isDesktop ? (
            <ResizablePanelGroup orientation='horizontal' className='min-h-0 flex-1'>
              <ResizablePanel defaultSize='50%' minSize='30%'>
                <ApiRequestEditor
                  tab={active}
                  onChange={(patch) => patchTab(active.key, patch)}
                  onSend={send}
                />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize='50%' minSize='25%'>
                <ApiResponseViewer
                  result={active.result}
                  sending={active.sending}
                  docs={active.docs}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <div className='flex flex-col'>
              <div className='min-h-72 border-b'>
                <ApiRequestEditor
                  tab={active}
                  onChange={(patch) => patchTab(active.key, patch)}
                  onSend={send}
                />
              </div>
              <div className='h-[28rem]'>
                <ApiResponseViewer
                  result={active.result}
                  sending={active.sending}
                  docs={active.docs}
                />
              </div>
            </div>
          )}
        </>
      ) : (
        <Empty className='min-h-80 flex-1 border-0'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Icons.send aria-hidden='true' />
            </EmptyMedia>
            <EmptyTitle>No request open</EmptyTitle>
            <EmptyDescription>
              Pick a request from the sidebar, or start a new one.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size='sm' onClick={() => openTab(createTab({}))}>
              <Icons.add className='size-4' /> New request
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </div>
  );

  return (
    <>
      <div className='bg-card overflow-hidden rounded-xl border lg:h-[calc(100dvh-11rem)] lg:min-h-[36rem]'>
        {isDesktop ? (
          <ResizablePanelGroup orientation='horizontal'>
            <ResizablePanel defaultSize='20%' minSize='14%' maxSize='35%'>
              {sidebar}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize='80%'>{workspace}</ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className='flex flex-col'>
            <div className='max-h-80 border-b'>{sidebar}</div>
            {workspace}
          </div>
        )}
      </div>

      <ApiImportDialog
        projectId={projectId}
        kind={importKind}
        onClose={() => setImportKind(null)}
        onCurlImported={(draft) => openDraft(draft)}
      />

      <SaveAsDialog
        open={saveAsOpen}
        pending={saving}
        defaultName={active?.name ?? ''}
        collections={collections}
        onClose={() => setSaveAsOpen(false)}
        onSave={saveAs}
      />
    </>
  );
}

/** The first environment that isn't production, so a stray send can't hit live data. */
function defaultEnvironmentId(environments: ApiEnvironmentView[]): string {
  return (
    environments.find((env) => env.environment !== 'PRODUCTION')?.id ?? environments[0]?.id ?? ''
  );
}

function TabStrip({
  tabs,
  activeKey,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseToTheRight,
  onCloseAll,
  onNew
}: {
  tabs: RequestTab[];
  activeKey: string;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onCloseOthers: (key: string) => void;
  onCloseToTheRight: (key: string) => void;
  onCloseAll: () => void;
  onNew: () => void;
}) {
  return (
    <div
      role='tablist'
      aria-label='Open requests'
      className='bg-muted/30 flex items-center overflow-x-auto border-b'
    >
      {tabs.map((tab, index) => {
        const isActive = tab.key === activeKey;
        const dirty = isDirty(tab);
        return (
          <ContextMenu key={tab.key}>
            <ContextMenuTrigger
              className={cn(
                'group flex max-w-52 shrink-0 items-center border-r text-xs',
                isActive ? 'bg-card' : 'text-muted-foreground hover:bg-muted/60'
              )}
            >
              <button
                type='button'
                role='tab'
                aria-selected={isActive}
                onClick={() => onSelect(tab.key)}
                onAuxClick={(event) => event.button === 1 && onClose(tab.key)}
                className='flex min-w-0 items-center gap-1 py-2 pr-1 pl-3'
              >
                <MethodBadge method={tab.method} className='w-auto' />
                <span className={cn('truncate', !tab.requestId && 'italic')}>
                  {tab.name || 'Untitled'}
                </span>
                {dirty && (
                  <span
                    aria-label='Unsaved changes'
                    className='bg-primary size-1.5 shrink-0 rounded-full'
                  />
                )}
              </button>
              <button
                type='button'
                aria-label={`Close ${tab.name}`}
                onClick={() => onClose(tab.key)}
                className='hover:bg-muted mr-1 rounded p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
              >
                <Icons.close className='size-3' />
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent className='w-48'>
              <ContextMenuItem onClick={() => onClose(tab.key)}>Close</ContextMenuItem>
              <ContextMenuItem disabled={tabs.length < 2} onClick={() => onCloseOthers(tab.key)}>
                Close others
              </ContextMenuItem>
              <ContextMenuItem
                disabled={index === tabs.length - 1}
                onClick={() => onCloseToTheRight(tab.key)}
              >
                Close to the right
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={onCloseAll}>Close all</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      <button
        type='button'
        aria-label='New request tab'
        onClick={onNew}
        className='text-muted-foreground hover:text-foreground shrink-0 px-2.5 py-2'
      >
        <Icons.add className='size-3.5' />
      </button>
    </div>
  );
}

const NEW_COLLECTION = '__new__';

function SaveAsDialog({
  open,
  pending,
  defaultName,
  collections,
  onClose,
  onSave
}: {
  open: boolean;
  pending: boolean;
  defaultName: string;
  collections: ApiCollectionView[];
  onClose: () => void;
  onSave: (collection: { id: string } | { newName: string }, name: string, folder: string) => void;
}) {
  const [target, setTarget] = useState('');
  const selected = target || collections[0]?.id || NEW_COLLECTION;
  const folders = folderPaths(collections.find((entry) => entry.id === selected)?.requests ?? []);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className='sm:max-w-md'>
        {open && (
          <form
            className='space-y-4'
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const name = String(data.get('name') ?? '').trim() || 'Untitled request';
              const folder = String(data.get('folder') ?? '').trim();
              if (selected === NEW_COLLECTION) {
                const newName = String(data.get('collection') ?? '').trim();
                if (!newName) return;
                onSave({ newName }, name, folder);
              } else {
                onSave({ id: selected }, name, folder);
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Save request</DialogTitle>
            </DialogHeader>
            <div className='space-y-1.5'>
              <Label htmlFor='save-name'>Name</Label>
              <Input
                id='save-name'
                name='name'
                defaultValue={defaultName}
                maxLength={80}
                autoFocus
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='save-collection'>Collection</Label>
              <NativeSelect
                id='save-collection'
                value={selected}
                onChange={(event) => setTarget(event.target.value)}
                className='w-full'
              >
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
                  </option>
                ))}
                <option value={NEW_COLLECTION}>New collection…</option>
              </NativeSelect>
            </div>
            {selected === NEW_COLLECTION && (
              <div className='space-y-1.5'>
                <Label htmlFor='save-new-collection'>Collection name</Label>
                <Input
                  id='save-new-collection'
                  name='collection'
                  placeholder='Users API'
                  maxLength={80}
                  required
                />
              </div>
            )}
            <div className='space-y-1.5'>
              <Label htmlFor='save-folder'>Folder (optional)</Label>
              <Input
                id='save-folder'
                name='folder'
                placeholder='Store/Products'
                maxLength={200}
                autoComplete='off'
                list={folders.length ? 'save-folder-paths' : undefined}
              />
              {folders.length > 0 && (
                <datalist id='save-folder-paths'>
                  {folders.map((path) => (
                    <option key={path} value={path}>
                      {path}
                    </option>
                  ))}
                </datalist>
              )}
            </div>
            <DialogFooter>
              <Button type='button' variant='outline' disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button type='submit' disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function nameFromUrl(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  return path && path !== '/' ? path.slice(0, 80) : url.slice(0, 80) || 'Untitled request';
}

/** Resizable panes need room; below `lg` the client stacks instead. */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(query.matches);
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}
