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
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  deleteDrawingAction,
  importLiveSessionAction,
  setDrawingLiveAction,
  linkDrawingToIssueAction,
  renameDrawingAction,
  saveDrawingSceneAction,
  unlinkDrawingFromIssueAction
} from '@/features/drawings/actions';
import type {
  DrawingCanvasProps,
  InitialScene,
  LivePerson
} from '@/features/drawings/components/drawing-canvas';
import { DrawioCanvas } from '@/features/drawings/components/drawio-canvas';
import {
  LiveExcalidrawFrame,
  liveRoomUrl
} from '@/features/drawings/components/live-excalidraw-frame';
import { IssuePicker, type PickerIssue } from '@/features/issues/components/issue-picker';
import { collaboratorColor } from '@/lib/drawings/live-sync';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

// Excalidraw touches `window` on import, so it only ever loads in the browser.
const DrawingCanvas = dynamic<DrawingCanvasProps>(
  () => import('@/features/drawings/components/drawing-canvas'),
  {
    ssr: false,
    loading: () => <div className='bg-muted/40 h-full animate-pulse' />
  }
);

const ORIGINAL_COLORS_KEY = 'devone:live-sketch-original-colors';

/** Quiet time after the last stroke before the scene is saved. */
const AUTOSAVE_MS = 1200;

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

export function DrawingWorkspace({
  projectId,
  drawingId,
  initialTitle,
  kind,
  scene,
  live: initialLive,
  initialScene,
  liveRoom,
  linkedIssues: initialLinkedIssues,
  availableIssues
}: {
  projectId: string;
  drawingId: string;
  initialTitle: string;
  kind: 'EXCALIDRAW' | 'DRAWIO';
  scene: unknown;
  /** Excalidraw: whether open copies sync live, with cursors. */
  live: boolean;
  /** Excalidraw sketches: the synced shapes the editor opens with. */
  initialScene: InitialScene | null;
  /** Set for Excalidraw live sessions, which are stored by Excalidraw, not here. */
  liveRoom: string | null;
  linkedIssues: PickerIssue[];
  availableIssues: PickerIssue[];
}) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [title, setTitle] = useState(initialTitle);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [people, setPeople] = useState<LivePerson[]>([]);
  const [live, setLive] = useState(initialLive);
  const [liveChanging, startLiveChange] = useTransition();
  const toggleLive = (next: boolean) => {
    setLive(next);
    if (!next) setPeople([]);
    startLiveChange(async () => {
      const result = await setDrawingLiveAction({ projectId, drawingId, live: next });
      if (!result.ok) {
        setLive(!next);
        toast.error(result.error ?? 'Could not change the sketch');
      }
    });
  };
  const [error, setError] = useState<string>();
  const [linkedIssues, setLinkedIssues] = useState(initialLinkedIssues);
  const [linkPending, startLink] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light';
  // In dark mode the live session is inverted to match; this turns that off per browser.
  const [originalColors, setOriginalColors] = useState(false);
  useEffect(() => {
    try {
      setOriginalColors(localStorage.getItem(ORIGINAL_COLORS_KEY) === '1');
    } catch {
      // Storage can be unavailable (private mode); the default is fine.
    }
  }, []);
  const toggleOriginalColors = () =>
    setOriginalColors((current) => {
      try {
        localStorage.setItem(ORIGINAL_COLORS_KEY, current ? '0' : '1');
      } catch {
        // Not remembered, but still applied.
      }
      return !current;
    });

  const [importing, startImport] = useTransition();
  /** Copies the live session's drawing into DevOne; it then opens in the bundled editor. */
  const importLiveSession = () =>
    startImport(async () => {
      const result = await importLiveSessionAction({ projectId, drawingId });
      if (!result.ok) {
        toast.error(result.error ?? 'Could not import the live session');
        return;
      }
      toast.success('Imported. This sketch is now saved in DevOne.');
      router.refresh();
    });

  const copyLiveLink = () => {
    if (!liveRoom) return;
    void navigator.clipboard
      .writeText(liveRoomUrl(liveRoom))
      .then(() => toast.success('Session link copied'))
      .catch(() => toast.error('Could not copy the link'));
  };

  // Esc leaves full screen (Excalidraw also uses Esc, but only inside the canvas).
  useEffect(() => {
    if (!fullScreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setFullScreen(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [fullScreen]);
  const [deleting, startDelete] = useTransition();

  const pending = useRef<(() => string) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string | null>(null);
  const savingChain = useRef(Promise.resolve());

  /** Saves the latest scene if it changed; saves run one after another. */
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const serialize = pending.current;
    pending.current = null;
    if (!serialize) return;
    const next = serialize();
    // The editor reports a change on load too; only real edits get saved.
    if (lastSaved.current === null) {
      lastSaved.current = next;
      setSaveState('saved');
      return;
    }
    if (next === lastSaved.current) {
      setSaveState('saved');
      return;
    }
    setSaveState('saving');
    savingChain.current = savingChain.current.then(async () => {
      const result = await saveDrawingSceneAction({ projectId, drawingId, scene: next });
      if (!result.ok) {
        setError(result.error ?? 'Could not save the drawing');
        setSaveState('error');
        return;
      }
      lastSaved.current = next;
      setError(undefined);
      setSaveState(pending.current ? 'unsaved' : 'saved');
    });
  };

  const lastFingerprint = useRef<string | null>(null);

  const onSceneChange = (fingerprint: string, serialize: () => string) => {
    // Excalidraw reports changes while idle too; only a new fingerprint is an edit.
    if (fingerprint === lastFingerprint.current) return;
    const first = lastFingerprint.current === null;
    lastFingerprint.current = fingerprint;
    pending.current = serialize;
    if (!first) setSaveState('unsaved');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, first ? 0 : AUTOSAVE_MS);
  };

  // Leaving the drawing (or the page) saves what's pending instead of dropping it.
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!pending.current) return;
      flush();
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rename = () => {
    const next = title.trim();
    if (!next || next === initialTitle) {
      setTitle(initialTitle);
      return;
    }
    void renameDrawingAction({ projectId, drawingId, title: next }).then((result) => {
      if (!result.ok) {
        setTitle(initialTitle);
        setError(result.error ?? 'Could not rename the drawing');
        return;
      }
      router.refresh();
    });
  };

  const changeLink = (issue: PickerIssue, link: boolean) => {
    setError(undefined);
    setLinkedIssues((current) =>
      link ? [issue, ...current] : current.filter((entry) => entry.id !== issue.id)
    );
    startLink(async () => {
      const action = link ? linkDrawingToIssueAction : unlinkDrawingFromIssueAction;
      const result = await action({ projectId, drawingId, issueId: issue.id });
      if (!result.ok) {
        setLinkedIssues((current) =>
          link ? current.filter((entry) => entry.id !== issue.id) : [issue, ...current]
        );
        setError(result.error ?? 'Could not update the link');
      }
    });
  };

  const remove = () =>
    startDelete(async () => {
      pending.current = null;
      const result = await deleteDrawingAction({ projectId, drawingId });
      if (!result.ok) {
        setError(result.error ?? 'Could not delete the drawing');
        setDeleteOpen(false);
        return;
      }
      router.replace(`/projects/${projectId}/drawings`);
      router.refresh();
    });

  return (
    <div className='flex min-w-0 flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-3'>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={rename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setTitle(initialTitle);
              event.currentTarget.blur();
            }
          }}
          maxLength={120}
          aria-label='Drawing name'
          className='h-9 max-w-sm text-base font-semibold'
        />
        {liveRoom ? (
          <span className='flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'>
            <span className='relative flex size-2'>
              <span className='absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60' />
              <span className='relative inline-flex size-2 rounded-full bg-emerald-500' />
            </span>
            excalidraw.com session
          </span>
        ) : (
          <span
            role='status'
            className={cn(
              'text-muted-foreground flex items-center gap-1.5 text-xs',
              saveState === 'error' && 'text-destructive'
            )}
          >
            {saveState === 'saving' ? (
              <Icons.spinner className='size-3.5 animate-spin' aria-hidden='true' />
            ) : saveState === 'saved' ? (
              <Icons.check className='size-3.5' aria-hidden='true' />
            ) : null}
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'unsaved'
                ? 'Unsaved changes'
                : saveState === 'error'
                  ? 'Not saved'
                  : 'Saved'}
          </span>
        )}
        {people.length > 0 && (
          <span className='flex items-center gap-2 text-xs'>
            <span className='flex -space-x-1.5'>
              {people.slice(0, 5).map((person) => (
                <span
                  key={person.id}
                  title={person.name}
                  style={{
                    backgroundColor: collaboratorColor(person.userId).background,
                    color: collaboratorColor(person.userId).stroke
                  }}
                  className='ring-background flex size-6 items-center justify-center rounded-full text-[10px] font-semibold uppercase ring-2'
                >
                  {person.name.slice(0, 2)}
                </span>
              ))}
            </span>
            <span className='font-medium text-emerald-600 dark:text-emerald-400'>
              Live · {people.length === 1 ? people[0].name : `${people.length} others`} here
            </span>
          </span>
        )}
        {saveState === 'error' && kind === 'DRAWIO' && (
          <Button type='button' variant='outline' size='sm' onClick={flush}>
            Retry
          </Button>
        )}
        <div className='ml-auto flex flex-wrap items-center gap-2'>
          {initialScene && (
            <label
              className='flex items-center gap-2 text-xs font-medium'
              title='Live: everyone who opens this sketch draws together with live cursors. Off: saved in DevOne, others see changes after reopening.'
            >
              <Switch
                checked={live}
                disabled={liveChanging}
                onCheckedChange={toggleLive}
                aria-label='Live collaboration'
              />
              {live ? 'Live' : 'Local'}
            </label>
          )}
          {liveRoom && (
            <>
              {/* Only matters in dark mode; a CSS class keeps server and client HTML equal. */}
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='hidden dark:inline-flex'
                aria-pressed={originalColors}
                onClick={toggleOriginalColors}
                title='The session is shown in dark colors to match DevOne; turn this on to see its original colors'
              >
                <Icons.palette aria-hidden='true' />
                {originalColors ? 'Match dark theme' : 'Original colors'}
              </Button>
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={importing}
                onClick={importLiveSession}
                title='Save a copy of this session in DevOne and edit it here from now on'
              >
                {importing ? (
                  <Icons.spinner className='animate-spin' aria-hidden='true' />
                ) : (
                  <Icons.import aria-hidden='true' />
                )}
                Import into DevOne
              </Button>
              <Button type='button' variant='outline' size='sm' onClick={copyLiveLink}>
                <Icons.copy aria-hidden='true' />
                Copy link
              </Button>
              <Button
                variant='outline'
                size='sm'
                nativeButton={false}
                render={
                  <a
                    href={liveRoomUrl(liveRoom)}
                    target='_blank'
                    rel='noreferrer noopener'
                    aria-label='Open this session in Excalidraw'
                  />
                }
              >
                <Icons.externalLink aria-hidden='true' />
                Open in Excalidraw
              </Button>
            </>
          )}
          <Button type='button' variant='outline' size='sm' onClick={() => setFullScreen(true)}>
            <Icons.maximize aria-hidden='true' />
            Full screen
          </Button>
        </div>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='text-muted-foreground hover:text-destructive'
          onClick={() => setDeleteOpen(true)}
        >
          <Icons.trash aria-hidden='true' />
          Delete
        </Button>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-muted-foreground text-xs'>Linked tasks</span>
        {linkedIssues.map((issue) => (
          <span
            key={issue.id}
            className='bg-muted flex items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-xs'
          >
            <Link href={`/projects/${projectId}/issues`} className='hover:underline'>
              <span className='text-muted-foreground'>{issue.issueKey}</span> {issue.title}
            </Link>
            <Button
              type='button'
              variant='ghost'
              size='icon-xs'
              aria-label={`Unlink ${issue.issueKey}`}
              disabled={linkPending}
              onClick={() => changeLink(issue, false)}
            >
              <Icons.close />
            </Button>
          </span>
        ))}
        <IssuePicker
          issues={availableIssues.filter(
            (issue) => !linkedIssues.some((linked) => linked.id === issue.id)
          )}
          onSelect={(issue) => changeLink(issue, true)}
          disabled={linkPending}
        />
      </div>

      {error && <p className='text-destructive text-sm'>{error}</p>}

      <div
        className={cn(
          'bg-background overflow-hidden',
          fullScreen
            ? 'fixed inset-0 z-50 flex flex-col'
            : 'h-[calc(100svh-17rem)] min-h-[32rem] rounded-xl border'
        )}
      >
        {fullScreen && (
          <div className='flex h-11 shrink-0 items-center gap-3 border-b px-3'>
            <span className='truncate text-sm font-semibold'>{title}</span>
            <span className='text-muted-foreground text-xs'>
              {liveRoom
                ? 'Live session'
                : saveState === 'saving'
                  ? 'Saving…'
                  : saveState === 'saved'
                    ? 'Saved'
                    : ''}
            </span>
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='ml-auto'
              onClick={() => setFullScreen(false)}
            >
              <Icons.minimize aria-hidden='true' />
              Exit full screen
            </Button>
          </div>
        )}
        <div className='min-h-0 flex-1 h-full'>
          {liveRoom ? (
            <LiveExcalidrawFrame room={liveRoom} originalColors={originalColors} />
          ) : kind === 'DRAWIO' ? (
            <DrawioCanvas
              xml={
                typeof (scene as { xml?: unknown } | null)?.xml === 'string'
                  ? (scene as { xml: string }).xml
                  : null
              }
              theme={theme}
              onChange={(xml) => onSceneChange(xml, () => JSON.stringify({ xml }))}
            />
          ) : (
            initialScene && (
              <DrawingCanvas
                projectId={projectId}
                drawingId={drawingId}
                initial={initialScene}
                live={live}
                theme={theme}
                onStatus={(status, message) => {
                  setSaveState(status);
                  setError(status === 'error' ? message : undefined);
                }}
                onPeople={setPeople}
              />
            )
          )}
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={(open) => !deleting && setDeleteOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {liveRoom
                ? 'The drawing and its links to tasks are removed from DevOne. The session link stops being listed here, but anyone who saved it can still open it on excalidraw.com.'
                : 'The drawing and its links to tasks are removed. This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant='destructive' disabled={deleting} onClick={remove}>
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
