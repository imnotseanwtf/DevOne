'use client';

import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PanelAction, PanelHeader } from '@/features/git/components/workbench/explorer';
import {
  baseName,
  CHANGE_COLOR,
  CHANGE_LETTER,
  parentOf,
  type Changes
} from '@/features/git/components/workbench/changes';
import type { GitBranch, GitCommit, GitMergeRequest } from '@/lib/git/provider';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface SourceControlProps {
  branch: string;
  changes: Changes;
  message: string;
  onMessageChange: (message: string) => void;
  committing: boolean;
  onCommit: () => void;
  onOpen: (path: string) => void;
  onDiscard: (path: string) => void;
  onDiscardAll: () => void;
  messageRef?: React.Ref<HTMLTextAreaElement>;
}

export function SourceControlPanel({
  branch,
  changes,
  message,
  onMessageChange,
  committing,
  onCommit,
  onOpen,
  onDiscard,
  onDiscardAll,
  messageRef
}: SourceControlProps) {
  const paths = Object.keys(changes).toSorted();
  const canCommit = paths.length > 0 && message.trim().length > 0 && !committing;

  return (
    <div className='flex h-full flex-col'>
      <PanelHeader title='Source control'>
        <PanelAction
          label='Discard all changes'
          onClick={onDiscardAll}
          disabled={paths.length === 0 || committing}
        >
          <Icons.discard />
        </PanelAction>
      </PanelHeader>
      <div className='flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-3 pb-3'>
        <Textarea
          ref={messageRef}
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canCommit) {
              event.preventDefault();
              onCommit();
            }
          }}
          placeholder={`Message (Ctrl+Enter to commit on "${branch}")`}
          aria-label='Commit message'
          className='min-h-16 resize-y text-xs'
        />
        <Button size='sm' disabled={!canCommit} onClick={onCommit}>
          {committing ? (
            <Icons.spinner className='animate-spin' aria-hidden='true' />
          ) : (
            <Icons.check aria-hidden='true' />
          )}
          Commit &amp; push
        </Button>
        <p className='text-muted-foreground pt-1 text-[11px] font-semibold uppercase'>
          Changes · {paths.length}
        </p>
        {paths.length === 0 ? (
          <p className='text-muted-foreground text-xs'>
            Edit, add, rename or delete files in the explorer. Changes wait here until you commit.
          </p>
        ) : (
          <ul className='-mx-3 text-[13px]'>
            {paths.map((path) => {
              const change = changes[path];
              return (
                <li key={path} className='group hover:bg-muted flex items-center gap-1 px-3'>
                  <button
                    type='button'
                    onClick={() => onOpen(path)}
                    className='flex min-w-0 flex-1 items-center gap-1.5 py-[3px] text-left'
                    title={path}
                  >
                    <Icons.fileCode className='size-4 shrink-0' aria-hidden='true' />
                    <span className={cn('truncate', change.kind === 'deleted' && 'line-through')}>
                      {baseName(path)}
                    </span>
                    <span className='text-muted-foreground truncate text-xs'>{parentOf(path)}</span>
                  </button>
                  <span className='hidden group-focus-within:flex group-hover:flex'>
                    <PanelAction
                      label={`Discard changes to ${path}`}
                      onClick={() => onDiscard(path)}
                    >
                      <Icons.discard />
                    </PanelAction>
                  </span>
                  <span className={cn('w-3 text-xs font-semibold', CHANGE_COLOR[change.kind])}>
                    {CHANGE_LETTER[change.kind]}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function HistoryPanel({
  branch,
  commits,
  commitUrl
}: {
  branch: string;
  commits: GitCommit[];
  commitUrl: (sha: string) => string;
}) {
  return (
    <div className='flex h-full flex-col'>
      <PanelHeader title={`History · ${branch}`} />
      <div className='min-h-0 flex-1 overflow-auto pb-3'>
        {commits.length === 0 ? (
          <p className='text-muted-foreground px-3 text-xs'>No commits on this branch.</p>
        ) : (
          <ol className='text-[13px]'>
            {commits.map((commit) => (
              <li key={commit.sha}>
                <a
                  href={commitUrl(commit.sha)}
                  target='_blank'
                  rel='noreferrer noopener'
                  className='hover:bg-muted flex gap-2 px-3 py-1.5'
                >
                  <Icons.gitCommit
                    className='text-muted-foreground mt-0.5 size-4 shrink-0'
                    aria-hidden='true'
                  />
                  <span className='min-w-0'>
                    <span className='block truncate'>{commit.message.split('\n')[0]}</span>
                    <span className='text-muted-foreground block truncate text-xs'>
                      <code>{commit.sha.slice(0, 7)}</code> · {commit.authorName} ·{' '}
                      {formatDistanceToNow(commit.committedAt, { addSuffix: true })}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export function BranchesPanel({
  branch,
  defaultBranch,
  branches,
  onSwitch,
  onCreate
}: {
  branch: string;
  defaultBranch: string;
  branches: GitBranch[];
  onSwitch: (name: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className='flex h-full flex-col'>
      <PanelHeader title='Branches'>
        <PanelAction label='Create branch' onClick={onCreate}>
          <Icons.add />
        </PanelAction>
      </PanelHeader>
      <ul className='min-h-0 flex-1 overflow-auto pb-3 text-[13px]'>
        {branches.map((entry) => (
          <li key={entry.name}>
            <button
              type='button'
              onClick={() => onSwitch(entry.name)}
              aria-current={entry.name === branch ? 'true' : undefined}
              className='hover:bg-muted aria-[current=true]:bg-primary/10 flex w-full items-center gap-1.5 px-3 py-[3px] text-left'
            >
              <Icons.gitBranch className='size-4 shrink-0' aria-hidden='true' />
              <span className='truncate'>{entry.name}</span>
              {entry.name === defaultBranch && (
                <Badge variant='outline' className='h-4 px-1 text-[10px]'>
                  default
                </Badge>
              )}
              {entry.name === branch ? (
                <Icons.check className='ml-auto size-4 shrink-0' aria-hidden='true' />
              ) : (
                <code className='text-muted-foreground ml-auto text-[10px]'>
                  {entry.sha.slice(0, 7)}
                </code>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface PullRequestSummary extends GitMergeRequest {
  migrationCount: number;
}

export function PullRequestsPanel({
  pulls,
  branches,
  onSwitch
}: {
  pulls: PullRequestSummary[];
  branches: GitBranch[];
  onSwitch: (name: string) => void;
}) {
  const branchNames = new Set(branches.map((entry) => entry.name));

  return (
    <div className='flex h-full flex-col'>
      <PanelHeader title='Pull requests' />
      <div className='min-h-0 flex-1 overflow-auto pb-3'>
        {pulls.length === 0 ? (
          <p className='text-muted-foreground px-3 text-xs'>No pull requests yet.</p>
        ) : (
          <ul className='text-[13px]'>
            {pulls.map((pull) => (
              <li key={pull.number} className='hover:bg-muted space-y-1 px-3 py-1.5'>
                <a
                  href={pull.webUrl}
                  target='_blank'
                  rel='noreferrer noopener'
                  className='flex items-start gap-1.5 hover:underline'
                >
                  <Icons.gitPullRequest
                    className={cn(
                      'mt-0.5 size-4 shrink-0',
                      pull.state === 'merged'
                        ? 'text-violet-600'
                        : pull.state === 'closed'
                          ? 'text-red-600'
                          : 'text-emerald-600'
                    )}
                    aria-hidden='true'
                  />
                  <span className='min-w-0'>
                    #{pull.number} {pull.title}
                  </span>
                </a>
                <div className='text-muted-foreground flex flex-wrap items-center gap-1.5 pl-5 text-xs'>
                  <span>{pull.author}</span>·
                  {branchNames.has(pull.sourceBranch) ? (
                    <button
                      type='button'
                      onClick={() => onSwitch(pull.sourceBranch)}
                      className='hover:text-foreground underline-offset-2 hover:underline'
                      title={`Switch to ${pull.sourceBranch}`}
                    >
                      {pull.sourceBranch}
                    </button>
                  ) : (
                    <span>{pull.sourceBranch}</span>
                  )}
                  → {pull.targetBranch}
                  {pull.migrationCount > 0 && (
                    <Badge variant='secondary' className='h-4 px-1 text-[10px]'>
                      {pull.migrationCount} migration{pull.migrationCount === 1 ? '' : 's'}
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
