'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DONE_STAGE } from '@/features/issues/components/board-card';
import type { BoardIssue } from '@/features/issues/components/issue-board';
import { cn } from '@/lib/utils';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek
} from 'date-fns';
import { useMemo, useState } from 'react';

/** Tasks shown in a day before the rest fold into "+N more". */
const VISIBLE_PER_DAY = 3;
const WEEK_STARTS_ON = 0;

interface BoardCalendarViewProps {
  /** Already filtered by the board's search and filters. */
  issues: BoardIssue[];
  /** Status colours, by status name. */
  statusColor: (status: string) => string | null | undefined;
  onOpen: (issueId: string) => void;
  /** Sets (or, with null, clears) a task's target date. */
  onReschedule: (issueId: string, date: string | null) => void;
  /** Starts a new task due on `date`. */
  onCreate: (date: string) => void;
}

const dayKey = (day: Date) => format(day, 'yyyy-MM-dd');

/** Month grid of tasks by target date; drag a task to another day to reschedule it. */
export function BoardCalendarView({
  issues,
  statusColor,
  onOpen,
  onReschedule,
  onCreate
}: BoardCalendarViewProps) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** A day key, 'unscheduled', or null. */
  const [overTarget, setOverTarget] = useState<string | null>(null);

  const weeks = useMemo(() => {
    const days = eachDayOfInterval({
      start: startOfWeek(startOfMonth(month), { weekStartsOn: WEEK_STARTS_ON }),
      end: endOfWeek(endOfMonth(month), { weekStartsOn: WEEK_STARTS_ON })
    });
    return Array.from({ length: days.length / 7 }, (_, week) => days.slice(week * 7, week * 7 + 7));
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, BoardIssue[]>();
    for (const issue of issues) {
      if (!issue.targetDate) continue;
      const list = map.get(issue.targetDate) ?? [];
      list.push(issue);
      map.set(issue.targetDate, list);
    }
    // Unfinished first, then by key, so the chips that matter stay visible.
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          Number(DONE_STAGE.test(a.status)) - Number(DONE_STAGE.test(b.status)) ||
          a.issueKey.localeCompare(b.issueKey, undefined, { numeric: true })
      );
    }
    return map;
  }, [issues]);

  const unscheduled = useMemo(() => issues.filter((issue) => !issue.targetDate), [issues]);
  const scheduledThisMonth = useMemo(
    () =>
      issues.filter(
        (issue) => issue.targetDate && isSameMonth(new Date(`${issue.targetDate}T00:00`), month)
      ).length,
    [issues, month]
  );

  const dropProps = (target: string, date: string | null) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!draggingId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (overTarget !== target) setOverTarget(target);
    },
    onDragLeave: (event: React.DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverTarget(null);
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      const id = draggingId;
      setDraggingId(null);
      setOverTarget(null);
      if (!id) return;
      const issue = issues.find((entry) => entry.id === id);
      if (issue && (issue.targetDate ?? null) !== date) onReschedule(id, date);
    }
  });

  const chip = (issue: BoardIssue, compact = true) => {
    const finished = DONE_STAGE.test(issue.status);
    const overdue =
      !finished && issue.targetDate !== null && issue.targetDate! < dayKey(new Date());
    const color = statusColor(issue.status);
    return (
      <button
        key={issue.id}
        type='button'
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', issue.id);
          event.dataTransfer.effectAllowed = 'move';
          setDraggingId(issue.id);
        }}
        onDragEnd={() => {
          setDraggingId(null);
          setOverTarget(null);
        }}
        onClick={() => onOpen(issue.id)}
        title={`${issue.issueKey}: ${issue.title} (${issue.status.replaceAll('_', ' ')})`}
        className={cn(
          'bg-background hover:border-foreground/20 flex w-full min-w-0 items-center gap-1.5 rounded-md border px-1.5 text-left text-xs shadow-xs/5 transition-[border-color,opacity]',
          compact ? 'h-6' : 'h-7',
          draggingId === issue.id && 'opacity-40',
          finished && 'text-muted-foreground'
        )}
      >
        <span
          aria-hidden='true'
          className='bg-muted-foreground size-1.5 shrink-0 rounded-full'
          style={color ? { backgroundColor: color } : undefined}
        />
        {!compact && (
          <span className='text-muted-foreground shrink-0 font-mono text-[10px]'>
            {issue.issueKey}
          </span>
        )}
        <span className={cn('truncate', finished && 'line-through', overdue && 'text-destructive')}>
          {issue.title}
        </span>
      </button>
    );
  };

  return (
    <div className='grid gap-3 xl:grid-cols-[minmax(0,1fr)_16rem]'>
      <section
        aria-label='Calendar'
        className='border-border/70 bg-background overflow-hidden rounded-xl border shadow-xs/5'
      >
        <div className='border-border/70 flex items-center justify-between gap-3 border-b px-3 py-2'>
          <div className='flex min-w-0 items-baseline gap-2'>
            <h2 className='text-sm font-semibold'>{format(month, 'MMMM yyyy')}</h2>
            <span className='text-muted-foreground text-xs'>
              {scheduledThisMonth} {scheduledThisMonth === 1 ? 'task' : 'tasks'}
            </span>
          </div>
          <div className='flex items-center gap-1'>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Previous month'
              onClick={() => setMonth((current) => addMonths(current, -1))}
            >
              <Icons.chevronLeft />
            </Button>
            <Button variant='outline' size='sm' onClick={() => setMonth(startOfMonth(new Date()))}>
              Today
            </Button>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Next month'
              onClick={() => setMonth((current) => addMonths(current, 1))}
            >
              <Icons.chevronRight />
            </Button>
          </div>
        </div>

        <div className='overflow-x-auto'>
          <div className='min-w-[42rem]'>
            <div className='border-border/70 bg-muted/40 grid grid-cols-7 border-b'>
              {weeks[0].map((day) => (
                <div
                  key={day.toISOString()}
                  className='text-muted-foreground border-border/60 border-r px-2 py-1.5 text-center text-[11px] font-medium tracking-wide uppercase last:border-r-0'
                >
                  {format(day, 'EEE')}
                </div>
              ))}
            </div>
            {weeks.map((week) => (
              <div
                key={week[0].toISOString()}
                className='border-border/70 grid grid-cols-7 border-b last:border-b-0'
              >
                {week.map((day) => {
                  const key = dayKey(day);
                  const dayIssues = byDay.get(key) ?? [];
                  const hidden = dayIssues.length - VISIBLE_PER_DAY;
                  const inMonth = isSameMonth(day, month);
                  const today = isToday(day);
                  return (
                    <div
                      key={key}
                      {...dropProps(key, key)}
                      className={cn(
                        'group border-border/60 relative flex min-h-28 min-w-0 flex-col gap-1 border-r p-1.5 transition-colors last:border-r-0',
                        !inMonth && 'bg-muted/30',
                        overTarget === key && 'bg-accent/70 ring-ring/40 ring-2 ring-inset'
                      )}
                    >
                      <div className='flex items-center justify-between'>
                        <Button
                          variant='ghost'
                          size='icon-xs'
                          className='text-muted-foreground size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                          aria-label={`Add a task due ${format(day, 'MMMM d')}`}
                          onClick={() => onCreate(key)}
                        >
                          <Icons.add className='size-3.5' />
                        </Button>
                        <span
                          className={cn(
                            'flex size-6 items-center justify-center rounded-full text-xs tabular-nums',
                            !inMonth && 'text-muted-foreground/60',
                            today && 'bg-primary text-primary-foreground font-semibold'
                          )}
                        >
                          {format(day, 'd')}
                        </span>
                      </div>
                      {dayIssues.slice(0, VISIBLE_PER_DAY).map((issue) => chip(issue))}
                      {hidden > 0 && (
                        <Popover>
                          <PopoverTrigger
                            render={
                              <button
                                type='button'
                                aria-label={`${hidden} more tasks due ${format(day, 'MMMM d')}`}
                                className='text-muted-foreground hover:text-foreground w-fit rounded px-1 text-left text-[11px] font-medium'
                              />
                            }
                          >
                            +{hidden} more
                          </PopoverTrigger>
                          <PopoverContent className='w-64 space-y-1 p-2'>
                            <p className='text-muted-foreground px-1 pb-1 text-xs font-medium'>
                              {format(day, 'EEEE, MMMM d')}
                            </p>
                            {dayIssues.map((issue) => chip(issue, false))}
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside
        aria-label='Unscheduled tasks'
        {...dropProps('unscheduled', null)}
        className={cn(
          'border-border/70 bg-muted/40 dark:bg-card/90 flex max-h-[44rem] flex-col rounded-xl border shadow-xs/5 transition-colors',
          overTarget === 'unscheduled' && 'bg-accent/60 border-ring/40 ring-ring/30 ring-2'
        )}
      >
        <div className='border-border/60 flex items-center gap-2 border-b px-3 py-2'>
          <Icons.calendar className='text-muted-foreground size-4' aria-hidden='true' />
          <h2 className='text-sm font-medium'>Unscheduled</h2>
          <span className='bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums'>
            {unscheduled.length}
          </span>
        </div>
        <p className='text-muted-foreground px-3 pt-2 text-xs'>
          Drag a task onto a day to give it a target date, or back here to clear it.
        </p>
        <div className='flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2'>
          {unscheduled.map((issue) => chip(issue, false))}
          {unscheduled.length === 0 && (
            <p className='text-muted-foreground px-1 py-4 text-center text-xs'>
              Every task has a date.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
