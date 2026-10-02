'use client';

import { Icons } from '@/components/icons';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import { repositoryTreeOptions } from '@/features/git/api/queries';
import {
  CHANGE_COLOR,
  CHANGE_LETTER,
  mergeLocalEntries,
  parentOf,
  type Changes,
  type TreeNode
} from '@/features/git/components/workbench/changes';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useRef, useState } from 'react';
import { toast } from 'sonner';

/** A file being dragged in the explorer, and the folder it would land in. */
interface DragState {
  dragged: string | null;
  target: string | null;
  start: (path: string) => void;
  end: () => void;
  zone: (folder: string) => {
    onDragOver: (event: React.DragEvent) => void;
    onDragLeave: (event: React.DragEvent) => void;
    onDrop: (event: React.DragEvent) => void;
  };
}

const DragContext = createContext<DragState | null>(null);

/** How long a dragged file hovers over a closed folder before it opens. */
const OPEN_ON_HOVER_MS = 600;

export interface ExplorerActions {
  onOpen: (path: string) => void;
  onToggle: (path: string) => void;
  onNewFile: (folder: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  /** Moves a file into `folder` ('' is the repository root). */
  onMove: (path: string, folder: string) => void;
}

interface ExplorerProps extends ExplorerActions {
  repositoryId: string;
  repositoryName: string;
  reference: string;
  activePath: string | null;
  expanded: ReadonlySet<string>;
  changes: Changes;
  onRefresh: () => void;
  onCollapseAll: () => void;
}

export function Explorer({
  repositoryName,
  onRefresh,
  onCollapseAll,
  onNewFile,
  ...rest
}: ExplorerProps) {
  const { expanded, onToggle, onMove } = rest;
  const [dragged, setDragged] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const openTimer = useRef<{ folder: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const clearTimer = () => {
    if (openTimer.current) clearTimeout(openTimer.current.timer);
    openTimer.current = null;
  };

  const drag: DragState = {
    dragged,
    target,
    start: setDragged,
    end: () => {
      clearTimer();
      setDragged(null);
      setTarget(null);
    },
    zone: (folder) => ({
      onDragOver: (event) => {
        if (!dragged) return;
        // The innermost folder decides, so a drop never falls through to its parent.
        event.stopPropagation();
        if (parentOf(dragged) === folder) {
          setTarget(null);
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setTarget(folder);
        if (folder && !expanded.has(folder) && openTimer.current?.folder !== folder) {
          clearTimer();
          openTimer.current = {
            folder,
            timer: setTimeout(() => onToggle(folder), OPEN_ON_HOVER_MS)
          };
        }
      },
      onDragLeave: (event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setTarget((current) => (current === folder ? null : current));
        if (openTimer.current?.folder === folder) clearTimer();
      },
      onDrop: (event) => {
        event.stopPropagation();
        if (!dragged || parentOf(dragged) === folder) return;
        event.preventDefault();
        const path = dragged;
        drag.end();
        onMove(path, folder);
      }
    })
  };

  return (
    <div className='flex h-full flex-col'>
      <PanelHeader title='Explorer'>
        <PanelAction label='New file' onClick={() => onNewFile('')}>
          <Icons.filePlus />
        </PanelAction>
        <PanelAction label='Refresh explorer' onClick={onRefresh}>
          <Icons.refresh />
        </PanelAction>
        <PanelAction label='Collapse folders' onClick={onCollapseAll}>
          <Icons.collapseAll />
        </PanelAction>
      </PanelHeader>
      <DragContext value={drag}>
        <div
          {...drag.zone('')}
          className={cn(
            'min-h-0 flex-1 overflow-auto pb-4',
            target === '' && 'bg-primary/5 ring-primary/50 ring-1 ring-inset'
          )}
        >
          <p className='truncate px-3 py-1 text-[11px] font-semibold tracking-wide uppercase'>
            {repositoryName.split('/').pop()}
          </p>
          <TreeLevel path='' depth={0} onNewFile={onNewFile} {...rest} />
        </div>
      </DragContext>
    </div>
  );
}

export function PanelHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className='group/header flex h-9 shrink-0 items-center justify-between gap-2 pr-1.5 pl-3'>
      <p className='text-muted-foreground truncate text-[11px] font-semibold tracking-wide uppercase'>
        {title}
      </p>
      <div className='flex items-center'>{children}</div>
    </div>
  );
}

export function PanelAction({
  label,
  onClick,
  disabled,
  children
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className='text-muted-foreground hover:bg-muted hover:text-foreground grid size-6 place-items-center rounded disabled:opacity-40 [&_svg]:size-4'
    >
      {children}
    </button>
  );
}

type TreeLevelProps = Omit<ExplorerProps, 'repositoryName' | 'onRefresh' | 'onCollapseAll'> & {
  path: string;
  depth: number;
  /** A folder that only exists in local changes; there is nothing to fetch. */
  local?: boolean;
};

function TreeLevel({ repositoryId, reference, path, depth, local, ...rest }: TreeLevelProps) {
  const { data, error, isPending } = useQuery({
    ...repositoryTreeOptions(repositoryId, reference, path),
    enabled: !local
  });
  const indent = { paddingLeft: `${depth * 12 + 26}px` };

  // Files added locally show straight away, even while the folder loads or fails.
  const nodes = mergeLocalEntries(path, data ?? [], rest.changes);
  const status = local ? null : isPending ? (
    <p className='text-muted-foreground py-0.5 text-xs' style={indent}>
      Loading…
    </p>
  ) : error ? (
    <p className='text-destructive py-0.5 text-xs' style={indent}>
      {error.message}
    </p>
  ) : null;

  return (
    <ul role={depth === 0 ? 'tree' : 'group'}>
      {status && <li role='none'>{status}</li>}
      {nodes.map((node) => (
        <TreeItem
          key={node.path}
          repositoryId={repositoryId}
          reference={reference}
          node={node}
          depth={depth}
          {...rest}
        />
      ))}
    </ul>
  );
}

function TreeItem({
  node,
  depth,
  ...rest
}: Omit<TreeLevelProps, 'path' | 'local'> & { node: TreeNode }) {
  const { activePath, expanded, changes, onOpen, onToggle, onNewFile, onRename, onDelete } = rest;
  const drag = useContext(DragContext);
  const isDir = node.type === 'dir';
  const isOpen = isDir && expanded.has(node.path);
  const change = isDir ? undefined : changes[node.path];
  const hasChangedChild =
    isDir && Object.keys(changes).some((path) => path.startsWith(`${node.path}/`));
  const deleted = change?.kind === 'deleted';

  function copyPath() {
    void navigator.clipboard
      .writeText(node.path)
      .then(() => toast.success('Path copied'))
      .catch(() => toast.error('Could not copy the path'));
  }

  return (
    <li
      role='treeitem'
      aria-expanded={isDir ? isOpen : undefined}
      aria-selected={node.path === activePath}
      // Folders take drops; dropping on a file lands in the file's folder (its <li> parent).
      {...(isDir && drag ? drag.zone(node.path) : {})}
      className={cn(
        isDir && drag?.target === node.path && 'bg-primary/5 ring-primary/50 ring-1 ring-inset'
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger
          className={cn(
            'group/row hover:bg-muted relative flex items-center',
            node.path === activePath && 'bg-primary/10 hover:bg-primary/15'
          )}
        >
          <button
            type='button'
            draggable={!isDir && !deleted}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', node.path);
              drag?.start(node.path);
            }}
            onDragEnd={() => drag?.end()}
            onClick={() => (isDir ? onToggle(node.path) : !deleted && onOpen(node.path))}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1 py-[3px] pr-2 text-left text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
              drag?.dragged === node.path && 'opacity-50'
            )}
          >
            {isDir ? (
              <Icons.chevronRight
                className={cn('size-3.5 shrink-0 transition-transform', isOpen && 'rotate-90')}
                aria-hidden='true'
              />
            ) : (
              <span className='w-3.5 shrink-0' />
            )}
            {isDir ? (
              isOpen ? (
                <Icons.folderOpen className='size-4 shrink-0 text-sky-600' aria-hidden='true' />
              ) : (
                <Icons.folder className='size-4 shrink-0 text-sky-600' aria-hidden='true' />
              )
            ) : (
              <Icons.fileCode
                className='text-muted-foreground size-4 shrink-0'
                aria-hidden='true'
              />
            )}
            <span
              className={cn(
                'truncate',
                change && CHANGE_COLOR[change.kind],
                hasChangedChild && 'text-amber-600 dark:text-amber-400',
                deleted && 'line-through'
              )}
            >
              {node.name}
            </span>
          </button>

          <span className='absolute right-6 hidden items-center gap-0.5 group-hover/row:flex group-focus-within/row:flex'>
            {isDir ? (
              <PanelAction label={`New file in ${node.path}`} onClick={() => onNewFile(node.path)}>
                <Icons.filePlus />
              </PanelAction>
            ) : (
              !deleted && (
                <>
                  <PanelAction label={`Rename ${node.path}`} onClick={() => onRename(node.path)}>
                    <Icons.edit />
                  </PanelAction>
                  <PanelAction label={`Delete ${node.path}`} onClick={() => onDelete(node.path)}>
                    <Icons.trash />
                  </PanelAction>
                </>
              )
            )}
          </span>
          <span
            className={cn(
              'w-5 shrink-0 pr-2 text-right text-xs font-semibold',
              change ? CHANGE_COLOR[change.kind] : 'text-amber-600 dark:text-amber-400'
            )}
          >
            {change ? CHANGE_LETTER[change.kind] : hasChangedChild ? '•' : ''}
          </span>
        </ContextMenuTrigger>
        <ContextMenuContent className='w-48'>
          {isDir ? (
            <ContextMenuItem onClick={() => onNewFile(node.path)}>
              <Icons.filePlus /> New file…
            </ContextMenuItem>
          ) : (
            <>
              <ContextMenuItem disabled={deleted} onClick={() => onOpen(node.path)}>
                <Icons.fileCode /> Open
              </ContextMenuItem>
              <ContextMenuItem disabled={deleted} onClick={() => onRename(node.path)}>
                <Icons.edit /> Rename…
              </ContextMenuItem>
              <ContextMenuItem
                variant='destructive'
                disabled={deleted}
                onClick={() => onDelete(node.path)}
              >
                <Icons.trash /> Delete
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={copyPath}>
            <Icons.copy /> Copy path
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isOpen && <TreeLevel path={node.path} depth={depth + 1} local={node.local} {...rest} />}
    </li>
  );
}
