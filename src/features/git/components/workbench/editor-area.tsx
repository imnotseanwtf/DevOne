'use client';

import { Icons } from '@/components/icons';
import { renderMarkdown } from '@/components/markdown-editor';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import { Kbd } from '@/components/ui/kbd';
import { repositoryFileOptions } from '@/features/git/api/queries';
import { CodeEditor, DiffEditor } from '@/features/git/components/code-editor';
import {
  baseName,
  CHANGE_COLOR,
  parseTab,
  type Change
} from '@/features/git/components/workbench/changes';
import { toggleMarkdownTask } from '@/features/git/markdown-tasks';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path);

/** What the tab's right-click menu can do, like VS Code's editor tab menu. */
export interface TabActions {
  onClose: (tab: string) => void;
  onCloseOthers: (tab: string) => void;
  onCloseToRight: (tab: string) => void;
  onCloseUnchanged: () => void;
  onCloseAll: () => void;
  onOpenFile: (path: string) => void;
  onOpenChanges: (path: string) => void;
  onReveal: (path: string) => void;
  onRename: (path: string) => void;
  onDiscard: (path: string) => void;
}

interface EditorAreaProps extends TabActions {
  repositoryId: string;
  reference: string;
  /** File paths, or diff tabs (see `diffTab`). */
  tabs: string[];
  activePath: string | null;
  changes: Record<string, Change>;
  onActivate: (tab: string) => void;
  onEdit: (path: string, original: string | null, text: string) => void;
  onCursorChange: (line: number, column: number) => void;
  onSave: () => void;
  onNewFile: () => void;
}

export function EditorArea({
  repositoryId,
  reference,
  tabs,
  activePath,
  changes,
  onActivate,
  onEdit,
  onCursorChange,
  onSave,
  onNewFile,
  ...actions
}: EditorAreaProps) {
  const { onClose } = actions;
  const active = activePath ? parseTab(activePath) : null;
  return (
    <div className='flex h-full min-w-0 flex-col'>
      {tabs.length > 0 && (
        <div
          role='tablist'
          aria-label='Open editors'
          className='bg-muted/40 flex h-9 shrink-0 overflow-x-auto border-b'
        >
          {tabs.map((tab, index) => (
            <EditorTab
              key={tab}
              tab={tab}
              active={tab === activePath}
              last={index === tabs.length - 1}
              onlyTab={tabs.length === 1}
              change={changes[parseTab(tab).path]}
              onActivate={onActivate}
              {...actions}
            />
          ))}
        </div>
      )}

      {active ? (
        <EditorPane
          key={`${reference}:${activePath}`}
          repositoryId={repositoryId}
          reference={reference}
          path={active.path}
          diff={active.diff}
          change={changes[active.path]}
          onEdit={(original, text) => onEdit(active.path, original, text)}
          onCursorChange={onCursorChange}
          onSave={onSave}
          onOpenFile={() => actions.onOpenFile(active.path)}
          onOpenChanges={() => actions.onOpenChanges(active.path)}
        />
      ) : (
        <Welcome onNewFile={onNewFile} />
      )}
    </div>
  );
}

function EditorTab({
  tab,
  active,
  last,
  onlyTab,
  change,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseUnchanged,
  onCloseAll,
  onOpenFile,
  onOpenChanges,
  onReveal,
  onRename,
  onDiscard
}: TabActions & {
  tab: string;
  active: boolean;
  last: boolean;
  onlyTab: boolean;
  change: Change | undefined;
  onActivate: (tab: string) => void;
}) {
  const { path, diff } = parseTab(tab);
  const deleted = change?.kind === 'deleted';

  const copy = (text: string, what: string) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success(`${what} copied`))
      .catch(() => toast.error(`Could not copy the ${what.toLowerCase()}`));

  return (
    <ContextMenu>
      <ContextMenuTrigger
        role='tab'
        aria-selected={active}
        onAuxClick={(event) => event.button === 1 && onClose(tab)}
        className={cn(
          'group relative flex shrink-0 items-center gap-1.5 border-r pr-1.5 pl-3 text-xs',
          active
            ? 'bg-background text-foreground after:bg-primary after:absolute after:inset-x-0 after:top-0 after:h-0.5'
            : 'text-muted-foreground hover:bg-background/60'
        )}
      >
        <button
          type='button'
          onClick={() => onActivate(tab)}
          className={cn(
            'flex h-full items-center gap-1.5',
            change && CHANGE_COLOR[change.kind],
            deleted && !diff && 'line-through'
          )}
          title={diff ? `${path} (Working Tree)` : path}
        >
          {diff ? (
            <Icons.gitCompare className='size-3.5' aria-hidden='true' />
          ) : (
            <Icons.fileCode className='size-3.5' aria-hidden='true' />
          )}
          {baseName(path)}
          {diff && <span className='text-muted-foreground'>(Working Tree)</span>}
        </button>
        <button
          type='button'
          onClick={() => onClose(tab)}
          aria-label={`Close ${diff ? `changes in ${path}` : path}`}
          className='hover:bg-muted grid size-5 place-items-center rounded'
        >
          {change && !diff && (
            <span className='bg-foreground size-2 rounded-full group-hover:hidden' />
          )}
          <Icons.close
            className={cn(
              'size-3.5',
              change && !diff
                ? 'hidden group-hover:block'
                : !active && 'opacity-0 group-hover:opacity-100'
            )}
          />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className='w-60'>
        <ContextMenuItem onClick={() => onClose(tab)}>
          Close
          <ContextMenuShortcut>Middle-click</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={onlyTab} onClick={() => onCloseOthers(tab)}>
          Close Others
        </ContextMenuItem>
        <ContextMenuItem disabled={last} onClick={() => onCloseToRight(tab)}>
          Close to the Right
        </ContextMenuItem>
        <ContextMenuItem onClick={onCloseUnchanged}>Close Unchanged</ContextMenuItem>
        <ContextMenuItem onClick={onCloseAll}>Close All</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => copy(path, 'Path')}>
          <Icons.copy /> Copy Path
        </ContextMenuItem>
        <ContextMenuItem onClick={() => copy(baseName(path), 'Name')}>
          <Icons.copy /> Copy Name
        </ContextMenuItem>
        <ContextMenuSeparator />
        {diff ? (
          <ContextMenuItem disabled={deleted} onClick={() => onOpenFile(path)}>
            <Icons.fileCode /> Open File
          </ContextMenuItem>
        ) : (
          <ContextMenuItem disabled={!change} onClick={() => onOpenChanges(path)}>
            <Icons.gitCompare /> Open Changes
          </ContextMenuItem>
        )}
        <ContextMenuItem disabled={deleted} onClick={() => onReveal(path)}>
          <Icons.folderOpen /> Reveal in Explorer
        </ContextMenuItem>
        <ContextMenuItem disabled={deleted} onClick={() => onRename(path)}>
          <Icons.edit /> Rename…
        </ContextMenuItem>
        {change && (
          <ContextMenuItem variant='destructive' onClick={() => onDiscard(path)}>
            <Icons.discard /> Discard Changes
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function Welcome({ onNewFile }: { onNewFile: () => void }) {
  return (
    <div className='text-muted-foreground grid flex-1 place-items-center p-6 text-sm'>
      <div className='space-y-4 text-center'>
        <Icons.code className='mx-auto size-16 opacity-20' aria-hidden='true' />
        <div className='space-y-1'>
          <p>Open a file from the explorer to start editing.</p>
          <button type='button' onClick={onNewFile} className='text-primary hover:underline'>
            New file…
          </button>
        </div>
        <dl className='grid grid-cols-[auto_auto] justify-center gap-x-4 gap-y-1.5 text-xs'>
          <dt className='text-right'>Go to commit</dt>
          <dd className='text-left'>
            <Kbd>Ctrl</Kbd> <Kbd>S</Kbd>
          </dd>
          <dt className='text-right'>Commit from message box</dt>
          <dd className='text-left'>
            <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd>
          </dd>
          <dt className='text-right'>File actions</dt>
          <dd className='text-left'>Right-click in the explorer</dd>
        </dl>
      </div>
    </div>
  );
}

interface EditorPaneProps {
  repositoryId: string;
  reference: string;
  path: string;
  /** Shows the changes side by side instead of the file. */
  diff: boolean;
  change: Change | undefined;
  onOpenFile: () => void;
  onOpenChanges: () => void;
  onEdit: (original: string | null, text: string) => void;
  onCursorChange: (line: number, column: number) => void;
  onSave: () => void;
}

function EditorPane({
  repositoryId,
  reference,
  path,
  diff,
  change,
  onEdit,
  onCursorChange,
  onSave,
  onOpenFile,
  onOpenChanges
}: EditorPaneProps) {
  const added = change?.kind === 'added';
  const { data, error, isPending } = useQuery({
    ...repositoryFileOptions(repositoryId, reference, path),
    enabled: !added
  });
  const [preview, setPreview] = useState(false);

  const original = added ? null : (data?.text ?? null);
  const text = change && change.kind !== 'deleted' ? change.content : (data?.text ?? '');

  let body: React.ReactNode;
  if (diff && !added && isPending) {
    body = <Notice>Opening changes in {path}…</Notice>;
  } else if (diff && !added && error) {
    body = <Notice tone='error'>{error.message}</Notice>;
  } else if (diff && !added && data?.truncated) {
    body = <Notice>This file is binary or too large to compare in the browser.</Notice>;
  } else if (diff) {
    body = (
      <DiffEditor
        path={path}
        original={original ?? ''}
        modified={change?.kind === 'deleted' ? '' : text}
        onChange={change?.kind === 'deleted' ? undefined : (next) => onEdit(original, next)}
        onCursorChange={onCursorChange}
        onSave={onSave}
        className='min-h-0 flex-1 overflow-hidden'
      />
    );
  } else if (change?.kind === 'deleted') {
    body = <Notice>This file is deleted in your changes. Discard the change to restore it.</Notice>;
  } else if (!added && isPending) {
    body = <Notice>Opening {path}…</Notice>;
  } else if (!added && error) {
    body = <Notice tone='error'>{error.message}</Notice>;
  } else if (!added && data?.truncated) {
    body = <Notice>This file is binary or too large to edit in the browser.</Notice>;
  } else if (preview) {
    body = <MarkdownPreview source={text} onChange={(next) => onEdit(original, next)} />;
  } else {
    body = (
      <CodeEditor
        path={path}
        value={text}
        onChange={(next) => onEdit(original, next)}
        onCursorChange={onCursorChange}
        onSave={onSave}
        autoFocus={added}
        className='min-h-0 flex-1 overflow-hidden'
      />
    );
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex h-7 shrink-0 items-center gap-2 px-3'>
        <p className='text-muted-foreground flex min-w-0 flex-1 items-center gap-1 truncate text-xs'>
          {path.split('/').map((segment, index, segments) => (
            <span key={index} className='flex shrink-0 items-center gap-1'>
              {index > 0 && <Icons.chevronRight className='size-3' aria-hidden='true' />}
              <span className={cn(index === segments.length - 1 && 'text-foreground')}>
                {segment}
              </span>
            </span>
          ))}
          {diff && <span className='ml-1 shrink-0'>(Working Tree)</span>}
        </p>
        {diff && change?.kind !== 'deleted' && (
          <button
            type='button'
            onClick={onOpenFile}
            className='text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs'
          >
            <Icons.fileCode className='size-3.5' />
            Open File
          </button>
        )}
        {!diff && change && change.kind !== 'deleted' && (
          <button
            type='button'
            onClick={onOpenChanges}
            className='text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs'
          >
            <Icons.gitCompare className='size-3.5' />
            Open Changes
          </button>
        )}
        {!diff && isMarkdown(path) && change?.kind !== 'deleted' && (
          <button
            type='button'
            onClick={() => setPreview((value) => !value)}
            aria-pressed={preview}
            className='text-muted-foreground hover:text-foreground aria-pressed:text-primary flex items-center gap-1 text-xs'
          >
            {preview ? <Icons.code className='size-3.5' /> : <Icons.eye className='size-3.5' />}
            {preview ? 'Edit' : 'Preview'}
          </button>
        )}
      </div>
      {body}
    </div>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <p
      className={cn('p-4 text-sm', tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}
    >
      {children}
    </p>
  );
}

/** Rendered Markdown whose task checkboxes edit the source, like VS Code's preview. */
function MarkdownPreview({
  source,
  onChange
}: {
  source: string;
  onChange: (next: string) => void;
}) {
  const html = useMemo(
    () =>
      renderMarkdown(source).replace(/<input\b[^>]*\btype="checkbox"[^>]*>/g, (input) =>
        input.replace(/\sdisabled(?:="")?/g, '')
      ),
    [source]
  );

  function handleChange(event: React.FormEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
    const boxes = [...event.currentTarget.querySelectorAll('input[type="checkbox"]')];
    const index = boxes.indexOf(target);
    if (index >= 0) onChange(toggleMarkdownTask(source, index, target.checked));
  }

  return (
    <div onChange={handleChange} className='min-h-0 flex-1 overflow-auto px-6 py-4'>
      <div className='markdown-body' dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
