'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import {
  CHIP,
  DotBadge,
  DropLine,
  initials,
  IssueActionsButton,
  IssueContextMenuContent,
  PriorityChip,
  StatusIcon,
  statusLabel,
  TargetDateChip
} from '@/features/issues/components/board-card';
import type { BoardIssue } from '@/features/issues/components/issue-board';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export interface ListSection {
  /** Column id, or 'BACKLOG'. */
  id: string;
  /** The status tasks in this section have. */
  status: string;
  color: string | null;
  issues: BoardIssue[];
}

/** The board's drag-and-drop, shared so rows drag exactly like cards. */
export interface ListDnd {
  draggingId: string | null;
  /** Where a dragged task would land, if over this view. */
  hint: { status: string; anchorId: string | null; side: 'before' | 'after' } | null;
  startCardDrag: (event: React.DragEvent, issueId: string) => void;
  endDrag: () => void;
  hoverCard: (event: React.DragEvent, status: string, issueId: string, axis: 'x' | 'y') => void;
  hoverColumn: (event: React.DragEvent, columnId: string, status: string) => void;
  clearHintOnLeave: (event: React.DragEvent<HTMLElement>) => void;
  drop: (event: React.DragEvent) => void;
}

interface BoardListViewProps {
  sections: ListSection[];
  statuses: string[];
  typeColor: (type: string) => string | null | undefined;
  priorityColor: (priority: string) => string | null | undefined;
  dnd: ListDnd;
  onOpen: (issueId: string) => void;
  onMove: (issueId: string, status: string) => void;
  onDelete: (issueId: string) => void;
  onCreate: (status: string) => void;
}

/** Every status as a collapsible section of one-line task rows. */
export function BoardListView({
  sections,
  statuses,
  typeColor,
  priorityColor,
  dnd,
  onOpen,
  onMove,
  onDelete,
  onCreate
}: BoardListViewProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className='space-y-3'>
      {sections.map((section) => {
        const isCollapsed = collapsed[section.id] ?? false;
        const sectionHint = dnd.hint?.status === section.status ? dnd.hint : null;
        return (
          <section
            key={section.id}
            aria-label={statusLabel(section.status)}
            onDragOver={(event) => dnd.hoverColumn(event, section.id, section.status)}
            onDragLeave={dnd.clearHintOnLeave}
            onDrop={dnd.drop}
            className={cn(
              'border-border/70 bg-muted/40 dark:bg-card/90 overflow-hidden rounded-xl border shadow-xs/5 transition-[background-color,border-color,box-shadow] duration-150',
              sectionHint && 'bg-accent/60 border-ring/40 ring-ring/30 ring-2'
            )}
          >
            <div className='flex items-center gap-2 px-3 py-2'>
              <button
                type='button'
                className='hover:bg-muted -ml-1 flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left'
                aria-expanded={!isCollapsed}
                onClick={() =>
                  setCollapsed((current) => ({ ...current, [section.id]: !isCollapsed }))
                }
              >
                <Icons.chevronRight
                  aria-hidden='true'
                  className={cn(
                    'text-muted-foreground size-3.5 shrink-0 transition-transform',
                    !isCollapsed && 'rotate-90'
                  )}
                />
                <StatusIcon name={section.status} color={section.color} />
                <span className='text-foreground/95 truncate text-sm font-medium'>
                  {statusLabel(section.status)}
                </span>
                <span className='bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums'>
                  {section.issues.length}
                </span>
              </button>
              <Button
                variant='ghost'
                size='icon-xs'
                className='text-muted-foreground'
                aria-label={`Add a task to ${statusLabel(section.status)}`}
                title='Add task'
                onClick={() => onCreate(section.status)}
              >
                <Icons.add />
              </Button>
            </div>
            {!isCollapsed && (
              <ul className='border-border/60 bg-background divide-border/60 divide-y border-t'>
                {section.issues.map((issue) => (
                  <li key={issue.id} className='relative'>
                    {sectionHint?.anchorId === issue.id && dnd.draggingId !== issue.id && (
                      <DropLine side={sectionHint.side} axis='y' />
                    )}
                    <IssueRow
                      issue={issue}
                      statuses={statuses}
                      typeColor={typeColor(issue.type)}
                      priorityColor={priorityColor(issue.priority)}
                      dragging={dnd.draggingId === issue.id}
                      onDragStart={(event) => dnd.startCardDrag(event, issue.id)}
                      onDragEnd={dnd.endDrag}
                      onDragOver={(event) => dnd.hoverCard(event, section.status, issue.id, 'y')}
                      onOpen={() => onOpen(issue.id)}
                      onMove={(status) => onMove(issue.id, status)}
                      onDelete={() => onDelete(issue.id)}
                    />
                  </li>
                ))}
                {section.issues.length > 0 && sectionHint?.anchorId === null && (
                  <li className='relative h-0' aria-hidden='true'>
                    <DropLine side='before' axis='y' />
                  </li>
                )}
                {section.issues.length === 0 && (
                  <li className='text-muted-foreground px-4 py-3 text-xs'>
                    {sectionHint ? 'Drop here' : 'No tasks'}
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

interface IssueRowProps {
  issue: BoardIssue;
  statuses: string[];
  typeColor?: string | null;
  priorityColor?: string | null;
  dragging: boolean;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onOpen: () => void;
  onMove: (status: string) => void;
  onDelete: () => void;
}

/** One task on one line: priority, key, title, type, activity, date, assignee. */
function IssueRow({
  issue,
  statuses,
  typeColor,
  priorityColor,
  dragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onOpen,
  onMove,
  onDelete
}: IssueRowProps) {
  const others = statuses.filter((status) => status !== issue.status);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<div />}
        draggable
        tabIndex={0}
        role='button'
        aria-label={`${issue.issueKey}: ${issue.title}`}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button,a,[role=menu]')) return;
          onOpen();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.target === event.currentTarget) onOpen();
        }}
        className={cn(
          'group hover:bg-muted/50 focus-visible:bg-muted/60 flex cursor-pointer items-center gap-3 px-4 py-2 outline-none select-none',
          dragging && 'opacity-40'
        )}
      >
        <PriorityChip name={issue.priority} color={priorityColor} />
        <span className='text-muted-foreground w-16 shrink-0 font-mono text-xs'>
          {issue.issueKey}
        </span>
        <span className='text-foreground min-w-0 flex-1 truncate text-sm'>{issue.title}</span>
        <span className='hidden items-center gap-1.5 md:flex'>
          <DotBadge color={typeColor}>{issue.type.toLowerCase()}</DotBadge>
          {issue.gitLinkCount > 0 && (
            <span
              className={CHIP}
              title={`${issue.gitLinkCount} linked branches or merge requests`}
            >
              <Icons.gitBranch className='size-3' aria-hidden='true' />
              {issue.gitLinkCount}
            </span>
          )}
          {(issue.commentCount ?? 0) > 0 && (
            <span className={CHIP} title={`${issue.commentCount} comments`}>
              <Icons.comment className='size-3' aria-hidden='true' />
              {issue.commentCount}
            </span>
          )}
        </span>
        {issue.targetDate && <TargetDateChip date={issue.targetDate} status={issue.status} />}
        {issue.assignee ? (
          <span
            className='bg-muted text-foreground/80 flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold'
            title={`Assigned to ${issue.assigneeName ?? issue.assignee} (@${issue.assignee})`}
          >
            {initials(issue.assignee, issue.assigneeName)}
          </span>
        ) : (
          <span
            className='border-border text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed text-[10px]'
            title='Unassigned'
          >
            ?
          </span>
        )}
        <IssueActionsButton
          issue={issue}
          others={others}
          onOpen={onOpen}
          onMove={onMove}
          onDelete={onDelete}
          className='shrink-0'
        />
      </ContextMenuTrigger>
      <IssueContextMenuContent
        others={others}
        onOpen={onOpen}
        onMove={onMove}
        onDelete={onDelete}
      />
    </ContextMenu>
  );
}
