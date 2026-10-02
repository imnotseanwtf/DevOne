'use client';

import { Icons } from '@/components/icons';
import { getIssueHistoryAction, type IssueHistoryEntry } from '@/features/issues/actions';
import { formatTimeAgo } from '@/lib/format';
import { useEffect, useState } from 'react';

const dayFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});
const timeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

/** The stages a status event can be in; BACKLOG is the reserved "no column" status. */
function stageName(status: string | null): string {
  if (!status) return '—';
  return status === 'BACKLOG' ? 'Backlog' : status;
}

function formatDay(value: string | null): string {
  return value ? dayFormat.format(new Date(`${value}T00:00:00Z`)) : 'none';
}

/** "3d 4h", "2h 5m", "40m": how long a task sat in a stage. */
function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function describe(entry: IssueHistoryEntry): React.ReactNode {
  switch (entry.type) {
    case 'CREATED':
      return (
        <>
          Created in <strong>{stageName(entry.toValue)}</strong>
        </>
      );
    case 'STATUS':
      return (
        <>
          Moved <strong>{stageName(entry.fromValue)}</strong>
          <Icons.arrowRight className='mx-1 inline size-3' aria-label='to' />
          <strong>{stageName(entry.toValue)}</strong>
        </>
      );
    case 'ASSIGNEE':
      return entry.toValue ? (
        <>
          Assigned to <strong>{entry.toValue}</strong>
          {entry.fromValue && <> (was {entry.fromValue})</>}
        </>
      ) : (
        <>Unassigned {entry.fromValue && <>(was {entry.fromValue})</>}</>
      );
    case 'PRIORITY':
      return (
        <>
          Priority <strong>{entry.fromValue}</strong>
          <Icons.arrowRight className='mx-1 inline size-3' aria-label='to' />
          <strong>{entry.toValue}</strong>
        </>
      );
    case 'TARGET_DATE':
      return entry.toValue ? (
        <>
          Target date set to <strong>{formatDay(entry.toValue)}</strong>
          {entry.fromValue && <> (was {formatDay(entry.fromValue)})</>}
        </>
      ) : (
        <>Target date removed (was {formatDay(entry.fromValue)})</>
      );
    case 'ARCHIVED':
      return <>Deleted to the archive</>;
    case 'RESTORED':
      return (
        <>
          Restored to <strong>{stageName(entry.toValue)}</strong>
        </>
      );
  }
}

/**
 * A task's history: every move between stages, with who made it, when, and
 * how long the task had been in the stage it left.
 */
export function IssueHistory({ issueId, refreshKey }: { issueId: string; refreshKey: string }) {
  const [history, setHistory] = useState<IssueHistoryEntry[] | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void getIssueHistoryAction({ issueId }).then((result) => {
      if (cancelled) return;
      if (!result.ok || !result.history) {
        setError(result.error ?? 'Could not load the history');
        return;
      }
      setError(undefined);
      setHistory(result.history);
    });
    return () => {
      cancelled = true;
    };
    // refreshKey changes when the task does, so a move shows up straight away.
  }, [issueId, refreshKey]);

  if (error) return <p className='text-destructive text-xs'>{error}</p>;
  if (!history) {
    return (
      <p className='text-muted-foreground flex items-center gap-2 text-xs'>
        <Icons.spinner className='size-3.5 animate-spin' /> Loading history…
      </p>
    );
  }

  // Time in a stage: from the entry that put the task there to the one that moved it on.
  let enteredStageAt: number | null = null;
  const rows = history.map((entry) => {
    const at = new Date(entry.createdAt).getTime();
    let stayed: number | null = null;
    if (entry.type === 'STATUS' || entry.type === 'ARCHIVED') {
      if (enteredStageAt !== null) stayed = at - enteredStageAt;
    }
    if (entry.type === 'CREATED' || entry.type === 'STATUS' || entry.type === 'RESTORED') {
      enteredStageAt = at;
    }
    return { entry, stayed };
  });

  return (
    <ol className='relative space-y-3 border-l pl-4'>
      {rows.toReversed().map(({ entry, stayed }) => (
        <li key={entry.id} className='relative text-sm'>
          <span
            aria-hidden='true'
            className='bg-background border-muted-foreground/40 absolute top-1.5 -left-[1.3rem] size-2.5 rounded-full border-2'
          />
          <p>{describe(entry)}</p>
          <p className='text-muted-foreground text-xs'>
            {entry.viaGit ? 'Via a linked branch or pull request' : (entry.actor ?? 'Someone')}
            {' · '}
            <time dateTime={entry.createdAt} title={timeFormat.format(new Date(entry.createdAt))}>
              {formatTimeAgo(new Date(entry.createdAt))}
            </time>
            {stayed !== null && <> · after {formatDuration(stayed)} there</>}
          </p>
        </li>
      ))}
    </ol>
  );
}
