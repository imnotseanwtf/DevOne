'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichMarkdownEditor } from '@/components/rich-markdown-editor';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { addDays, format, parseISO } from 'date-fns';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList
} from '@/components/ui/combobox';
import { Icons } from '@/components/icons';
import {
  archiveIssueAction,
  createBoardAction,
  createBoardColumnAction,
  createIssueAction,
  createIssueFieldOptionAction,
  deleteBoardAction,
  deleteBoardColumnAction,
  deleteIssueFieldOptionAction,
  moveIssueAction,
  reorderBoardColumnsAction,
  renameBoardColumnAction,
  renameIssueFieldOptionAction,
  restoreIssueAction,
  updateIssueAction
} from '@/features/issues/actions';
import { ArchiveDialog, type ArchivedIssue } from '@/features/issues/components/archive-dialog';
import {
  DropLine,
  IssueCard,
  StatusAppearanceProvider,
  StatusIcon,
  StatusIconGlyph
} from '@/features/issues/components/board-card';
import {
  STATUS_ICON_LABELS,
  STATUS_ICON_NAMES,
  type StatusIconName
} from '@/features/issues/status-icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import type { IssueActionResult } from '@/features/issues/actions';
import {
  linkDrawingToIssueAction,
  unlinkDrawingFromIssueAction
} from '@/features/drawings/actions';
import {
  LinkedDrawingsField,
  type PickerDrawing
} from '@/features/issues/components/linked-drawings-field';
import { linkDocToIssueAction, unlinkDocFromIssueAction } from '@/features/platform/actions';
import { DocPicker, type PickerDoc } from '@/features/platform/components/doc-picker';
import {
  IssueGitLinks,
  NewTaskBranchField,
  type BranchChoice
} from '@/features/issues/components/issue-git-links';
import { IssueHistory } from '@/features/issues/components/issue-history';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { BoardCalendarView } from '@/features/issues/components/board-calendar-view';
import { BoardListView } from '@/features/issues/components/board-list-view';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

export interface BoardIssue {
  id: string;
  issueKey: string;
  title: string;
  description: string | null;
  type: string;
  /** A board column's name, or the reserved "BACKLOG" sentinel. */
  status: string;
  priority: string;
  assignee: string | null;
  assigneeName: string | null;
  assigneeId: string | null;
  /** GitHub username of whoever created the task. */
  creator: string;
  creatorName: string | null;
  sprint: string | null;
  sprintId: string | null;
  gitLinkCount: number;
  commentCount?: number;
  /** Optional due date, YYYY-MM-DD. */
  targetDate?: string | null;
  linkedDocs?: PickerDoc[];
  linkedDrawings?: PickerDrawing[];
  position?: number;
}

interface IssueBoardProps {
  projectId: string;
  boardId: string;
  boards: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  issues: BoardIssue[];
  members: { id: string; username: string; name: string | null }[];
  columns: { id: string; name: string; color: string | null; icon: string | null }[];
  types: { id: string; name: string; color: string | null }[];
  priorities: { id: string; name: string; color: string | null }[];
  availableDocs?: PickerDoc[];
  availableDrawings?: PickerDrawing[];
  /** Tasks deleted from this board, newest first. */
  archived?: ArchivedIssue[];
}

export interface IssueEdits {
  title: string;
  description?: string;
  type: string;
  priority: string;
  assigneeId: string | null;
  /** YYYY-MM-DD, or null for none. */
  targetDate: string | null;
}

const TYPE_DOT: Record<string, string> = {
  BUG: 'bg-destructive',
  STORY: 'bg-emerald-500',
  EPIC: 'bg-violet-500',
  TASK: 'bg-sky-500'
};

/** "octocat" or "octocat (Mona Lisa)" when a display name is on file. */
function personLabel(username: string, name: string | null): string {
  return name ? `${username} (${name})` : username;
}

function sortColumn(entries: BoardIssue[]): BoardIssue[] {
  return [...entries].toSorted((a, b) => {
    const pa = a.position ?? 0;
    const pb = b.position ?? 0;
    if (pa !== pb) return pa - pb;
    return a.issueKey.localeCompare(b.issueKey);
  });
}

type DragItem = { kind: 'card'; id: string } | { kind: 'column'; id: string };

/** Where the dragged thing would land; drives the drop line and the drop itself. */
type DropHint =
  | { kind: 'column'; targetId: string; side: 'before' | 'after' }
  /** `anchorId` null means the end of the column (or an empty one). */
  | { kind: 'card'; status: string; anchorId: string | null; side: 'before' | 'after' };

/** Which half of `element` the pointer is over, along the list's direction. */
function sideOf(event: React.DragEvent, axis: 'x' | 'y'): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect();
  return axis === 'x'
    ? event.clientX < rect.left + rect.width / 2
      ? 'before'
      : 'after'
    : event.clientY < rect.top + rect.height / 2
      ? 'before'
      : 'after';
}

/** Stand-in columns and cards while another board loads. */
function BoardSkeleton({ columns }: { columns: number }) {
  return (
    <div role='status' aria-label='Loading board' className='space-y-6'>
      <div className='flex gap-3 overflow-hidden px-2 pb-3'>
        {Array.from({ length: columns }, (_, column) => (
          <div key={column} className='bg-muted/40 w-72 shrink-0 space-y-2 rounded-xl border p-2'>
            <div className='flex items-center justify-between px-1 py-1'>
              <Skeleton className='h-3 w-24' />
              <Skeleton className='h-5 w-6 rounded-full' />
            </div>
            {Array.from({ length: 3 - (column % 2) }, (_, card) => (
              <div key={card} className='bg-card space-y-3 rounded-xl border p-3'>
                <div className='flex items-center justify-between'>
                  <Skeleton className='h-3 w-12' />
                  <Skeleton className='h-5 w-16 rounded-full' />
                </div>
                <Skeleton className='h-4 w-4/5' />
                <Skeleton className='h-3 w-1/3' />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className='bg-muted/40 space-y-3 rounded-xl border p-3'>
        <Skeleton className='h-3 w-16' />
        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
          {Array.from({ length: 3 }, (_, card) => (
            <Skeleton key={card} className='h-24 rounded-xl' />
          ))}
        </div>
      </div>
    </div>
  );
}

const BOARD_VIEWS = ['board', 'list', 'calendar'] as const;

/** Pixels from the board's edge where dragging starts scrolling it sideways. */
const EDGE_SCROLL_ZONE = 80;

export function IssueBoard({
  projectId,
  boardId,
  boards,
  projects,
  issues,
  members,
  columns,
  types,
  priorities,
  availableDocs = [],
  availableDrawings = [],
  archived = []
}: IssueBoardProps) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [, startMoveTransition] = useTransition();
  const [savePending, startSaveTransition] = useTransition();
  // Stays pending until the next board's data has rendered, so it drives the loader.
  const [switchingBoard, startBoardSwitch] = useTransition();
  const [pendingBoardId, setPendingBoardId] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<BoardIssue[] | null>(null);
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [hint, setHint] = useState<DropHint | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [view, setView] = useQueryState(
    'view',
    parseAsStringLiteral(BOARD_VIEWS).withDefault('board')
  );
  /** Pre-fills the new task's target date when it's started from a calendar day. */
  const [createTargetDate, setCreateTargetDate] = useState<string | null>(null);
  /** 'ALL', 'NONE' (unassigned), or a member's id. */
  const [assigneeFilter, setAssigneeFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStatus, setCreateStatus] = useState('TODO');
  const [boardDialogOpen, setBoardDialogOpen] = useState(false);
  const [boardName, setBoardName] = useState('');
  const [boardError, setBoardError] = useState<string>();
  const [boardPending, startBoardTransition] = useTransition();
  // Tracked by id (not name) so a rename keeps its place instead of jumping
  // to the end of the board.
  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    columns.map((column) => column.id)
  );
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteBoardOpen, setDeleteBoardOpen] = useState(false);
  const [boardDeleting, startBoardDelete] = useTransition();
  const currentBoardName = boards.find((board) => board.id === boardId)?.name ?? 'this board';
  const boardTaskCount = issues.length + archived.length;

  function deleteCurrentBoard() {
    startBoardDelete(async () => {
      const result = await deleteBoardAction({ boardId });
      if (!result.ok) {
        toast.error(result.error ?? 'Could not delete the board');
        return;
      }
      setDeleteBoardOpen(false);
      toast.success(`Deleted the board “${currentBoardName}”`);
      // The first remaining board opens, or the "create a board" screen if none is left.
      router.replace(`/projects/${projectId}/issues`);
      router.refresh();
    });
  }
  const [manageStatusesOpen, setManageStatusesOpen] = useState(false);
  const [manageTypesOpen, setManageTypesOpen] = useState(false);
  const [managePrioritiesOpen, setManagePrioritiesOpen] = useState(false);
  const columnById = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns]
  );
  const statusAppearance = useMemo(
    () =>
      new Map(columns.map((column) => [column.name, { color: column.color, icon: column.icon }])),
    [columns]
  );
  /** Where a card can be moved from its menu. */
  const allStatuses = useMemo(
    () => ['BACKLOG', ...columns.map((column) => column.name)],
    [columns]
  );

  // New statuses (added elsewhere, or just created) join the end of the
  // order; the order itself is otherwise left to the user's own dragging.
  // Removed ones just drop out.
  useEffect(() => {
    setColumnOrder((order) => {
      const known = new Set(columns.map((column) => column.id));
      const kept = order.filter((id) => known.has(id));
      const added = columns.map((column) => column.id).filter((id) => !order.includes(id));
      return [...kept, ...added];
    });
  }, [columns]);

  const visible = optimistic ?? issues;

  // Clear the optimistic overlay only once the refreshed server data has
  // actually landed (not right after the action resolves) — otherwise the
  // UI briefly reverts to the stale pre-move `issues` prop before jumping
  // forward again once router.refresh() delivers the update.
  useEffect(() => {
    setOptimistic(null);
  }, [issues]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visible.filter((issue) => {
      if (typeFilter !== 'ALL' && issue.type !== typeFilter) return false;
      if (priorityFilter !== 'ALL' && issue.priority !== priorityFilter) return false;
      if (assigneeFilter === 'NONE' && issue.assigneeId) return false;
      if (
        assigneeFilter !== 'ALL' &&
        assigneeFilter !== 'NONE' &&
        issue.assigneeId !== assigneeFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        issue.title.toLowerCase().includes(q) ||
        issue.issueKey.toLowerCase().includes(q) ||
        (issue.assignee ?? '').toLowerCase().includes(q)
      );
    });
  }, [visible, query, typeFilter, priorityFilter, assigneeFilter]);
  const activeFilters = [typeFilter, priorityFilter, assigneeFilter].filter(
    (value) => value !== 'ALL'
  ).length;

  const backlogIssues = useMemo(
    () => sortColumn(filtered.filter((issue) => issue.status === 'BACKLOG')),
    [filtered]
  );
  const selected = visible.find((issue) => issue.id === selectedId) ?? null;

  function revert() {
    setOptimistic(null);
  }

  /** Moves a card into `status` (a board column's name, or "BACKLOG"),
   * optionally before another card. */
  function move(issueId: string, status: string, beforeId: string | null) {
    const current = optimistic ?? issues;
    const moving = current.find((entry) => entry.id === issueId);
    if (!moving) return;
    if (beforeId === issueId) return;
    if (moving.status === status && beforeId === null) return;

    const updated: BoardIssue = { ...moving, status };

    // Optimistic reorder: remove, then insert before the target (or at the end).
    const without = current.filter((entry) => entry.id !== issueId);
    const targetColumnIssues = sortColumn(without.filter((entry) => entry.status === status));
    let next: BoardIssue[];
    if (beforeId) {
      const idx = without.findIndex((entry) => entry.id === beforeId);
      if (idx === -1) return;
      next = [...without.slice(0, idx), updated, ...without.slice(idx)];
    } else {
      const others = without.filter((entry) => entry.status !== status);
      next = [...others, ...targetColumnIssues, updated];
    }

    setError(undefined);
    setOptimistic(next);

    startMoveTransition(async () => {
      const result = await moveIssueAction({
        issueId,
        status,
        beforeId: beforeId ?? null
      });
      if (!result.ok) {
        revert();
        setError(result.error ?? 'Could not move the task');
        return;
      }
      router.refresh();
    });
  }

  function startCardDrag(event: React.DragEvent, issueId: string) {
    event.dataTransfer.setData('text/plain', issueId);
    event.dataTransfer.effectAllowed = 'move';
    setDrag({ kind: 'card', id: issueId });
    startEdgeScroll();
  }

  function startColumnDrag(event: React.DragEvent<HTMLElement>, columnId: string) {
    event.dataTransfer.setData('text/x-column', columnId);
    event.dataTransfer.effectAllowed = 'move';
    // Drag the whole column's picture, not just its header.
    const column = event.currentTarget.closest<HTMLElement>('[data-column]');
    if (column) event.dataTransfer.setDragImage(column, event.nativeEvent.offsetX, 16);
    setDrag({ kind: 'column', id: columnId });
    startEdgeScroll();
  }

  function endDrag() {
    setDrag(null);
    setHint(null);
    stopEdgeScroll();
  }

  /** Hovering a column: statuses land beside it, cards at its end unless over a card. */
  function hoverColumn(event: React.DragEvent, columnId: string, status: string) {
    if (!drag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (drag.kind === 'column') {
      const side = drag.id === columnId ? 'before' : sideOf(event, 'x');
      setHint({ kind: 'column', targetId: columnId, side });
    } else {
      setHint({ kind: 'card', status, anchorId: null, side: 'after' });
    }
  }

  function hoverCard(event: React.DragEvent, status: string, issueId: string, axis: 'x' | 'y') {
    if (drag?.kind !== 'card') return; // statuses fall through to the column
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setHint({ kind: 'card', status, anchorId: issueId, side: sideOf(event, axis) });
  }

  function clearHintOnLeave(event: React.DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHint(null);
  }

  function drop(event: React.DragEvent) {
    event.preventDefault();
    const [item, target] = [drag, hint];
    endDrag();
    if (!item || !target) return;

    if (item.kind === 'column' && target.kind === 'column') {
      const without = columnOrder.filter((id) => id !== item.id);
      const at = without.indexOf(target.targetId) + (target.side === 'after' ? 1 : 0);
      const next = [...without.slice(0, at), item.id, ...without.slice(at)];
      if (next.every((id, index) => id === columnOrder[index])) return;
      saveColumnOrder(next);
      return;
    }

    if (item.kind === 'card' && target.kind === 'card') {
      const list = sortColumn(
        filtered.filter((issue) => issue.status === target.status && issue.id !== item.id)
      );
      let beforeId: string | null = null;
      if (target.anchorId) {
        const index = list.findIndex((issue) => issue.id === target.anchorId);
        beforeId = target.side === 'before' ? target.anchorId : (list[index + 1]?.id ?? null);
      }
      // Dropped back where it started: nothing to save.
      const moving = visible.find((issue) => issue.id === item.id);
      if (moving?.status === target.status) {
        const current = sortColumn(filtered.filter((issue) => issue.status === target.status));
        const after = current[current.findIndex((issue) => issue.id === item.id) + 1];
        if ((after?.id ?? null) === beforeId) return;
      }
      move(item.id, target.status, beforeId);
    }
  }

  function saveColumnOrder(next: string[]) {
    const previous = columnOrder;
    setColumnOrder(next);
    setError(undefined);
    startMoveTransition(async () => {
      const result = await reorderBoardColumnsAction({ projectId, boardId, columnIds: next });
      if (!result.ok) {
        setColumnOrder(previous);
        setError(result.error ?? 'Could not reorder the statuses');
        return;
      }
      router.refresh();
    });
  }

  // While dragging, holding the pointer near the board's left or right edge
  // scrolls it, so far-away statuses are reachable without letting go.
  const edgePointerX = useRef<number | null>(null);
  const edgeFrame = useRef<number | null>(null);

  function startEdgeScroll() {
    const step = () => {
      const board = boardScrollRef.current;
      const x = edgePointerX.current;
      if (board && x !== null) {
        const rect = board.getBoundingClientRect();
        if (x < rect.left + EDGE_SCROLL_ZONE) {
          board.scrollLeft -= Math.ceil((rect.left + EDGE_SCROLL_ZONE - x) / 6);
        } else if (x > rect.right - EDGE_SCROLL_ZONE) {
          board.scrollLeft += Math.ceil((x - (rect.right - EDGE_SCROLL_ZONE)) / 6);
        }
      }
      edgeFrame.current = requestAnimationFrame(step);
    };
    if (edgeFrame.current === null) edgeFrame.current = requestAnimationFrame(step);
  }

  function stopEdgeScroll() {
    if (edgeFrame.current !== null) cancelAnimationFrame(edgeFrame.current);
    edgeFrame.current = null;
    edgePointerX.current = null;
  }

  useEffect(() => stopEdgeScroll, []);

  // Click-and-drag anywhere on the board's empty background to pan it
  // horizontally, like scrolling a canvas — separate from card/column drags,
  // which only start from an element with `draggable`.
  const boardScrollRef = useRef<HTMLElement>(null);
  const panState = useRef<{ startX: number; scrollLeft: number } | null>(null);

  function onBoardPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    const el = boardScrollRef.current;
    if (!el) return;
    panState.current = { startX: event.clientX, scrollLeft: el.scrollLeft };
    el.setPointerCapture(event.pointerId);
  }

  function onBoardPointerMove(event: React.PointerEvent<HTMLElement>) {
    const pan = panState.current;
    const el = boardScrollRef.current;
    if (!pan || !el) return;
    // Drag right -> scroll right (matches dragging the scrollbar itself),
    // not the "grab the page and pull" direction this had before.
    el.scrollLeft = pan.scrollLeft + (event.clientX - pan.startX);
  }

  function onBoardPointerUp() {
    panState.current = null;
  }

  /** "Delete" moves the task to the archive at once; the toast can undo it. */
  function archiveTask(issueId: string) {
    const current = optimistic ?? issues;
    const task = current.find((entry) => entry.id === issueId);
    if (!task) return;
    setError(undefined);
    setSelectedId(null);
    setOptimistic(current.filter((entry) => entry.id !== issueId));
    startSaveTransition(async () => {
      const result = await archiveIssueAction({ issueId });
      if (!result.ok) {
        revert();
        setError(result.error ?? 'Could not delete the task');
        return;
      }
      toast.success(`${task.issueKey} moved to the archive`, {
        action: {
          label: 'Undo',
          onClick: () =>
            void restoreIssueAction({ issueId }).then((restored) => {
              if (!restored.ok) toast.error(restored.error ?? 'Could not restore the task');
              else router.refresh();
            })
        }
      });
      router.refresh();
    });
  }

  function openCreate(status: string, targetDate: string | null = null) {
    setCreateStatus(status);
    setCreateTargetDate(targetDate);
    setCreateOpen(true);
  }

  /** The calendar's drag: changes only the target date. */
  function reschedule(issueId: string, targetDate: string | null) {
    const issue = (optimistic ?? issues).find((entry) => entry.id === issueId);
    if (!issue) return;
    saveEdits(issueId, {
      title: issue.title,
      description: issue.description ?? undefined,
      type: issue.type,
      priority: issue.priority,
      assigneeId: issue.assigneeId,
      targetDate
    });
  }

  function saveEdits(issueId: string, data: IssueEdits) {
    const current = optimistic ?? issues;
    const existing = current.find((entry) => entry.id === issueId);
    if (!existing) return;

    const assignee = data.assigneeId
      ? members.find((member) => member.id === data.assigneeId)
      : null;

    setError(undefined);
    setOptimistic(
      current.map((entry) =>
        entry.id === issueId
          ? {
              ...entry,
              title: data.title,
              description: data.description ?? entry.description,
              type: data.type,
              priority: data.priority,
              assigneeId: data.assigneeId,
              targetDate: data.targetDate,
              assignee: assignee?.username ?? (data.assigneeId ? entry.assignee : null),
              assigneeName: assignee?.name ?? (data.assigneeId ? entry.assigneeName : null)
            }
          : entry
      )
    );

    startSaveTransition(async () => {
      const result = await updateIssueAction({ issueId, ...data });
      if (!result.ok) {
        revert();
        setError(result.error ?? 'Could not update the task');
        return;
      }
      router.refresh();
    });
  }

  return (
    <StatusAppearanceProvider value={statusAppearance}>
      <div className='min-w-0 space-y-6'>
        <div className='flex flex-wrap items-center gap-2'>
          <div
            role='tablist'
            aria-label='View'
            className='bg-muted text-muted-foreground inline-flex h-8 items-center rounded-lg p-0.5'
          >
            {(
              [
                ['board', 'Board', Icons.columns],
                ['list', 'List', Icons.list],
                ['calendar', 'Calendar', Icons.calendar]
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type='button'
                role='tab'
                aria-selected={view === id}
                onClick={() => void setView(id === 'board' ? null : id)}
                className={cn(
                  'hover:text-foreground flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors',
                  view === id && 'bg-background text-foreground shadow-sm'
                )}
              >
                <Icon className='size-3.5' aria-hidden='true' />
                {label}
              </button>
            ))}
          </div>
          <NativeSelect
            id='board-select'
            size='sm'
            aria-label='Board'
            value={switchingBoard ? (pendingBoardId ?? boardId) : boardId}
            onChange={(event) => {
              const next = event.target.value;
              setPendingBoardId(next);
              startBoardSwitch(() => {
                router.push(`/projects/${projectId}/issues?board=${encodeURIComponent(next)}`);
              });
            }}
            aria-busy={switchingBoard}
            className='w-48'
          >
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </NativeSelect>
          <div className='relative w-full sm:w-64'>
            <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2' />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='Search tasks…'
              className='h-8 pl-8 text-sm'
              aria-label='Search tasks by key, title, or assignee'
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant='ghost' size='sm' />}>
              <Icons.filter aria-hidden='true' /> Filter
              {activeFilters > 0 && (
                <Badge variant='secondary' className='ml-0.5 h-4 px-1.5 tabular-nums'>
                  {activeFilters}
                </Badge>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' className='max-h-[min(70vh,32rem)] w-56'>
              <FilterGroup
                label='Type'
                value={typeFilter}
                onChange={setTypeFilter}
                options={types.map((type) => ({
                  value: type.name,
                  label: type.name.toLowerCase(),
                  color: type.color
                }))}
              />
              <DropdownMenuSeparator />
              <FilterGroup
                label='Priority'
                value={priorityFilter}
                onChange={setPriorityFilter}
                options={priorities.map((priority) => ({
                  value: priority.name,
                  label: priority.name.toLowerCase(),
                  color: priority.color
                }))}
              />
              <DropdownMenuSeparator />
              <FilterGroup
                label='Assignee'
                value={assigneeFilter}
                onChange={setAssigneeFilter}
                options={[
                  { value: 'NONE', label: 'Unassigned' },
                  ...members.map((member) => ({
                    value: member.id,
                    label: member.name ?? member.username
                  }))
                ]}
              />
              {activeFilters > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setTypeFilter('ALL');
                      setPriorityFilter('ALL');
                      setAssigneeFilter('ALL');
                    }}
                  >
                    <Icons.close /> Clear filters
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className='ml-auto flex items-center gap-1'>
            <Button variant='ghost' size='sm' onClick={() => setArchiveOpen(true)}>
              <Icons.archive aria-hidden='true' /> Archive
              {archived.length > 0 && (
                <Badge variant='secondary' className='ml-0.5 h-4 px-1.5 tabular-nums'>
                  {archived.length}
                </Badge>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant='ghost' size='icon-sm' aria-label='Board options' />}
              >
                <Icons.dots />
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-52'>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Board</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setBoardDialogOpen(true)}>
                    <Icons.add /> Create board
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setManageStatusesOpen(true)}>
                    <Icons.columns /> Manage statuses
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setManageTypesOpen(true)}>
                    <Icons.adjustments /> Manage types
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setManagePrioritiesOpen(true)}>
                    <Icons.priorityHigh /> Manage priorities
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant='destructive' onClick={() => setDeleteBoardOpen(true)}>
                  <Icons.trash /> Delete board
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size='sm' onClick={() => openCreate(columns[0]?.name ?? 'TODO')}>
              <Icons.add aria-hidden='true' />
              New task
            </Button>
          </div>
        </div>
        <ArchiveDialog open={archiveOpen} onOpenChange={setArchiveOpen} issues={archived} />
        <AlertDialog
          open={deleteBoardOpen}
          onOpenChange={(open) => !boardDeleting && setDeleteBoardOpen(open)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete the board “{currentBoardName}”?</AlertDialogTitle>
              <AlertDialogDescription>
                {boardTaskCount > 0
                  ? `Its statuses and the ${boardTaskCount === 1 ? 'task' : `${boardTaskCount} tasks`} on it (archived ones included), with their comments and links, are deleted too. This cannot be undone.`
                  : 'The board and its statuses are deleted. It has no tasks. This cannot be undone.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={boardDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant='destructive'
                disabled={boardDeleting}
                onClick={(event) => {
                  event.preventDefault();
                  deleteCurrentBoard();
                }}
              >
                {boardDeleting ? 'Deleting…' : 'Delete board'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <ManageOptionsDialog
          open={manageStatusesOpen}
          onOpenChange={setManageStatusesOpen}
          title='Manage statuses'
          description='Workflow columns on this board — add, edit, or remove any of them.'
          itemLabel='status'
          items={columns}
          withColor
          withIcon
          onAdd={(name, color, icon) =>
            createBoardColumnAction({ projectId, boardId, name, color, icon })
          }
          onEdit={(columnId, name, color, icon) =>
            renameBoardColumnAction({ projectId, boardId, columnId, name, color, icon })
          }
          onDelete={(columnId) => deleteBoardColumnAction({ projectId, boardId, columnId })}
          onDone={() => router.refresh()}
        />
        <ManageOptionsDialog
          open={manageTypesOpen}
          onOpenChange={setManageTypesOpen}
          title='Manage types'
          description='Task types available when creating or editing a task in this project.'
          itemLabel='type'
          items={types}
          withColor
          onAdd={(name, color) =>
            createIssueFieldOptionAction({ projectId, kind: 'TYPE', name, color })
          }
          onEdit={(optionId, name, color) =>
            renameIssueFieldOptionAction({
              projectId,
              kind: 'TYPE',
              optionId,
              name,
              color
            })
          }
          onDelete={(optionId) =>
            deleteIssueFieldOptionAction({ projectId, kind: 'TYPE', optionId })
          }
          onDone={() => router.refresh()}
        />
        <ManageOptionsDialog
          open={managePrioritiesOpen}
          onOpenChange={setManagePrioritiesOpen}
          title='Manage priorities'
          description='Priorities available when creating or editing a task in this project.'
          itemLabel='priority'
          items={priorities}
          withColor
          onAdd={(name, color) =>
            createIssueFieldOptionAction({
              projectId,
              kind: 'PRIORITY',
              name,
              color
            })
          }
          onEdit={(optionId, name, color) =>
            renameIssueFieldOptionAction({
              projectId,
              kind: 'PRIORITY',
              optionId,
              name,
              color
            })
          }
          onDelete={(optionId) =>
            deleteIssueFieldOptionAction({
              projectId,
              kind: 'PRIORITY',
              optionId
            })
          }
          onDone={() => router.refresh()}
        />
        <Dialog open={boardDialogOpen} onOpenChange={setBoardDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create board</DialogTitle>
              <DialogDescription>Give this project board a name.</DialogDescription>
            </DialogHeader>
            <form
              className='space-y-3'
              onSubmit={(event) => {
                event.preventDefault();
                setBoardError(undefined);
                startBoardTransition(async () => {
                  const result = await createBoardAction({
                    projectId,
                    name: boardName
                  });
                  if (!result.ok || !result.boardId) {
                    setBoardError(result.error ?? 'Could not create board');
                    return;
                  }
                  setBoardDialogOpen(false);
                  setBoardName('');
                  router.push(
                    `/projects/${projectId}/issues?board=${encodeURIComponent(result.boardId)}`
                  );
                  router.refresh();
                });
              }}
            >
              <Label htmlFor='new-board-name'>Board name</Label>
              <Input
                id='new-board-name'
                value={boardName}
                onChange={(event) => setBoardName(event.target.value)}
                minLength={2}
                maxLength={80}
                required
                autoFocus
              />
              {boardError && (
                <Alert variant='destructive'>
                  <AlertDescription>{boardError}</AlertDescription>
                </Alert>
              )}
              <Button type='submit' disabled={boardPending}>
                {boardPending ? 'Creating…' : 'Create board'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        {error && (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div aria-busy={switchingBoard} className='space-y-6'>
          {switchingBoard && <BoardSkeleton columns={Math.max(columnOrder.length, 3)} />}
          {/* Hidden, not unmounted, so nothing is lost if the switch fails. */}
          {!switchingBoard && view === 'list' && (
            <BoardListView
              sections={[
                ...columnOrder.flatMap((columnId) => {
                  const column = columnById.get(columnId);
                  return column
                    ? [
                        {
                          id: columnId,
                          status: column.name,
                          color: column.color,
                          issues: sortColumn(
                            filtered.filter((issue) => issue.status === column.name)
                          )
                        }
                      ]
                    : [];
                }),
                { id: 'BACKLOG', status: 'BACKLOG', color: null, issues: backlogIssues }
              ]}
              statuses={allStatuses}
              typeColor={(type) => types.find((entry) => entry.name === type)?.color}
              priorityColor={(priority) =>
                priorities.find((entry) => entry.name === priority)?.color
              }
              dnd={{
                draggingId: drag?.kind === 'card' ? drag.id : null,
                hint: hint?.kind === 'card' ? hint : null,
                startCardDrag,
                endDrag,
                hoverCard,
                hoverColumn,
                clearHintOnLeave,
                drop
              }}
              onOpen={setSelectedId}
              onMove={(issueId, status) => move(issueId, status, null)}
              onDelete={archiveTask}
              onCreate={(status) => openCreate(status)}
            />
          )}
          {!switchingBoard && view === 'calendar' && (
            <BoardCalendarView
              issues={filtered}
              statusColor={(status) => columns.find((column) => column.name === status)?.color}
              onOpen={setSelectedId}
              onReschedule={reschedule}
              onCreate={(date) => openCreate(columns[0]?.name ?? 'BACKLOG', date)}
            />
          )}
          <div className={cn('space-y-6', (switchingBoard || view !== 'board') && 'hidden')}>
            <section
              aria-label='Board'
              ref={boardScrollRef}
              onPointerDown={onBoardPointerDown}
              onPointerMove={onBoardPointerMove}
              onPointerUp={onBoardPointerUp}
              onPointerLeave={onBoardPointerUp}
              onDragOver={(event) => {
                edgePointerX.current = event.clientX;
              }}
              onDragLeave={clearHintOnLeave}
              className='flex cursor-grab items-start gap-3 overflow-x-scroll px-2 pb-3 select-none active:cursor-grabbing'
            >
              {columnOrder.map((columnId) => {
                const column = columnById.get(columnId);
                if (!column) return null;
                const columnIssues = sortColumn(
                  filtered.filter((issue) => issue.status === column.name)
                );
                const cardHint = hint?.kind === 'card' && hint.status === column.name ? hint : null;
                const columnHint =
                  hint?.kind === 'column' && hint.targetId === columnId ? hint : null;
                const isOver = cardHint !== null;
                return (
                  <div
                    key={columnId}
                    data-column
                    onDragOver={(event) => hoverColumn(event, columnId, column.name)}
                    onDrop={drop}
                    className={cn(
                      'border-border/70 bg-muted/40 dark:bg-card/90 relative flex min-h-48 w-80 shrink-0 flex-col rounded-xl border shadow-xs/5 transition-[opacity,background-color,border-color,box-shadow] duration-150',
                      isOver && 'bg-accent/60 border-ring/40 ring-ring/30 ring-2',
                      drag?.kind === 'column' && drag.id === columnId && 'opacity-40'
                    )}
                  >
                    {columnHint && drag?.id !== columnId && (
                      <DropLine side={columnHint.side} axis='x' />
                    )}
                    <div
                      draggable
                      onDragStart={(event) => startColumnDrag(event, columnId)}
                      onDragEnd={endDrag}
                      title='Drag to reorder this status'
                      className='border-border/60 flex cursor-grab items-center justify-between gap-2 border-b px-3 py-2 active:cursor-grabbing'
                    >
                      <h3 className='flex min-w-0 items-center gap-2'>
                        <StatusIcon name={column.name} color={column.color} icon={column.icon} />
                        <span className='text-foreground/95 truncate text-sm font-medium'>
                          {column.name.replaceAll('_', ' ')}
                        </span>
                        <span className='bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums'>
                          {columnIssues.length}
                        </span>
                      </h3>
                      <Button
                        variant='ghost'
                        size='icon-xs'
                        className='text-muted-foreground'
                        aria-label={`Add a task to ${column.name}`}
                        title='Add task'
                        onClick={() => openCreate(column.name)}
                      >
                        <Icons.add />
                      </Button>
                    </div>
                    <ul className='flex flex-1 flex-col gap-2 px-2 pt-2 pb-2'>
                      {columnIssues.map((issue) => (
                        <li key={issue.id} className='relative'>
                          {cardHint?.anchorId === issue.id && drag?.id !== issue.id && (
                            <DropLine side={cardHint.side} axis='y' />
                          )}
                          <IssueCard
                            issue={issue}
                            typeColor={types.find((type) => type.name === issue.type)?.color}
                            priorityColor={
                              priorities.find((priority) => priority.name === issue.priority)?.color
                            }
                            statuses={allStatuses}
                            dragging={drag?.id === issue.id}
                            onDragStart={(event) => startCardDrag(event, issue.id)}
                            onDragEnd={endDrag}
                            onDragOverCard={(event) => hoverCard(event, column.name, issue.id, 'y')}
                            onOpen={() => setSelectedId(issue.id)}
                            onMove={(status) => move(issue.id, status, null)}
                            onDelete={() => archiveTask(issue.id)}
                          />
                        </li>
                      ))}
                      {columnIssues.length > 0 && cardHint?.anchorId === null && (
                        <li className='relative h-0' aria-hidden='true'>
                          <DropLine side='before' axis='y' />
                        </li>
                      )}
                      {columnIssues.length === 0 && (
                        <li
                          className={cn(
                            'text-muted-foreground flex flex-1 items-center justify-center rounded-lg border border-dashed px-3 py-6 text-center text-xs transition-colors',
                            isOver ? 'border-ring/60 text-foreground' : 'border-transparent'
                          )}
                        >
                          {isOver ? 'Drop here' : 'No tasks'}
                        </li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </section>

            <section
              aria-label='Backlog'
              onDragOver={(event) => hoverColumn(event, 'BACKLOG', 'BACKLOG')}
              onDragLeave={clearHintOnLeave}
              onDrop={drop}
              className={cn(
                'border-border/70 bg-muted/40 dark:bg-card/90 rounded-xl border shadow-xs/5 transition-[background-color,border-color,box-shadow] duration-150',
                hint?.kind === 'card' &&
                  hint.status === 'BACKLOG' &&
                  'bg-accent/60 border-ring/40 ring-ring/30 ring-2'
              )}
            >
              <div className='border-border/60 flex items-center justify-between gap-2 border-b px-3 py-2'>
                <h2 className='flex items-center gap-2'>
                  <StatusIcon name='BACKLOG' />
                  <span className='text-foreground/95 text-sm font-medium'>Backlog</span>
                  <span className='bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums'>
                    {backlogIssues.length}
                  </span>
                </h2>
                <Button
                  variant='ghost'
                  size='icon-xs'
                  className='text-muted-foreground'
                  aria-label='Add a task to the backlog'
                  title='Add task'
                  onClick={() => openCreate('BACKLOG')}
                >
                  <Icons.add />
                </Button>
              </div>
              <ul className='grid gap-2 p-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
                {backlogIssues.map((issue, index) => {
                  const backlogHint =
                    hint?.kind === 'card' && hint.status === 'BACKLOG' ? hint : null;
                  const isLast = index === backlogIssues.length - 1;
                  return (
                    <li key={issue.id} className='relative'>
                      {backlogHint?.anchorId === issue.id && drag?.id !== issue.id && (
                        <DropLine side={backlogHint.side} axis='x' />
                      )}
                      {isLast && backlogHint?.anchorId === null && (
                        <DropLine side='after' axis='x' />
                      )}
                      <IssueCard
                        issue={issue}
                        typeColor={types.find((type) => type.name === issue.type)?.color}
                        priorityColor={
                          priorities.find((priority) => priority.name === issue.priority)?.color
                        }
                        statuses={allStatuses}
                        dragging={drag?.id === issue.id}
                        onDragStart={(event) => startCardDrag(event, issue.id)}
                        onDragEnd={endDrag}
                        onDragOverCard={(event) => hoverCard(event, 'BACKLOG', issue.id, 'x')}
                        onOpen={() => setSelectedId(issue.id)}
                        onMove={(status) => move(issue.id, status, null)}
                        onDelete={() => archiveTask(issue.id)}
                      />
                    </li>
                  );
                })}
                {backlogIssues.length === 0 && (
                  <li
                    className={cn(
                      'text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-xs sm:col-span-2 xl:col-span-3 2xl:col-span-4',
                      hint?.kind === 'card' && hint.status === 'BACKLOG'
                        ? 'border-ring/60 text-foreground'
                        : 'border-transparent'
                    )}
                  >
                    {hint?.kind === 'card' && hint.status === 'BACKLOG'
                      ? 'Drop here'
                      : 'Nothing in the backlog'}
                  </li>
                )}
              </ul>
            </section>
          </div>
        </div>

        {selected && (
          <IssueModal
            key={selected.id}
            projectId={projectId}
            issue={selected}
            members={members}
            types={types}
            priorities={priorities}
            statuses={['BACKLOG', ...columns.map((c) => c.name)]}
            availableDocs={availableDocs}
            availableDrawings={availableDrawings}
            disabled={savePending}
            onClose={() => setSelectedId(null)}
            onSave={(data) => saveEdits(selected.id, data)}
            onMove={(status) => move(selected.id, status, null)}
            onDelete={() => archiveTask(selected.id)}
          />
        )}

        {createOpen && (
          <CreateIssueModal
            projectId={projectId}
            boardId={boardId}
            types={types}
            priorities={priorities}
            members={members}
            statuses={['BACKLOG', ...columns.map((c) => c.name)]}
            initialStatus={createStatus}
            initialTargetDate={createTargetDate}
            availableDocs={availableDocs}
            availableDrawings={availableDrawings}
            disabled={false}
            onClose={() => setCreateOpen(false)}
            onError={setError}
          />
        )}
      </div>
    </StatusAppearanceProvider>
  );
}

interface FilterOption {
  value: string;
  label: string;
  color?: string | null;
}

/** One section of the board's Filter menu: "All" or a single choice. */
function FilterGroup({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(String(next))}>
        <DropdownMenuRadioItem value='ALL'>All</DropdownMenuRadioItem>
        {options.map((option) => (
          <DropdownMenuRadioItem key={option.value} value={option.value}>
            {option.color !== undefined && (
              <span
                aria-hidden='true'
                className='bg-muted-foreground size-2 shrink-0 rounded-full'
                style={option.color ? { backgroundColor: option.color } : undefined}
              />
            )}
            <span className='truncate'>{option.label}</span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}

/**
 * Add / edit / delete for a project's simple named lists — custom board
 * statuses, task types, priorities. One dialog shape for all three so each
 * caller only wires up its own server actions.
 */
/** A button showing a status's icon that opens a grid of the circle icons to choose from. */
function StatusIconPicker({
  name,
  color,
  value,
  onChange
}: {
  name: string;
  color: string | null;
  /** null = picked from the name. */
  value: StatusIconName | null;
  onChange: (icon: StatusIconName | null) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            size='icon'
            className='size-9 shrink-0'
            aria-label={`Icon: ${value ? STATUS_ICON_LABELS[value] : 'automatic'}`}
            title='Choose an icon'
          />
        }
      >
        <StatusIcon name={name || 'To do'} color={color} icon={value} className='size-5' />
      </PopoverTrigger>
      <PopoverContent className='w-64 p-2' align='start'>
        <p className='text-muted-foreground px-1 pb-2 text-xs font-medium'>Icon</p>
        <div className='grid grid-cols-5 gap-1'>
          {STATUS_ICON_NAMES.map((icon) => (
            <button
              key={icon}
              type='button'
              title={STATUS_ICON_LABELS[icon]}
              aria-label={STATUS_ICON_LABELS[icon]}
              aria-pressed={value === icon}
              onClick={() => onChange(icon)}
              className={cn(
                'hover:bg-muted flex size-10 items-center justify-center rounded-md border border-transparent',
                value === icon && 'border-ring bg-muted'
              )}
              style={color ? { color } : undefined}
            >
              <StatusIconGlyph icon={icon} className='size-5' />
            </button>
          ))}
        </div>
        <button
          type='button'
          onClick={() => onChange(null)}
          aria-pressed={value === null}
          className={cn(
            'hover:bg-muted text-muted-foreground mt-2 w-full rounded-md px-2 py-1.5 text-left text-xs',
            value === null && 'bg-muted text-foreground'
          )}
        >
          Automatic — pick from the name
        </button>
      </PopoverContent>
    </Popover>
  );
}

function ManageOptionsDialog({
  open,
  onOpenChange,
  title,
  description,
  itemLabel,
  items,
  withColor = false,
  withIcon = false,
  onAdd,
  onEdit,
  onDelete,
  onDone
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  itemLabel: string;
  items: { id: string; name: string; color?: string | null; icon?: string | null }[];
  /** Shows color pickers when adding and editing an option. */
  withColor?: boolean;
  /** Shows the status icon picker (statuses only). */
  withIcon?: boolean;
  onAdd: (
    name: string,
    color?: string | null,
    icon?: StatusIconName | null
  ) => Promise<IssueActionResult>;
  onEdit: (
    id: string,
    name: string,
    color?: string | null,
    icon?: StatusIconName | null
  ) => Promise<IssueActionResult>;
  onDelete: (id: string) => Promise<IssueActionResult>;
  onDone: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#64748b');
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingColor, setEditingColor] = useState('#64748b');
  /** null = pick from the name. */
  const [newIcon, setNewIcon] = useState<StatusIconName | null>(null);
  const [editingIcon, setEditingIcon] = useState<StatusIconName | null>(null);

  function reset() {
    setNewName('');
    setNewColor('#64748b');
    setNewIcon(null);
    setError(undefined);
    setEditingId(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <ul className='space-y-1'>
          {items.map((item) => (
            <li key={item.id} className='flex items-center gap-2 rounded-md border p-2'>
              {editingId === item.id ? (
                <>
                  {withIcon && (
                    <StatusIconPicker
                      name={editingName}
                      color={withColor ? editingColor : null}
                      value={editingIcon}
                      onChange={setEditingIcon}
                    />
                  )}
                  {withColor && (
                    <input
                      aria-label={`${itemLabel} color`}
                      type='color'
                      value={editingColor}
                      onChange={(event) => setEditingColor(event.target.value)}
                      className='h-8 w-10 shrink-0 cursor-pointer rounded-md border p-1'
                    />
                  )}
                  <Input
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    minLength={1}
                    maxLength={40}
                    autoFocus
                    className='h-8'
                  />
                  <Button
                    size='sm'
                    disabled={pending}
                    onClick={() => {
                      setError(undefined);
                      startTransition(async () => {
                        const result = await onEdit(
                          item.id,
                          editingName,
                          withColor ? editingColor : undefined,
                          withIcon ? editingIcon : undefined
                        );
                        if (!result.ok) {
                          setError(result.error ?? `Could not edit this ${itemLabel}`);
                          return;
                        }
                        setEditingId(null);
                        onDone();
                      });
                    }}
                  >
                    Save
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={pending}
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  {withIcon ? (
                    <StatusIcon name={item.name} color={item.color} icon={item.icon} />
                  ) : (
                    withColor && (
                      <span
                        className='size-3 shrink-0 rounded-full border'
                        style={{ backgroundColor: item.color ?? undefined }}
                        aria-hidden='true'
                      />
                    )
                  )}
                  <span className='flex-1 text-sm'>{item.name.replaceAll('_', ' ')}</span>
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={pending}
                    onClick={() => {
                      setError(undefined);
                      setEditingId(item.id);
                      setEditingName(item.name);
                      setEditingColor(item.color ?? '#64748b');
                      setEditingIcon(
                        STATUS_ICON_NAMES.includes(item.icon as StatusIconName)
                          ? (item.icon as StatusIconName)
                          : null
                      );
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={pending}
                    onClick={() => {
                      setError(undefined);
                      startTransition(async () => {
                        const result = await onDelete(item.id);
                        if (!result.ok) {
                          setError(result.error ?? `Could not remove this ${itemLabel}`);
                          return;
                        }
                        onDone();
                      });
                    }}
                  >
                    Remove
                  </Button>
                </>
              )}
            </li>
          ))}
          {items.length === 0 && (
            <li className='text-muted-foreground py-4 text-center text-xs'>None yet.</li>
          )}
        </ul>

        <form
          className='flex items-end gap-2'
          onSubmit={(event) => {
            event.preventDefault();
            setError(undefined);
            startTransition(async () => {
              const result = await onAdd(
                newName,
                withColor ? newColor : undefined,
                withIcon ? newIcon : undefined
              );
              if (!result.ok) {
                setError(result.error ?? `Could not add this ${itemLabel}`);
                return;
              }
              setNewName('');
              setNewIcon(null);
              onDone();
            });
          }}
        >
          {withIcon && (
            <div className='space-y-2'>
              <Label>Icon</Label>
              <StatusIconPicker
                name={newName}
                color={withColor ? newColor : null}
                value={newIcon}
                onChange={setNewIcon}
              />
            </div>
          )}
          {withColor && (
            <div className='space-y-2'>
              <Label htmlFor={`new-${itemLabel}-color`}>Color</Label>
              <input
                id={`new-${itemLabel}-color`}
                type='color'
                aria-label='Color'
                value={newColor}
                onChange={(event) => setNewColor(event.target.value)}
                className='h-9 w-10 cursor-pointer rounded-md border p-1'
              />
            </div>
          )}
          <div className='flex-1 space-y-2'>
            <Label htmlFor={`new-${itemLabel}-name`}>New {itemLabel} name</Label>
            <Input
              id={`new-${itemLabel}-name`}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              minLength={1}
              maxLength={40}
              required
            />
          </div>
          <Button type='submit' disabled={pending}>
            {pending ? 'Working…' : 'Add'}
          </Button>
        </form>

        {error && (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}

function IssueModal({
  projectId,
  issue,
  members,
  types,
  priorities,
  statuses,
  availableDocs,
  availableDrawings,
  disabled,
  onClose,
  onSave,
  onMove,
  onDelete
}: {
  projectId: string;
  issue: BoardIssue;
  members: { id: string; username: string; name: string | null }[];
  types: { id: string; name: string; color: string | null }[];
  priorities: { id: string; name: string; color: string | null }[];
  statuses: string[];
  availableDocs: PickerDoc[];
  availableDrawings: PickerDrawing[];
  disabled: boolean;
  onClose: () => void;
  onSave: (data: IssueEdits) => void;
  onMove: (status: string) => void;
  /** Moves the task to the archive. */
  onDelete: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description ?? '');
  const [type, setType] = useState(issue.type);
  const [priority, setPriority] = useState(issue.priority);
  const [assigneeId, setAssigneeId] = useState(issue.assigneeId ?? '');
  const [targetDate, setTargetDate] = useState(issue.targetDate ?? '');
  const [linkedDocs, setLinkedDocs] = useState(issue.linkedDocs ?? []);
  const [linkedDrawings, setLinkedDrawings] = useState(issue.linkedDrawings ?? []);
  const [drawingError, setDrawingError] = useState<string>();

  function changeDrawingLink(drawing: PickerDrawing, link: boolean) {
    setDrawingError(undefined);
    setLinkedDrawings((current) =>
      link ? [drawing, ...current] : current.filter((entry) => entry.id !== drawing.id)
    );
    startLinkTransition(async () => {
      const action = link ? linkDrawingToIssueAction : unlinkDrawingFromIssueAction;
      const result = await action({ projectId, drawingId: drawing.id, issueId: issue.id });
      if (!result.ok) {
        setLinkedDrawings((current) =>
          link ? current.filter((entry) => entry.id !== drawing.id) : [drawing, ...current]
        );
        setDrawingError(result.error ?? 'Could not update the drawing link');
        return;
      }
      router.refresh();
    });
  }
  const [linkPending, startLinkTransition] = useTransition();
  const [linkError, setLinkError] = useState<string>();

  function addDocLink(doc: PickerDoc) {
    setLinkError(undefined);
    setLinkedDocs((current) => [doc, ...current]);
    startLinkTransition(async () => {
      const result = await linkDocToIssueAction({
        projectId,
        docId: doc.id,
        issueId: issue.id
      });
      if (!result.ok) {
        setLinkedDocs((current) => current.filter((entry) => entry.id !== doc.id));
        setLinkError(result.error ?? 'Could not link the page');
        return;
      }
      router.refresh();
    });
  }

  function removeDocLink(doc: PickerDoc) {
    setLinkError(undefined);
    setLinkedDocs((current) => current.filter((entry) => entry.id !== doc.id));
    startLinkTransition(async () => {
      const result = await unlinkDocFromIssueAction({
        projectId,
        docId: doc.id,
        issueId: issue.id
      });
      if (!result.ok) {
        setLinkedDocs((current) => [doc, ...current]);
        setLinkError(result.error ?? 'Could not remove the link');
        return;
      }
      router.refresh();
    });
  }

  const dirty =
    title.trim() !== issue.title ||
    (description.trim() || '') !== (issue.description ?? '') ||
    type !== issue.type ||
    priority !== issue.priority ||
    (assigneeId || '') !== (issue.assigneeId ?? '') ||
    targetDate !== (issue.targetDate ?? '');

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90svh] overflow-y-auto sm:max-w-5xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <span
              className={cn('size-2.5 rounded-full', TYPE_DOT[issue.type] ?? 'bg-muted-foreground')}
              aria-hidden='true'
            />
            {issue.issueKey}
          </DialogTitle>
          <DialogDescription>
            {issue.type} · {issue.priority}
            {issue.gitLinkCount > 0
              ? ` · ${issue.gitLinkCount} git link${issue.gitLinkCount === 1 ? '' : 's'}`
              : ''}
            {(issue.commentCount ?? 0) > 0 ? ` · ${issue.commentCount} comments` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]'>
          <div className='min-w-0 space-y-3'>
            <div className='space-y-2'>
              <Label htmlFor='modal-title'>Title</Label>
              <Input
                id='modal-title'
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                disabled={disabled}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='modal-description'>Description</Label>
              <RichMarkdownEditor
                markdown={description}
                onChange={setDescription}
                readOnly={disabled}
              />
            </div>

            <div className='space-y-2'>
              <Label>Linked docs</Label>
              <div className='flex flex-wrap items-center gap-2'>
                {linkedDocs.map((doc) => (
                  <span
                    key={doc.id}
                    className='bg-muted flex items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-xs'
                  >
                    <Link
                      href={`/projects/${projectId}/docs?page=${doc.slug}`}
                      className='flex items-center gap-1.5 hover:underline'
                    >
                      <Icons.post className='text-muted-foreground size-3.5' aria-hidden='true' />
                      {doc.title}
                    </Link>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-xs'
                      aria-label={`Unlink ${doc.title}`}
                      disabled={linkPending || disabled}
                      onClick={() => removeDocLink(doc)}
                    >
                      <Icons.close />
                    </Button>
                  </span>
                ))}
                <DocPicker
                  docs={availableDocs.filter(
                    (doc) => !linkedDocs.some((linked) => linked.id === doc.id)
                  )}
                  onSelect={addDocLink}
                  disabled={linkPending || disabled}
                />
              </div>
              {linkError && <p className='text-destructive text-xs'>{linkError}</p>}
            </div>

            <LinkedDrawingsField
              projectId={projectId}
              drawings={linkedDrawings}
              available={availableDrawings}
              disabled={linkPending || disabled}
              onAdd={(drawing) => changeDrawingLink(drawing, true)}
              onRemove={(drawing) => changeDrawingLink(drawing, false)}
              error={drawingError}
            />
          </div>

          <div className='space-y-3 lg:border-l lg:pl-6'>
            <p className='text-muted-foreground text-xs'>
              Created by{' '}
              <span className='text-foreground font-medium'>
                {personLabel(issue.creator, issue.creatorName)}
              </span>
            </p>

            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-2'>
                <Label htmlFor='modal-type'>Type</Label>
                <NativeSelect
                  id='modal-type'
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                  disabled={disabled}
                  className='w-full'
                >
                  {types.map((option) => (
                    <option key={option.id} value={option.name}>
                      {option.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='modal-priority'>Priority</Label>
                <NativeSelect
                  id='modal-priority'
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                  disabled={disabled}
                  className='w-full'
                >
                  {priorities.map((option) => (
                    <option key={option.id} value={option.name}>
                      {option.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='modal-assignee'>Assignee</Label>
              <Combobox
                items={[
                  { value: '', label: 'Unassigned' },
                  ...members.map((member) => ({
                    value: member.id,
                    label: personLabel(member.username, member.name)
                  }))
                ]}
                value={assigneeId}
                itemToStringLabel={(value) =>
                  value
                    ? personLabel(
                        members.find((member) => member.id === value)?.username ?? value,
                        members.find((member) => member.id === value)?.name ?? null
                      )
                    : 'Unassigned'
                }
                onValueChange={(value) => setAssigneeId(value ?? '')}
              >
                <ComboboxInput
                  id='modal-assignee'
                  placeholder='Search people…'
                  disabled={disabled}
                  className='w-full'
                />
                <ComboboxContent>
                  <ComboboxEmpty>No matches</ComboboxEmpty>
                  <ComboboxList>
                    {(item: { value: string; label: string }) => (
                      <ComboboxItem key={item.value || 'unassigned'} value={item.value}>
                        {item.label}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>

            <div className='space-y-3'>
              <div className='space-y-2'>
                <Label htmlFor='modal-status'>Status</Label>
                <NativeSelect
                  id='modal-status'
                  value={issue.status}
                  onChange={(event) => onMove(event.target.value)}
                  disabled={disabled}
                  className='w-full'
                >
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {status.replaceAll('_', ' ')}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <TargetDateField
                id='modal-target-date'
                value={targetDate}
                onChange={setTargetDate}
                disabled={disabled}
              />
            </div>

            <div className='space-y-2 border-t pt-3'>
              <Label>Branches &amp; pull requests</Label>
              <IssueGitLinks
                issueId={issue.id}
                disabled={disabled}
                onLinksChange={() => router.refresh()}
              />
            </div>

            <div className='space-y-2 border-t pt-3'>
              <Label>History</Label>
              <IssueHistory
                issueId={issue.id}
                refreshKey={`${issue.status}|${issue.priority}|${issue.assigneeId}|${issue.targetDate}`}
              />
            </div>
          </div>
        </div>

        <div className='flex justify-end gap-2 border-t pt-3'>
          <Button
            variant='ghost'
            className='text-muted-foreground hover:text-destructive mr-auto'
            onClick={onDelete}
            disabled={disabled}
          >
            <Icons.trash aria-hidden='true' />
            Delete task
          </Button>
          <Button variant='outline' onClick={onClose} disabled={disabled}>
            Close
          </Button>
          <Button
            disabled={disabled || !dirty || title.trim().length < 3}
            onClick={() => {
              onSave({
                title: title.trim(),
                description: description.trim(),
                type,
                priority,
                assigneeId: assigneeId || null,
                targetDate: targetDate || null
              });
              onClose();
            }}
          >
            {disabled ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateIssueModal({
  projectId,
  boardId,
  types,
  priorities,
  members,
  statuses,
  initialStatus,
  initialTargetDate,
  availableDocs,
  availableDrawings,
  disabled,
  onClose,
  onError
}: {
  projectId: string;
  boardId: string;
  types: { id: string; name: string; color: string | null }[];
  priorities: { id: string; name: string; color: string | null }[];
  members: { id: string; username: string; name: string | null }[];
  statuses: string[];
  initialStatus: string;
  /** YYYY-MM-DD, when started from a calendar day. */
  initialTargetDate?: string | null;
  availableDocs: PickerDoc[];
  availableDrawings: PickerDrawing[];
  disabled: boolean;
  onClose: () => void;
  onError: (message?: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [description, setDescription] = useState('');
  const [linkedDocs, setLinkedDocs] = useState<PickerDoc[]>([]);
  const [linkedDrawings, setLinkedDrawings] = useState<PickerDrawing[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [targetDate, setTargetDate] = useState(initialTargetDate ?? '');
  const [title, setTitle] = useState('');
  const [branch, setBranch] = useState<BranchChoice | null>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90svh] overflow-y-auto sm:max-w-5xl'>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Adds a task to this project.</DialogDescription>
        </DialogHeader>
        <form
          className='space-y-3'
          onSubmit={(event) => {
            event.preventDefault();
            onError(undefined);
            const form = event.currentTarget;
            const data = new FormData(form);
            startTransition(async () => {
              const result = await createIssueAction({
                projectId,
                boardId,
                title: String(data.get('title') ?? ''),
                description: description.trim() || undefined,
                type: String(data.get('type') ?? types[0]?.name ?? ''),
                status: String(data.get('status') ?? initialStatus),
                priority: String(data.get('priority') ?? priorities[0]?.name ?? ''),
                assigneeId: assigneeId || null,
                sprintId: null,
                targetDate: targetDate || null,
                branch,
                docIds: linkedDocs.map((doc) => doc.id),
                drawingIds: linkedDrawings.map((drawing) => drawing.id)
              });
              if (!result.ok) {
                onError(result.error ?? 'Could not create the task');
                return;
              }
              if (result.detail) onError(result.detail);
              onClose();
              router.refresh();
            });
          }}
        >
          <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]'>
            <div className='min-w-0 space-y-3'>
              <div className='space-y-2'>
                <Label htmlFor='create-title'>Title</Label>
                <Input
                  id='create-title'
                  name='title'
                  required
                  minLength={3}
                  maxLength={200}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='create-description'>Description</Label>
                <RichMarkdownEditor
                  markdown={description}
                  onChange={setDescription}
                  readOnly={pending || disabled}
                />
              </div>

              <div className='space-y-2'>
                <Label>Linked docs</Label>
                <div className='flex flex-wrap items-center gap-2'>
                  {linkedDocs.map((doc) => (
                    <span
                      key={doc.id}
                      className='bg-muted flex items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-xs'
                    >
                      <Icons.post className='text-muted-foreground size-3.5' aria-hidden='true' />
                      {doc.title}
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-xs'
                        aria-label={`Remove ${doc.title}`}
                        disabled={pending || disabled}
                        onClick={() =>
                          setLinkedDocs((current) => current.filter((entry) => entry.id !== doc.id))
                        }
                      >
                        <Icons.close />
                      </Button>
                    </span>
                  ))}
                  <DocPicker
                    docs={availableDocs.filter(
                      (doc) => !linkedDocs.some((linked) => linked.id === doc.id)
                    )}
                    onSelect={(doc) => setLinkedDocs((current) => [...current, doc])}
                    disabled={pending || disabled}
                  />
                </div>
              </div>

              <LinkedDrawingsField
                projectId={projectId}
                drawings={linkedDrawings}
                available={availableDrawings}
                disabled={pending || disabled}
                onAdd={(drawing) => setLinkedDrawings((current) => [...current, drawing])}
                onRemove={(drawing) =>
                  setLinkedDrawings((current) => current.filter((entry) => entry.id !== drawing.id))
                }
              />
            </div>

            <div className='space-y-3 lg:border-l lg:pl-6'>
              <div className='grid grid-cols-2 gap-3'>
                <div className='space-y-2'>
                  <Label htmlFor='create-type'>Type</Label>
                  <NativeSelect id='create-type' name='type' className='w-full'>
                    {types.map((type) => (
                      <option key={type.id} value={type.name}>
                        {type.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='create-priority'>Priority</Label>
                  <NativeSelect id='create-priority' name='priority' className='w-full'>
                    {priorities.map((priority) => (
                      <option key={priority.id} value={priority.name}>
                        {priority.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>

              <div className='space-y-2'>
                <Label htmlFor='create-assignee'>Assignee</Label>
                <Combobox
                  items={[
                    { value: '', label: 'Unassigned' },
                    ...members.map((member) => ({
                      value: member.id,
                      label: personLabel(member.username, member.name)
                    }))
                  ]}
                  value={assigneeId}
                  itemToStringLabel={(value) =>
                    value
                      ? personLabel(
                          members.find((member) => member.id === value)?.username ?? value,
                          members.find((member) => member.id === value)?.name ?? null
                        )
                      : 'Unassigned'
                  }
                  onValueChange={(value) => setAssigneeId(value ?? '')}
                >
                  <ComboboxInput
                    id='create-assignee'
                    placeholder='Search people…'
                    disabled={pending || disabled}
                    className='w-full'
                  />
                  <ComboboxContent>
                    <ComboboxEmpty>No matches</ComboboxEmpty>
                    <ComboboxList>
                      {(item: { value: string; label: string }) => (
                        <ComboboxItem key={item.value || 'unassigned'} value={item.value}>
                          {item.label}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </div>

              <div className='space-y-2'>
                <Label htmlFor='create-status'>Status</Label>
                <NativeSelect
                  id='create-status'
                  name='status'
                  defaultValue={initialStatus}
                  className='w-full'
                >
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {status.replaceAll('_', ' ')}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <TargetDateField
                id='create-target-date'
                value={targetDate}
                onChange={setTargetDate}
                disabled={pending || disabled}
              />

              <div className='space-y-2 border-t pt-3'>
                <Label>
                  Branch <span className='text-muted-foreground font-normal'>(optional)</span>
                </Label>
                <NewTaskBranchField
                  projectId={projectId}
                  title={title}
                  disabled={pending || disabled}
                  onChange={setBranch}
                />
              </div>
            </div>
          </div>

          <div className='flex justify-end gap-2 border-t pt-3'>
            <Button
              type='button'
              variant='outline'
              onClick={onClose}
              disabled={pending || disabled}
            >
              Cancel
            </Button>
            <Button type='submit' disabled={pending || disabled}>
              {pending ? 'Creating…' : 'Create task'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The optional target date input, with a way to clear it. */
function TargetDateField({
  id,
  value,
  onChange,
  disabled
}: {
  id: string;
  /** YYYY-MM-DD, or '' for none. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Read and write the plain calendar day; no time zone shifts.
  const selected = value ? parseISO(value) : undefined;

  return (
    <div className='space-y-2'>
      <Label htmlFor={id}>
        Target date <span className='text-muted-foreground font-normal'>(optional)</span>
      </Label>
      <div className='flex items-center gap-1'>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                id={id}
                type='button'
                variant='outline'
                disabled={disabled}
                className={cn(
                  'min-w-0 flex-1 justify-start font-normal',
                  !selected && 'text-muted-foreground'
                )}
              />
            }
          >
            <Icons.calendar className='size-4' aria-hidden='true' />
            {selected ? format(selected, 'EEE, MMM d, yyyy') : 'Pick a date'}
          </PopoverTrigger>
          <PopoverContent className='w-auto p-0' align='start'>
            <Calendar
              autoFocus
              mode='single'
              selected={selected}
              defaultMonth={selected}
              onSelect={(date) => {
                onChange(date ? format(date, 'yyyy-MM-dd') : '');
                setOpen(false);
              }}
            />
            <div className='flex gap-1 border-t p-2'>
              {[
                { label: 'Today', days: 0 },
                { label: 'Tomorrow', days: 1 },
                { label: 'In a week', days: 7 }
              ].map((option) => (
                <Button
                  key={option.label}
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='h-7 flex-1 text-xs'
                  onClick={() => {
                    onChange(format(addDays(new Date(), option.days), 'yyyy-MM-dd'));
                    setOpen(false);
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {value && (
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            aria-label='Clear the target date'
            disabled={disabled}
            onClick={() => onChange('')}
          >
            <Icons.close className='size-3.5' />
          </Button>
        )}
      </div>
    </div>
  );
}
