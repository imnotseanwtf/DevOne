'use client';

import {
  CaptureUpdateAction,
  Excalidraw,
  reconcileElements,
  restoreElements
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type {
  BinaryFileData,
  Collaborator,
  ExcalidrawImperativeAPI,
  SocketId
} from '@excalidraw/excalidraw/types';
import { syncDrawingAction } from '@/features/drawings/actions';
import { collaboratorColor, SYNC_INTERVAL_MS, type SyncedElement } from '@/lib/drawings/live-sync';
import { useEffect, useMemo, useRef, useState } from 'react';

export type SyncStatus = 'saved' | 'saving' | 'error';

export interface LivePerson {
  /** The other tab's id. */
  id: string;
  userId: string;
  name: string;
}

export interface InitialScene {
  revision: number;
  elements: SyncedElement[];
  appState: { viewBackgroundColor: string };
  files: Record<string, Record<string, unknown>>;
}

export interface DrawingCanvasProps {
  projectId: string;
  drawingId: string;
  initial: InitialScene;
  /** Live: pull others' changes continuously and share cursors. Local: only save. */
  live: boolean;
  theme: 'light' | 'dark';
  /** Whether this copy's changes have reached the server. */
  onStatus: (status: SyncStatus, error?: string) => void;
  /** Everyone else who has the sketch open right now. */
  onPeople: (people: LivePerson[]) => void;
}

/** Waits this long after a stroke before sending it, so a drag goes out as one update. */
const PUSH_DELAY_MS = 250;

/**
 * Excalidraw with live sync through DevOne: every open copy sends the shapes it changed
 * and pulls everyone else's (see `syncDrawing`), merging with Excalidraw's own
 * `reconcileElements`. Other people show up as named cursors.
 */
export default function DrawingCanvas({
  projectId,
  drawingId,
  initial,
  live,
  theme,
  onStatus,
  onPeople
}: DrawingCanvasProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [together, setTogether] = useState(false);
  const callbacks = useRef({ onStatus, onPeople });
  callbacks.current = { onStatus, onPeople };

  const initialData = useMemo(
    () => ({
      elements: initial.elements as unknown as OrderedExcalidrawElement[],
      appState: initial.appState,
      files: initial.files as unknown as Record<string, BinaryFileData>,
      scrollToContent: true
    }),
    // Only the scene a sketch opened with seeds the editor; sync does the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Everything the sync loop needs survives re-renders in one ref.
  const state = useRef({
    /** The version of each shape the server has (sent by us, or received). */
    known: new Map(initial.elements.map((element) => [element.id, element.version])),
    revision: initial.revision,
    files: new Set(Object.keys(initial.files)),
    background: initial.appState.viewBackgroundColor,
    /** undefined: unchanged since the last sync. */
    pointer: undefined as { x: number; y: number } | null | undefined,
    clientId: crypto.randomUUID(),
    inflight: false,
    timer: null as ReturnType<typeof setTimeout> | null,
    people: 0
  });

  useEffect(() => {
    if (!api) return;
    const s = state.current;
    let stopped = false;

    const localChanges = () =>
      api
        .getSceneElementsIncludingDeleted()
        .filter((element) => s.known.get(element.id) !== element.version);

    const schedule = (delay?: number) => {
      if (stopped) return;
      // A local sketch only talks to the server when it has something to save.
      if (!live && delay === undefined) return;
      if (s.timer) clearTimeout(s.timer);
      const interval =
        document.visibilityState === 'hidden'
          ? SYNC_INTERVAL_MS.hidden
          : s.people > 0
            ? SYNC_INTERVAL_MS.together
            : SYNC_INTERVAL_MS.alone;
      s.timer = setTimeout(() => void sync(), delay ?? interval);
    };

    const sync = async () => {
      if (s.inflight) return schedule();
      s.inflight = true;
      const changed = localChanges();
      const files = api.getFiles();
      const newFiles = Object.fromEntries(Object.entries(files).filter(([id]) => !s.files.has(id)));
      const needFiles = [
        ...new Set(
          api
            .getSceneElements()
            .flatMap((element) =>
              element.type === 'image' && element.fileId && !files[element.fileId]
                ? [element.fileId]
                : []
            )
        )
      ];
      const background = api.getAppState().viewBackgroundColor;
      const pointer = s.pointer;
      if (changed.length > 0) callbacks.current.onStatus('saving');

      try {
        const result = await syncDrawingAction({
          projectId,
          drawingId,
          clientId: s.clientId,
          presence: live,
          since: s.revision,
          elements: changed,
          files: newFiles,
          needFiles,
          background: background !== s.background ? background : undefined,
          pointer: live ? pointer : undefined
        });
        if (stopped) return;
        if (!result.ok) {
          callbacks.current.onStatus('error', result.error);
          return;
        }

        for (const element of changed) s.known.set(element.id, element.version);
        for (const id of Object.keys(newFiles)) s.files.add(id);
        if (s.pointer === pointer) s.pointer = undefined;
        s.revision = result.revision;

        if (result.elements.length > 0) {
          const remote = restoreElements(
            result.elements as unknown as OrderedExcalidrawElement[],
            null
          );
          const merged = reconcileElements(
            api.getSceneElementsIncludingDeleted(),
            remote as never,
            api.getAppState()
          );
          const byId = new Map(merged.map((element) => [element.id, element]));
          for (const element of remote) {
            const kept = byId.get(element.id);
            // Only what we now show matches the server; an edit made while the request
            // was in flight stays "changed" and goes out next time.
            if (
              kept &&
              kept.version === element.version &&
              kept.versionNonce === element.versionNonce
            ) {
              s.known.set(element.id, element.version);
            }
          }
          api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
        }

        const current = api.getAppState().viewBackgroundColor;
        if (result.background !== current && current === background) {
          api.updateScene({
            appState: { viewBackgroundColor: result.background },
            captureUpdate: CaptureUpdateAction.NEVER
          });
        }
        s.background = result.background;

        const received = Object.values(result.files) as unknown as BinaryFileData[];
        if (received.length > 0) {
          api.addFiles(received);
          for (const file of received) s.files.add(file.id);
        }

        s.people = result.people.length;
        setTogether(result.people.length > 0);
        api.updateScene({
          collaborators: new Map<SocketId, Collaborator>(
            result.people.map((person) => [
              person.id as SocketId,
              {
                id: person.id,
                username: person.name,
                color: collaboratorColor(person.userId),
                pointer: person.pointer ? { ...person.pointer, tool: 'pointer' } : undefined
              }
            ])
          )
        });
        callbacks.current.onPeople(
          result.people.map(({ id, userId, name }) => ({ id, userId, name }))
        );
        callbacks.current.onStatus(localChanges().length > 0 ? 'saving' : 'saved');
      } catch {
        if (!stopped) callbacks.current.onStatus('error', 'Offline, retrying…');
      } finally {
        s.inflight = false;
        schedule(localChanges().length > 0 ? PUSH_DELAY_MS : undefined);
      }
    };

    // A local edit goes out shortly after the stroke instead of waiting for the next tick.
    const unsubscribe = api.onChange((elements) => {
      if (elements.some((element) => s.known.get(element.id) !== element.version)) {
        callbacks.current.onStatus('saving');
        if (!s.inflight) schedule(PUSH_DELAY_MS);
      }
    });
    const onVisibility = () => schedule(document.visibilityState === 'visible' ? 0 : undefined);
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (localChanges().length === 0) return;
      void sync();
      event.preventDefault();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    if (live) schedule(0);
    else {
      s.people = 0;
      setTogether(false);
      api.updateScene({ collaborators: new Map() });
      callbacks.current.onPeople([]);
    }

    return () => {
      stopped = true;
      if (s.timer) clearTimeout(s.timer);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Leaving the sketch sends what hasn't gone out yet.
      const changed = localChanges();
      if (changed.length > 0) {
        void syncDrawingAction({
          projectId,
          drawingId,
          clientId: s.clientId,
          presence: live,
          since: s.revision,
          elements: changed,
          files: {},
          needFiles: [],
          pointer: null
        });
      }
    };
  }, [api, projectId, drawingId, live]);

  return (
    <Excalidraw
      excalidrawAPI={setApi}
      initialData={initialData}
      theme={theme}
      isCollaborating={together}
      onPointerUpdate={({ pointer }) => {
        state.current.pointer = { x: pointer.x, y: pointer.y };
      }}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
    />
  );
}
