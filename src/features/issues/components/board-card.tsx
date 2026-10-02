'use client';

import { Icons, type Icon } from '@/components/icons';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import type { BoardIssue } from '@/features/issues/components/issue-board';
import {
  defaultStatusIcon,
  isStatusIconName,
  type StatusIconName
} from '@/features/issues/status-icons';
import { cn } from '@/lib/utils';
import { createContext, useContext } from 'react';

/** Column names that mean the work is finished, so a past date isn't "overdue". */
export const DONE_STAGE = /^(done|closed|complete|completed|resolved|shipped|released)$/i;

/** Today as YYYY-MM-DD in the viewer's time zone, to compare with a target date. */
function todayString(offsetDays = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const chipFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
});

/** The small rounded chips along a card's bottom edge. */
export const CHIP =
  'inline-flex h-5.5 shrink-0 items-center gap-1 rounded border border-border/70 bg-muted/55 px-2 text-[10px] font-medium text-muted-foreground tabular-nums';

const STATUS_ICON_COMPONENTS: Record<StatusIconName, Icon> = {
  todo: Icons.statusTodo,
  backlog: Icons.statusBacklog,
  triage: Icons.statusTriage,
  started: Icons.statusStarted,
  progress: Icons.statusProgress,
  review: Icons.statusReview,
  testing: Icons.statusTesting,
  blocked: Icons.statusBlocked,
  ready: Icons.statusReady,
  done: Icons.statusDone,
  doneFilled: Icons.statusDoneFilled,
  verified: Icons.statusVerified,
  cancelled: Icons.statusCancelled,
  paused: Icons.statusPaused
};

export interface StatusAppearance {
  color: string | null;
  icon: string | null;
}

/** Each status's chosen colour and icon, by status name, for every StatusIcon on the board. */
const StatusAppearanceContext = createContext<ReadonlyMap<string, StatusAppearance>>(new Map());
export const StatusAppearanceProvider = StatusAppearanceContext.Provider;

/** The circle icon of a status: the one chosen for it, else one picked from its name. */
export function StatusIcon({
  name,
  color,
  icon,
  className
}: {
  name: string;
  color?: string | null;
  icon?: string | null;
  className?: string;
}) {
  const appearance = useContext(StatusAppearanceContext).get(name);
  const chosen = icon ?? appearance?.icon;
  const tint = color ?? appearance?.color;
  const Icon = STATUS_ICON_COMPONENTS[isStatusIconName(chosen) ? chosen : defaultStatusIcon(name)];
  return (
    <Icon
      aria-hidden='true'
      className={cn('size-4 shrink-0', !tint && 'text-muted-foreground', className)}
      style={tint ? { color: tint } : undefined}
    />
  );
}

/** Renders one status icon by its stored name, for pickers. */
export function StatusIconGlyph({ icon, className }: { icon: StatusIconName; className?: string }) {
  const Glyph = STATUS_ICON_COMPONENTS[icon];
  return <Glyph aria-hidden='true' className={cn('size-4 shrink-0', className)} />;
}

/** Priorities are named per project; the usual names get an arrow, others their colour. */
export function PriorityChip({ name, color }: { name: string; color?: string | null }) {
  const key = name.toUpperCase();
  const known =
    key === 'CRITICAL' || key === 'URGENT'
      ? {
          Icon: Icons.priorityUrgent,
          tone: 'border-destructive/20 bg-destructive/10 text-destructive'
        }
      : key === 'HIGH'
        ? {
            Icon: Icons.priorityHigh,
            tone: 'border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-400'
          }
        : key === 'MEDIUM'
          ? {
              Icon: Icons.priorityMedium,
              tone: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400'
            }
          : key === 'LOW'
            ? {
                Icon: Icons.priorityLow,
                tone: 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-400'
              }
            : null;
  // "MEDIUM" → "Medium", "needs_triage" → "Needs triage".
  const label = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase().replaceAll('_', ' ');
  return (
    <span className={cn(CHIP, known?.tone)} title={`Priority: ${label}`}>
      {known ? (
        <known.Icon className='size-3' aria-hidden='true' />
      ) : (
        <span
          aria-hidden='true'
          className='bg-muted-foreground size-1.5 rounded-full'
          style={color ? { backgroundColor: color } : undefined}
        />
      )}
      {label}
    </span>
  );
}

/** A card's target date: red once it has passed, amber when it's within three days. */
export function TargetDateChip({ date, status }: { date: string; status: string }) {
  const finished = DONE_STAGE.test(status);
  const overdue = !finished && date < todayString();
  const soon = !finished && !overdue && date <= todayString(3);
  const Icon = overdue ? Icons.calendarOverdue : soon ? Icons.calendarSoon : Icons.calendar;
  return (
    <span
      className={cn(
        CHIP,
        'border-transparent',
        overdue && 'bg-destructive/10 text-destructive',
        soon && 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      )}
      title={overdue ? 'Past its target date' : soon ? 'Due soon' : 'Target date'}
    >
      <Icon className='size-3' aria-hidden='true' />
      {chipFormat.format(new Date(`${date}T00:00:00Z`))}
    </span>
  );
}

/** A label-style badge with a colour dot, used for the task type. */
export function DotBadge({
  color,
  children
}: {
  color?: string | null;
  children: React.ReactNode;
}) {
  return (
    <span className='border-border inline-flex max-w-full min-w-0 items-center rounded-md border px-2 py-0.5 text-[10px] font-medium'>
      <span
        aria-hidden='true'
        className='bg-muted-foreground mr-1 size-1.5 shrink-0 rounded-full'
        style={color ? { backgroundColor: color } : undefined}
      />
      <span className='truncate'>{children}</span>
    </span>
  );
}

export function initials(username: string, name: string | null): string {
  const source = (name ?? username).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts.at(-1)![0] : source.slice(0, 2)).toUpperCase();
}

interface IssueCardProps {
  issue: BoardIssue;
  typeColor?: string | null;
  priorityColor?: string | null;
  /** Statuses the card can be moved to from its menu, current one included. */
  statuses: string[];
  /** The card being dragged stays in place, faded, until it lands. */
  dragging: boolean;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOverCard: (event: React.DragEvent) => void;
  onOpen: () => void;
  onMove: (status: string) => void;
  /** Moves the task to the archive. */
  onDelete: () => void;
}

export const statusLabel = (status: string) =>
  status === 'BACKLOG' ? 'Backlog' : status.replaceAll('_', ' ');

/** A task on the board: key, assignee, title, type, then priority / date / activity chips. */
export function IssueCard({
  issue,
  typeColor,
  priorityColor,
  statuses,
  dragging,
  onDragStart,
  onDragEnd,
  onDragOverCard,
  onOpen,
  onMove,
  onDelete
}: IssueCardProps) {
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
        onDragOver={onDragOverCard}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button,a,[role=menu]')) return;
          onOpen();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.target === event.currentTarget) onOpen();
        }}
        className={cn(
          'group bg-background focus-visible:ring-ring/50 relative block cursor-pointer rounded-lg border p-3 shadow-xs/5 transition-[background-color,border-color,box-shadow,opacity,scale] duration-150 outline-none select-none hover:border-foreground/20 hover:shadow-sm focus-visible:ring-2 active:scale-[0.98]',
          dragging && 'opacity-40'
        )}
      >
        <div className='text-muted-foreground/90 mb-1.5 font-mono text-[10px]'>
          {issue.issueKey}
        </div>

        <div className='absolute top-2.5 right-2.5'>
          {issue.assignee ? (
            <span
              className='bg-muted text-foreground/80 flex size-5 items-center justify-center rounded-full border text-[9px] font-semibold'
              title={`Assigned to ${issue.assigneeName ?? issue.assignee} (@${issue.assignee})`}
            >
              {initials(issue.assignee, issue.assigneeName)}
            </span>
          ) : (
            <span
              className='border-border text-muted-foreground flex size-5 items-center justify-center rounded-full border border-dashed text-[10px]'
              title='Unassigned'
            >
              ?
            </span>
          )}
        </div>

        <p className='text-foreground/95 mb-2.5 line-clamp-3 pr-6 text-[15px] leading-5 font-medium break-words'>
          {issue.title}
        </p>

        <div className='mb-2.5 flex min-w-0 flex-wrap gap-1'>
          <DotBadge color={typeColor}>{issue.type.toLowerCase()}</DotBadge>
          {issue.sprint && <DotBadge>{issue.sprint}</DotBadge>}
        </div>

        <div className='flex flex-wrap items-center gap-1.5 pr-6'>
          <PriorityChip name={issue.priority} color={priorityColor} />
          {issue.targetDate && <TargetDateChip date={issue.targetDate} status={issue.status} />}
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
        </div>

        <IssueActionsButton
          issue={issue}
          others={others}
          onOpen={onOpen}
          onMove={onMove}
          onDelete={onDelete}
          className='absolute right-1.5 bottom-1.5'
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

interface IssueActionProps {
  /** Statuses other than the task's own. */
  others: string[];
  onOpen: () => void;
  onMove: (status: string) => void;
  onDelete: () => void;
}

/** Right-click menu of a card or row. */
export function IssueContextMenuContent({ others, onOpen, onMove, onDelete }: IssueActionProps) {
  return (
    <ContextMenuContent className='w-44'>
      <ContextMenuItem onClick={onOpen}>
        <Icons.eye /> Open
      </ContextMenuItem>
      {others.length > 0 && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Icons.arrowRight /> Move to
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {others.map((status) => (
              <ContextMenuItem key={status} onClick={() => onMove(status)}>
                <StatusIcon name={status} /> {statusLabel(status)}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem variant='destructive' onClick={onDelete}>
        <Icons.trash /> Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** The same actions as right-click, behind a "⋯" button for keyboards and touch. */
export function IssueActionsButton({
  issue,
  others,
  onOpen,
  onMove,
  onDelete,
  className
}: IssueActionProps & { issue: BoardIssue; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 flex size-6 items-center justify-center rounded-md opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 data-popup-open:opacity-100',
          className
        )}
        aria-label={`Actions for ${issue.issueKey}`}
      >
        <Icons.dots className='size-4' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-44'>
        <DropdownMenuItem onClick={onOpen}>
          <Icons.eye /> Open
        </DropdownMenuItem>
        {others.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icons.arrowRight /> Move to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {others.map((status) => (
                <DropdownMenuItem key={status} onClick={() => onMove(status)}>
                  <StatusIcon name={status} /> {statusLabel(status)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant='destructive' onClick={onDelete}>
          <Icons.trash /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The line showing where a card or status will go. */
export function DropLine({ side, axis }: { side: 'before' | 'after'; axis: 'x' | 'y' }) {
  return (
    <span
      aria-hidden='true'
      className={cn(
        'bg-primary pointer-events-none absolute z-10 rounded-full',
        "before:border-primary before:bg-background before:absolute before:size-2 before:rounded-full before:border-2 before:content-['']",
        axis === 'y'
          ? cn(
              'inset-x-0 h-0.5 before:-top-[3px] before:-left-1',
              side === 'before' ? '-top-[5px]' : '-bottom-[5px]'
            )
          : cn(
              'inset-y-0 w-0.5 before:-top-1 before:-left-[3px]',
              side === 'before' ? '-left-[7px]' : '-right-[7px]'
            )
      )}
    />
  );
}
