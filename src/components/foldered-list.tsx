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
  applyFolderChange,
  droppedFolderPath,
  isInFolder,
  normalizeFolder,
  type FolderChange
} from '@/lib/folders';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import {
  cloneElement,
  useId,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition
} from 'react';
import { toast } from 'sonner';

export interface FolderedItem {
  id: string;
  title: string;
  /** Slash-separated path, e.g. "Design/Flows"; null is the top level. */
  folder: string | null;
  href: string;
  meta?: string;
  /** Overrides the list's icon, e.g. to tell drawing types apart. */
  icon?: IconComponent;
}

type IconComponent = React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;

/** A kind of item to create; with several, "New …" asks which one. */
export interface CreateOption {
  value: string;
  label: string;
  description?: string;
  icon: IconComponent;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

interface FolderedListProps {
  items: FolderedItem[];
  /** Every folder path, including empty folders. */
  folders: string[];
  activeId?: string;
  /** "page" or "drawing", for labels. */
  noun: string;
  icon: IconComponent;
  createOptions?: CreateOption[];
  onCreate: (folder: string | null, option?: string) => Promise<void>;
  onCreateFolder: (path: string) => Promise<ActionResult>;
  onMove: (id: string, folder: string | null) => Promise<ActionResult>;
  onRenameFolder: (from: string, to: string) => Promise<ActionResult>;
  onDelete: (item: FolderedItem) => Promise<ActionResult>;
  /** `itemIds` are the items deleted along with the folder. */
  onDeleteFolder: (path: string, itemIds: string[]) => Promise<ActionResult>;
}

interface FolderNode {
  name: string;
  path: string;
  folders: FolderNode[];
  items: FolderedItem[];
}

function buildTree(items: FolderedItem[], folders: string[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: [], items: [] };
  const nodeFor = (folder: string | null) => {
    let node = root;
    for (const segment of folder?.split('/') ?? []) {
      const path = node.path ? `${node.path}/${segment}` : segment;
      let child = node.folders.find((entry) => entry.path === path);
      if (!child) {
        child = { name: segment, path, folders: [], items: [] };
        node.folders.push(child);
      }
      node = child;
    }
    return node;
  };
  folders.forEach(nodeFor);
  for (const item of items) nodeFor(item.folder).items.push(item);
  sortFolders(root);
  return root;
}

function sortFolders(node: FolderNode) {
  node.folders.sort((a, b) => a.name.localeCompare(b.name));
  node.folders.forEach(sortFolders);
}

const countItems = (node: FolderNode): number =>
  node.items.length + node.folders.reduce((sum, folder) => sum + countItems(folder), 0);

type Dragged = { kind: 'item'; item: FolderedItem } | { kind: 'folder'; path: string };

/** The top level as a drop target (folder paths are never empty). */
const ROOT = '';

/** How long a dragged entry hovers over a closed folder before it opens. */
const OPEN_ON_HOVER_MS = 600;

type Prompt =
  | { kind: 'newFolder'; parent: string | null }
  | { kind: 'move'; item: FolderedItem }
  | { kind: 'renameFolder'; path: string };

type Confirm = { kind: 'item'; item: FolderedItem } | { kind: 'folder'; path: string };

/**
 * A searchable list grouped into collapsible folders, with create / move / rename /
 * delete. Changes show up at once and are rolled back if the server refuses them.
 */
export function FolderedList({
  items: serverItems,
  folders: serverFolders,
  activeId,
  noun,
  icon: ItemIcon,
  createOptions,
  onCreate,
  onCreateFolder,
  onMove,
  onRenameFolder,
  onDelete,
  onDeleteFolder
}: FolderedListProps) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [promptError, setPromptError] = useState<string>();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [creating, startCreate] = useTransition();
  const [, startChange] = useTransition();
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const openTimer = useRef<{ path: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const [{ items, folders }, applyChange] = useOptimistic(
    { items: serverItems, folders: serverFolders },
    applyFolderChange<FolderedItem>
  );

  const term = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      term
        ? items.filter(
            (item) =>
              item.title.toLowerCase().includes(term) ||
              (item.folder ?? '').toLowerCase().includes(term)
          )
        : items,
    [items, term]
  );
  const visibleFolders = useMemo(
    () => (term ? folders.filter((path) => path.toLowerCase().includes(term)) : folders),
    [folders, term]
  );
  const tree = useMemo(() => buildTree(visible, visibleFolders), [visible, visibleFolders]);
  const folderPaths = useMemo(
    () =>
      [
        ...new Set([...folders, ...items.flatMap((item) => (item.folder ? [item.folder] : []))])
      ].toSorted(),
    [folders, items]
  );

  const expand = (path: string | null) => {
    if (!path) return;
    setCollapsed((current) => new Set([...current].filter((entry) => !isInFolder(path, entry))));
  };

  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  /** Shows `change` right away, then runs it on the server; a refusal rolls it back. */
  const change = (next: FolderChange, run: () => Promise<ActionResult>, failure: string) =>
    startChange(async () => {
      applyChange(next);
      const result = await run();
      if (!result.ok) toast.error(result.error ?? failure);
    });

  const create = (folder: string | null, option?: string) =>
    startCreate(async () => {
      await onCreate(folder, option);
      expand(folder);
    });

  /** "New …" as a plain button, or a menu of kinds when there are several. */
  const createControl = (folder: string | null, trigger: React.ReactElement) =>
    createOptions && createOptions.length > 1 ? (
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent align='start' className='w-64'>
          {createOptions.map((option) => (
            <DropdownMenuItem key={option.value} onClick={() => create(folder, option.value)}>
              <option.icon aria-hidden='true' />
              <span className='flex flex-col'>
                {option.label}
                {option.description && (
                  <span className='text-muted-foreground text-xs'>{option.description}</span>
                )}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      cloneElement(trigger as React.ReactElement<{ onClick?: () => void }>, {
        onClick: () => create(folder, createOptions?.[0]?.value)
      })
    );

  const moveItem = (item: FolderedItem, folder: string | null) => {
    if (item.folder === folder) return;
    expand(folder);
    change(
      { type: 'move', id: item.id, folder },
      () => onMove(item.id, folder),
      `Could not move the ${noun}`
    );
  };

  const renameFolder = (from: string, to: string) => {
    if (from === to) return;
    if (isInFolder(to, from)) {
      toast.error('A folder cannot go inside itself');
      return;
    }
    expand(to);
    change(
      { type: 'renameFolder', from, to },
      () => onRenameFolder(from, to),
      'Could not move the folder'
    );
  };

  const submitPrompt = (value: string) => {
    if (!prompt) return;
    const folder = normalizeFolder(value);
    if (prompt.kind === 'move') {
      moveItem(prompt.item, folder);
    } else if (!folder) {
      setPromptError('Name the folder');
      return;
    } else if (prompt.kind === 'renameFolder') {
      renameFolder(prompt.path, folder);
    } else {
      const path = normalizeFolder(prompt.parent ? `${prompt.parent}/${folder}` : folder)!;
      expand(path);
      change(
        { type: 'createFolder', path },
        () => onCreateFolder(path),
        'Could not create the folder'
      );
    }
    setPromptError(undefined);
    setPrompt(null);
  };

  const confirmDelete = () => {
    if (!confirm) return;
    if (confirm.kind === 'item') {
      const { item } = confirm;
      change({ type: 'delete', id: item.id }, () => onDelete(item), `Could not delete the ${noun}`);
    } else {
      const { path } = confirm;
      const ids = items.filter((item) => isInFolder(item.folder, path)).map((item) => item.id);
      change(
        { type: 'deleteFolder', path },
        () => onDeleteFolder(path, ids),
        'Could not delete the folder'
      );
    }
    setConfirm(null);
  };

  /** The move a drop on `target` (ROOT for the top level) would make, if any. */
  const dropMove = (target: string) => {
    if (!dragged) return null;
    const folder = target === ROOT ? null : target;
    if (dragged.kind === 'item') {
      return dragged.item.folder === folder ? null : { kind: 'item' as const, folder };
    }
    const next = droppedFolderPath(dragged.path, folder);
    return next ? { kind: 'folder' as const, from: dragged.path, to: next } : null;
  };

  const clearOpenTimer = () => {
    if (openTimer.current) clearTimeout(openTimer.current.timer);
    openTimer.current = null;
  };

  const endDrag = () => {
    clearOpenTimer();
    setDragged(null);
    setDropTarget(null);
  };

  /** Drag-and-drop handlers for a drop zone; nested zones win over their parents. */
  const dropZone = (target: string) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!dragged) return;
      // The innermost zone decides, so hovering a folder never falls through to its parent.
      event.stopPropagation();
      if (!dropMove(target)) {
        setDropTarget(null);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(target);
      if (target !== ROOT && collapsed.has(target) && openTimer.current?.path !== target) {
        clearOpenTimer();
        openTimer.current = {
          path: target,
          timer: setTimeout(() => expand(target), OPEN_ON_HOVER_MS)
        };
      }
    },
    onDragLeave: (event: React.DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setDropTarget((current) => (current === target ? null : current));
      if (openTimer.current?.path === target) clearOpenTimer();
    },
    onDrop: (event: React.DragEvent) => {
      event.stopPropagation();
      const move = dropMove(target);
      if (!move || !dragged) return;
      event.preventDefault();
      const item = dragged.kind === 'item' ? dragged.item : null;
      endDrag();
      if (move.kind === 'item' && item) moveItem(item, move.folder);
      else if (move.kind === 'folder') renameFolder(move.from, move.to);
    }
  });

  const dragSource = (entry: Dragged, label: string) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.stopPropagation();
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', label);
      setDragged(entry);
    },
    onDragEnd: endDrag
  });

  const renderItem = (item: FolderedItem, depth: number) => {
    const Icon = item.icon ?? ItemIcon;
    return (
      <li key={item.id} className='group/item relative'>
        <Link
          href={item.href}
          {...dragSource({ kind: 'item', item }, item.title)}
          aria-current={item.id === activeId ? 'page' : undefined}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          className={cn(
            'hover:bg-accent hover:text-accent-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground flex items-center gap-2 rounded-md py-1.5 pr-8',
            dragged?.kind === 'item' && dragged.item.id === item.id && 'opacity-50'
          )}
        >
          <Icon className='text-muted-foreground size-4 shrink-0' aria-hidden='true' />
          <span className='min-w-0 flex-1 truncate'>{item.title}</span>
          {item.meta && (
            <span className='text-muted-foreground shrink-0 text-xs group-hover/item:hidden'>
              {item.meta}
            </span>
          )}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type='button'
                aria-label={`Actions for ${item.title}`}
                className='hover:bg-background text-muted-foreground absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100'
              />
            }
          >
            <Icons.ellipsis className='size-4' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-48'>
            <DropdownMenuItem onClick={() => setPrompt({ kind: 'move', item })}>
              <Icons.folder /> Move to folder…
            </DropdownMenuItem>
            {item.folder && (
              <DropdownMenuItem onClick={() => moveItem(item, null)}>
                <Icons.chevronsLeft /> Move to top level
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant='destructive'
              onClick={() => setConfirm({ kind: 'item', item })}
            >
              <Icons.trash /> Delete {noun}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  };

  const renderFolder = (node: FolderNode, depth: number): React.ReactNode => {
    const open = term.length > 0 || !collapsed.has(node.path);
    const beingDragged =
      dragged?.kind === 'folder' &&
      (dragged.path === node.path || node.path.startsWith(`${dragged.path}/`));
    return (
      <li
        key={node.path}
        {...dropZone(node.path)}
        className={cn(
          'rounded-md',
          dropTarget === node.path && 'bg-primary/5 ring-primary/60 ring-1',
          beingDragged && 'opacity-50'
        )}
      >
        <div className='group/folder relative'>
          <button
            type='button'
            {...dragSource({ kind: 'folder', path: node.path }, node.path)}
            onClick={() => toggle(node.path)}
            aria-expanded={open}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            className='hover:bg-accent flex w-full items-center gap-1.5 rounded-md py-1.5 pr-14 text-left font-medium'
          >
            <Icons.chevronRight
              className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
              aria-hidden='true'
            />
            {open ? (
              <Icons.folderOpen className='size-4 shrink-0 text-sky-600' aria-hidden='true' />
            ) : (
              <Icons.folder className='size-4 shrink-0 text-sky-600' aria-hidden='true' />
            )}
            <span className='min-w-0 flex-1 truncate'>{node.name}</span>
            <span className='text-muted-foreground text-xs font-normal group-hover/folder:hidden'>
              {countItems(node)}
            </span>
          </button>
          <span className='absolute top-1/2 right-1 flex -translate-y-1/2 items-center opacity-0 group-hover/folder:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100'>
            {createControl(
              node.path,
              <button
                type='button'
                aria-label={`New ${noun} in ${node.path}`}
                title={`New ${noun} here`}
                disabled={creating}
                className='hover:bg-background text-muted-foreground grid size-6 place-items-center rounded'
              >
                <Icons.add className='size-3.5' />
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type='button'
                    aria-label={`Actions for folder ${node.path}`}
                    className='hover:bg-background text-muted-foreground grid size-6 place-items-center rounded'
                  />
                }
              >
                <Icons.ellipsis className='size-3.5' />
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-48'>
                <DropdownMenuItem
                  onClick={() => setPrompt({ kind: 'newFolder', parent: node.path })}
                >
                  <Icons.folderPlus /> New subfolder…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setPrompt({ kind: 'renameFolder', path: node.path })}
                >
                  <Icons.edit /> Rename or move…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant='destructive'
                  onClick={() => setConfirm({ kind: 'folder', path: node.path })}
                >
                  <Icons.trash /> Delete folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>
        {open && (
          <ul>
            {node.folders.map((folder) => renderFolder(folder, depth + 1))}
            {node.items.map((item) => renderItem(item, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const promptCopy =
    prompt?.kind === 'newFolder'
      ? {
          title: prompt.parent ? `New folder in ${prompt.parent}` : 'New folder',
          description: 'Use "/" to nest, e.g. Design/Flows.',
          action: 'Create folder',
          value: ''
        }
      : prompt?.kind === 'move'
        ? {
            title: `Move “${prompt.item.title}”`,
            description: 'Pick a folder or type a new one. Leave it empty for the top level.',
            action: 'Move',
            value: prompt.item.folder ?? ''
          }
        : prompt?.kind === 'renameFolder'
          ? {
              title: 'Rename folder',
              description: `Everything inside ${prompt.path} moves with it. Use "/" to move it into another folder.`,
              action: 'Rename',
              value: prompt.path
            }
          : null;

  const deletedCount =
    confirm?.kind === 'folder'
      ? items.filter((item) => isInFolder(item.folder, confirm.path)).length
      : 0;

  return (
    <div className='space-y-2'>
      <div className='relative'>
        <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2' />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${noun}s…`}
          aria-label={`Search ${noun}s`}
          className='h-8 pl-8 text-sm'
        />
      </div>

      {tree.folders.length === 0 && tree.items.length === 0 ? (
        <p className='text-muted-foreground px-1 py-2 text-sm'>
          {term ? `No ${noun}s match “${query.trim()}”.` : `No ${noun}s yet.`}
        </p>
      ) : (
        <div {...dropZone(ROOT)} className='space-y-1'>
          <ul className='space-y-0.5 text-sm'>
            {tree.folders.map((folder) => renderFolder(folder, 0))}
            {tree.items.map((item) => renderItem(item, 0))}
          </ul>
          {dragged && dropMove(ROOT) && (
            <div
              className={cn(
                'text-muted-foreground flex items-center justify-center gap-1.5 rounded-md border border-dashed py-2 text-xs',
                dropTarget === ROOT && 'border-primary bg-primary/5 text-foreground'
              )}
            >
              <Icons.chevronsLeft className='size-3.5' aria-hidden='true' />
              Drop here to move to the top level
            </div>
          )}
        </div>
      )}

      <div className='grid grid-cols-2 gap-2 pt-1'>
        {createControl(
          null,
          <Button type='button' variant='outline' size='sm' disabled={creating}>
            {creating ? (
              <Icons.spinner className='animate-spin' aria-hidden='true' />
            ) : (
              <Icons.add aria-hidden='true' />
            )}
            New {noun}
          </Button>
        )}
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => setPrompt({ kind: 'newFolder', parent: null })}
        >
          <Icons.folderPlus aria-hidden='true' />
          New folder
        </Button>
      </div>

      <Dialog
        open={prompt !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPrompt(null);
            setPromptError(undefined);
          }
        }}
      >
        <DialogContent className='sm:max-w-md'>
          {promptCopy && (
            <form
              className='space-y-4'
              onSubmit={(event) => {
                event.preventDefault();
                submitPrompt(String(new FormData(event.currentTarget).get('folder') ?? ''));
              }}
            >
              <DialogHeader>
                <DialogTitle>{promptCopy.title}</DialogTitle>
                <DialogDescription>{promptCopy.description}</DialogDescription>
              </DialogHeader>
              <div className='space-y-1.5'>
                <Input
                  name='folder'
                  defaultValue={promptCopy.value}
                  placeholder='Folder'
                  aria-label='Folder'
                  list={prompt?.kind !== 'newFolder' && folderPaths.length > 0 ? listId : undefined}
                  maxLength={200}
                  autoComplete='off'
                  autoFocus
                />
                <datalist id={listId}>
                  {folderPaths.map((path) => (
                    <option key={path} value={path}>
                      {path}
                    </option>
                  ))}
                </datalist>
                {promptError && <p className='text-destructive text-xs'>{promptError}</p>}
              </div>
              <DialogFooter>
                <Button type='button' variant='outline' onClick={() => setPrompt(null)}>
                  Cancel
                </Button>
                <Button type='submit'>{promptCopy.action}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'item'
                ? `Delete “${confirm.item.title}”?`
                : `Delete the folder “${confirm?.path}”?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'item'
                ? `The ${noun} and its links to tasks are removed. This cannot be undone.`
                : deletedCount > 0
                  ? `Everything inside it is deleted too, including ${deletedCount} ${noun}${deletedCount === 1 ? '' : 's'}. This cannot be undone.`
                  : 'The folder is empty, so nothing else is deleted.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant='destructive' onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
