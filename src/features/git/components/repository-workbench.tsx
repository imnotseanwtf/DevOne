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
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import {
  createRepositoryBranchAction,
  createRepositoryFileAction,
  deleteRepositoryFileAction,
  saveRepositoryFileAction
} from '@/features/git/actions';
import { gitKeys, repositoryFileOptions, repositoryTreeOptions } from '@/features/git/api/queries';
import { languageLabel } from '@/features/git/components/code-editor';
import {
  ancestorsOf,
  baseName,
  diffTab,
  parseTab,
  validatePath,
  type Changes
} from '@/features/git/components/workbench/changes';
import { useRegisterBranchControl } from '@/features/git/components/workbench/branch-control';
import { BranchPicker } from '@/features/git/components/workbench/branch-picker';
import {
  CreateBranchDialog,
  type CreateBranchInput
} from '@/features/git/components/workbench/create-branch-dialog';
import { EditorArea } from '@/features/git/components/workbench/editor-area';
import { Explorer } from '@/features/git/components/workbench/explorer';
import { NameDialog, type NameDialogCopy } from '@/features/git/components/workbench/name-dialog';
import {
  BranchesPanel,
  HistoryPanel,
  PullRequestsPanel,
  SourceControlPanel,
  type PullRequestSummary
} from '@/features/git/components/workbench/side-panels';
import type { GitBranch, GitCommit, GitFileContent } from '@/lib/git/provider';
import { cn } from '@/lib/utils';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { parseAsString, useQueryState } from 'nuqs';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

export type WorkbenchPanel = 'explorer' | 'scm' | 'history' | 'branches' | 'pulls';

type Prompt = { kind: 'newFile'; folder: string } | { kind: 'rename'; path: string };

interface Confirmation {
  title: string;
  description: string;
  action: string;
  run: () => void;
}

interface RepositoryWorkbenchProps {
  repositoryId: string;
  repositoryName: string;
  provider: 'GITHUB' | 'GITLAB';
  webUrl: string;
  defaultBranch: string;
  branches: GitBranch[];
  commits: GitCommit[];
  pulls: PullRequestSummary[];
  initialPanel?: WorkbenchPanel;
  initialPath?: string;
}

/** A VS Code-style workbench over a linked repository; edits wait as local changes until committed. */
export function RepositoryWorkbench({
  repositoryId,
  repositoryName,
  provider,
  webUrl,
  defaultBranch,
  branches,
  commits,
  pulls,
  initialPanel = 'explorer',
  initialPath
}: RepositoryWorkbenchProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [branch, setBranch] = useQueryState(
    'ref',
    parseAsString.withDefault(defaultBranch).withOptions({ shallow: false })
  );
  const [panel, setPanel] = useState<WorkbenchPanel>(initialPanel);
  const [tabs, setTabs] = useState<string[]>(initialPath ? [initialPath] : []);
  const [activePath, setActivePath] = useState<string | null>(initialPath ?? null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(initialPath ? ancestorsOf(initialPath) : [])
  );
  const [changes, setChanges] = useState<Changes>({});
  const [message, setMessage] = useState('');
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Anywhere in the workbench, Ctrl+S goes to the commit box instead of saving the page.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 's' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setPanel('scm');
      requestAnimationFrame(() => messageRef.current?.focus());
    };
    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
  }, []);

  const changeCount = Object.keys(changes).length;

  function openFile(path: string) {
    setTabs((current) => (current.includes(path) ? current : [...current, path]));
    setActivePath(path);
  }

  /** Opens the side-by-side diff of a changed file, like clicking it in VS Code's Source Control. */
  function openChanges(path: string) {
    openFile(diffTab(path));
  }

  function closeTab(path: string) {
    const index = tabs.indexOf(path);
    if (index < 0) return;
    const next = tabs.filter((entry) => entry !== path);
    setTabs(next);
    if (activePath === path) setActivePath(next[Math.min(index, next.length - 1)] ?? null);
  }

  /** Keeps the tabs `keep` accepts; the active tab moves to the nearest survivor. */
  function closeTabs(keep: (tab: string, index: number) => boolean) {
    const next = tabs.filter(keep);
    setTabs(next);
    if (activePath && !next.includes(activePath)) {
      const index = tabs.indexOf(activePath);
      const after = tabs.slice(index + 1).find((tab) => next.includes(tab));
      setActivePath(after ?? next.at(-1) ?? null);
    }
  }

  /** Closes a file's editor and its diff, e.g. once the file is gone. */
  function closeFileTabs(path: string) {
    closeTabs((tab) => parseTab(tab).path !== path);
  }

  function reveal(path: string) {
    setExpanded((current) => new Set([...current, ...ancestorsOf(path)]));
  }

  function toggleFolder(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }

  function withoutChange(path: string) {
    setChanges(({ [path]: _removed, ...rest }) => rest);
  }

  function editFile(path: string, original: string | null, text: string) {
    setChanges((current) => {
      const { [path]: previous, ...rest } = current;
      if (previous?.kind === 'added')
        return { ...current, [path]: { kind: 'added', content: text } };
      return text === original ? rest : { ...rest, [path]: { kind: 'modified', content: text } };
    });
  }

  function createFile(path: string) {
    setChanges((current) => {
      const previous = current[path];
      if (previous && previous.kind !== 'deleted') return current;
      // Re-creating a file deleted in this session is an edit, not an addition.
      return {
        ...current,
        [path]: { kind: previous ? 'modified' : 'added', content: '' }
      };
    });
    reveal(path);
    openFile(path);
    setPanel('explorer');
  }

  async function renameFile(from: string, to: string) {
    if (from === to) return;
    const change = changes[from];
    let content: string;
    if (change && change.kind !== 'deleted') {
      content = change.content;
    } else {
      try {
        const file = await queryClient.fetchQuery(
          repositoryFileOptions(repositoryId, branch, from)
        );
        if (file.truncated) {
          toast.error(`${baseName(from)} is too large to rename in the browser`);
          return;
        }
        content = file.text;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Could not read ${from}`);
        return;
      }
    }

    setChanges((current) => {
      const next = { ...current };
      if (current[from]?.kind === 'added') delete next[from];
      else next[from] = { kind: 'deleted' };
      next[to] = { kind: current[to]?.kind === 'deleted' ? 'modified' : 'added', content };
      return next;
    });
    const renamed = (tab: string) =>
      tab === from ? to : tab === diffTab(from) ? diffTab(to) : tab;
    setTabs((current) => current.map(renamed));
    setActivePath((active) => (active ? renamed(active) : active));
    reveal(to);
  }

  /** Drag-and-drop in the explorer: the file keeps its name in `folder`. */
  function moveFile(from: string, folder: string) {
    const to = folder ? `${folder}/${baseName(from)}` : baseName(from);
    if (to === from) return;
    const local = changes[to];
    const remote = queryClient
      .getQueryData(repositoryTreeOptions(repositoryId, branch, folder).queryKey)
      ?.some((entry) => entry.path === to);
    if ((local && local.kind !== 'deleted') || (!local && remote)) {
      toast.error(`${folder || 'The root'} already has a ${baseName(from)}`);
      return;
    }
    void renameFile(from, to);
  }

  function deleteFile(path: string) {
    setChanges((current) => {
      const { [path]: previous, ...rest } = current;
      return previous?.kind === 'added' ? rest : { ...rest, [path]: { kind: 'deleted' } };
    });
    // A deleted file keeps its diff open (it shows the removal); its editor goes.
    if (changes[path]?.kind === 'added') closeFileTabs(path);
    else closeTab(path);
  }

  function discard(path: string) {
    // With nothing left to compare, the diff closes; a file that never existed closes too.
    if (changes[path]?.kind === 'added') closeFileTabs(path);
    else closeTab(diffTab(path));
    withoutChange(path);
  }

  /** Drops every change; files that only existed locally lose their tabs too. */
  function discardAll() {
    const remaining = tabs.filter((tab) => {
      const { path, diff } = parseTab(tab);
      return !diff && changes[path]?.kind !== 'added';
    });
    setTabs(remaining);
    if (activePath && !remaining.includes(activePath)) setActivePath(remaining.at(-1) ?? null);
    setChanges({});
  }

  function switchBranch(name: string) {
    if (name === branch) return;
    const go = () => {
      setChanges({});
      void setBranch(name);
    };
    if (changeCount === 0) return go();
    setConfirmation({
      title: `Switch to ${name}?`,
      description: `You have ${changeCount} uncommitted change${changeCount === 1 ? '' : 's'} on ${branch}. Switching branches discards them.`,
      action: 'Discard and switch',
      run: go
    });
  }

  useRegisterBranchControl({
    switchTo: switchBranch,
    create: () => setCreatingBranch(true),
    confirmLeave: (leave) => {
      if (changeCount === 0) return leave();
      setConfirmation({
        title: 'Leave this repository?',
        description: `You have ${changeCount} uncommitted change${changeCount === 1 ? '' : 's'} on ${branch}. Leaving discards them.`,
        action: 'Discard and leave',
        run: leave
      });
    }
  });

  function refresh() {
    void queryClient.invalidateQueries({
      queryKey: [...gitKeys.repository(repositoryId, branch), 'tree']
    });
    router.refresh();
  }

  function focusCommitMessage() {
    setPanel('scm');
    requestAnimationFrame(() => messageRef.current?.focus());
  }

  const commit = useMutation({
    mutationFn: async (input: { snapshot: Changes; branch: string; message: string }) => {
      const base = { repositoryId, branch: input.branch, message: input.message };
      const key = (path: string) => gitKeys.file(repositoryId, input.branch, path);
      const revisionOf = async (path: string) =>
        (await queryClient.fetchQuery(repositoryFileOptions(repositoryId, input.branch, path)))
          .revision;
      let committed = 0;

      // The providers' contents APIs take one file per commit, so push in
      // order and stop at the first failure; what landed leaves the list.
      for (const [path, change] of Object.entries(input.snapshot).toSorted(([a], [b]) =>
        a.localeCompare(b)
      )) {
        const result =
          change.kind === 'added'
            ? await createRepositoryFileAction({ ...base, path, content: change.content })
            : change.kind === 'modified'
              ? await saveRepositoryFileAction({
                  ...base,
                  path,
                  content: change.content,
                  revision: await revisionOf(path)
                })
              : await deleteRepositoryFileAction({
                  ...base,
                  path,
                  revision: await revisionOf(path)
                });
        if (!result.ok) throw new Error(result.error ?? `Could not commit ${path}`);

        if (change.kind === 'deleted') {
          queryClient.removeQueries({ queryKey: key(path) });
        } else if (result.revision) {
          queryClient.setQueryData<GitFileContent>(key(path), {
            path,
            text: change.content,
            truncated: false,
            revision: result.revision
          });
        }
        // Keep anything edited again while this commit was in flight.
        setChanges((current) => {
          if (current[path] !== change) return current;
          const { [path]: _committed, ...rest } = current;
          return rest;
        });
        committed++;
      }
      return committed;
    },
    onSuccess: (committed, input) => {
      setMessage('');
      // Committed changes have nothing left to compare.
      setTabs((current) => current.filter((tab) => !parseTab(tab).diff));
      setActivePath((active) => (active && parseTab(active).diff ? parseTab(active).path : active));
      toast.success(`Pushed ${committed} change${committed === 1 ? '' : 's'} to ${input.branch}`);
    },
    onError: (error) => toast.error(error.message),
    onSettled: refresh
  });

  function commitAll() {
    if (changeCount === 0 || !message.trim() || commit.isPending) return;
    commit.mutate({ snapshot: changes, branch, message: message.trim() });
  }

  const createBranch = useMutation({
    mutationFn: async (input: CreateBranchInput) => {
      const result = await createRepositoryBranchAction({ repositoryId, ...input });
      if (!result.ok) throw new Error(result.error);
      return input;
    },
    onSuccess: ({ name, from }) => {
      setCreatingBranch(false);
      toast.success(`Created ${name} from ${from}`);
      // Branching from the current branch starts at the same files, so local
      // changes carry over; any other source would leave them pointing nowhere.
      if (from !== branch) discardAll();
      void setBranch(name);
    },
    onError: (error) => toast.error(error.message)
  });

  const promptCopy: NameDialogCopy | null =
    prompt?.kind === 'newFile'
      ? {
          title: 'New file',
          description: `Folders in the path are created with the file. Nothing is pushed until you commit.`,
          label: 'File path',
          action: 'Create',
          value: prompt.folder ? `${prompt.folder}/` : ''
        }
      : prompt?.kind === 'rename'
        ? {
            title: `Rename ${baseName(prompt.path)}`,
            description:
              'Moving to another folder works too. The rename is committed as a delete and an add.',
            label: 'New path',
            action: 'Rename',
            value: prompt.path
          }
        : null;

  function validatePrompt(value: string) {
    const problem = validatePath(value);
    if (problem) return problem;
    const existing = changes[value.replace(/^\/+/, '')];
    if (prompt?.kind === 'rename' && existing && existing.kind !== 'deleted') {
      return `${value} already has changes`;
    }
    return null;
  }

  function submitPrompt(value: string) {
    if (!prompt) return;
    const path = value.replace(/^\/+/, '');
    setPrompt(null);
    if (prompt.kind === 'newFile') createFile(path);
    else void renameFile(prompt.path, path);
  }

  const commitUrl = (sha: string) =>
    provider === 'GITHUB' ? `${webUrl}/commit/${sha}` : `${webUrl}/-/commit/${sha}`;

  const activities: { id: WorkbenchPanel; label: string; icon: React.ReactNode; badge?: number }[] =
    [
      { id: 'explorer', label: 'Explorer', icon: <Icons.files /> },
      {
        id: 'scm',
        label: 'Source control',
        icon: <Icons.gitBranch />,
        badge: changeCount
      },
      { id: 'history', label: 'History', icon: <Icons.history /> },
      { id: 'branches', label: 'Branches', icon: <Icons.gitCommit /> },
      {
        id: 'pulls',
        label: 'Pull requests',
        icon: <Icons.gitPullRequest />,
        badge: pulls.filter((pull) => pull.state !== 'merged' && pull.state !== 'closed').length
      }
    ];

  return (
    <div
      ref={rootRef}
      className='bg-background flex h-[calc(100svh-12rem)] min-h-[34rem] flex-col overflow-hidden rounded-lg border shadow-sm'
    >
      <div className='flex min-h-0 flex-1'>
        <nav
          aria-label='Workbench'
          className='bg-muted/50 flex w-12 shrink-0 flex-col items-center gap-1 border-r py-1.5'
        >
          {activities.map((activity) => (
            <button
              key={activity.id}
              type='button'
              onClick={() => setPanel(activity.id)}
              aria-label={activity.label}
              aria-pressed={panel === activity.id}
              title={activity.label}
              className={cn(
                'relative grid size-10 place-items-center [&_svg]:size-5',
                panel === activity.id
                  ? 'text-foreground before:bg-primary before:absolute before:inset-y-1 before:left-[-4px] before:w-0.5'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {activity.icon}
              {Boolean(activity.badge) && (
                <span className='bg-primary text-primary-foreground absolute right-1 bottom-1 min-w-4 rounded-full px-1 text-center text-[10px] leading-4'>
                  {activity.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <ResizablePanelGroup orientation='horizontal' className='min-h-0 flex-1'>
          <ResizablePanel defaultSize='24%' minSize='14%' maxSize='45%'>
            <div className='bg-muted/25 h-full'>
              {panel === 'explorer' && (
                <Explorer
                  repositoryId={repositoryId}
                  repositoryName={repositoryName}
                  reference={branch}
                  activePath={activePath && parseTab(activePath).path}
                  expanded={expanded}
                  changes={changes}
                  onOpen={openFile}
                  onToggle={toggleFolder}
                  onNewFile={(folder) => setPrompt({ kind: 'newFile', folder })}
                  onRename={(path) => setPrompt({ kind: 'rename', path })}
                  onDelete={deleteFile}
                  onMove={moveFile}
                  onRefresh={refresh}
                  onCollapseAll={() => setExpanded(new Set())}
                />
              )}
              {panel === 'scm' && (
                <SourceControlPanel
                  messageRef={messageRef}
                  branch={branch}
                  changes={changes}
                  message={message}
                  onMessageChange={setMessage}
                  committing={commit.isPending}
                  onCommit={commitAll}
                  onOpen={openChanges}
                  onDiscard={discard}
                  onDiscardAll={() =>
                    setConfirmation({
                      title: 'Discard all changes?',
                      description: `This drops ${changeCount} uncommitted change${changeCount === 1 ? '' : 's'}. It cannot be undone.`,
                      action: 'Discard all',
                      run: discardAll
                    })
                  }
                />
              )}
              {panel === 'history' && (
                <HistoryPanel branch={branch} commits={commits} commitUrl={commitUrl} />
              )}
              {panel === 'branches' && (
                <BranchesPanel
                  branch={branch}
                  defaultBranch={defaultBranch}
                  branches={branches}
                  onSwitch={switchBranch}
                  onCreate={() => setCreatingBranch(true)}
                />
              )}
              {panel === 'pulls' && (
                <PullRequestsPanel pulls={pulls} branches={branches} onSwitch={switchBranch} />
              )}
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel minSize='40%'>
            <EditorArea
              repositoryId={repositoryId}
              reference={branch}
              tabs={tabs}
              activePath={activePath}
              changes={changes}
              onActivate={setActivePath}
              onClose={closeTab}
              onCloseOthers={(tab) => closeTabs((entry) => entry === tab)}
              onCloseToRight={(tab) => closeTabs((_, index) => index <= tabs.indexOf(tab))}
              onCloseUnchanged={() => closeTabs((tab) => Boolean(changes[parseTab(tab).path]))}
              onCloseAll={() => closeTabs(() => false)}
              onOpenFile={openFile}
              onOpenChanges={openChanges}
              onReveal={(path) => {
                reveal(path);
                setPanel('explorer');
              }}
              onRename={(path) => setPrompt({ kind: 'rename', path })}
              onDiscard={discard}
              onEdit={editFile}
              onCursorChange={(line, column) => setCursor([line, column])}
              onSave={focusCommitMessage}
              onNewFile={() => setPrompt({ kind: 'newFile', folder: '' })}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <footer className='bg-primary text-primary-foreground flex h-6 shrink-0 items-center text-xs [&>*]:px-2'>
        <BranchPicker
          branches={branches}
          current={branch}
          onSelect={switchBranch}
          onCreate={() => setCreatingBranch(true)}
          side='top'
          trigger={
            <button
              type='button'
              aria-label={`Branch ${branch}, switch branch`}
              className='hover:bg-primary-foreground/15 flex h-full items-center gap-1 [&_svg]:size-3.5'
            />
          }
        />
        <button
          type='button'
          onClick={refresh}
          aria-label='Refresh from the provider'
          title='Refresh from the provider'
          className='hover:bg-primary-foreground/15 flex h-full items-center'
        >
          <Icons.refresh className={cn('size-3.5', commit.isPending && 'animate-spin')} />
        </button>
        {changeCount > 0 && (
          <button
            type='button'
            onClick={() => setPanel('scm')}
            className='hover:bg-primary-foreground/15 flex h-full items-center gap-1'
          >
            <Icons.edit className='size-3.5' aria-hidden='true' />
            {changeCount} change{changeCount === 1 ? '' : 's'}
          </button>
        )}
        {commit.isPending && <span>Pushing…</span>}
        <span className='ml-auto' />
        {activePath && cursor && (
          <span>
            Ln {cursor[0]}, Col {cursor[1]}
          </span>
        )}
        {activePath && <span>{languageLabel(parseTab(activePath).path)}</span>}
        <span>{provider === 'GITHUB' ? 'GitHub' : 'GitLab'}</span>
      </footer>

      <NameDialog
        key={prompt ? JSON.stringify(prompt) : 'closed'}
        copy={promptCopy}
        validate={validatePrompt}
        onClose={() => setPrompt(null)}
        onSubmit={submitPrompt}
      />

      <CreateBranchDialog
        key={creatingBranch ? `open:${branch}` : 'closed'}
        open={creatingBranch}
        branches={branches}
        current={branch}
        defaultBranch={defaultBranch}
        changeCount={changeCount}
        pending={createBranch.isPending}
        onClose={() => setCreatingBranch(false)}
        onSubmit={(input) => createBranch.mutate(input)}
      />

      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                confirmation?.run();
                setConfirmation(null);
              }}
            >
              {confirmation?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
