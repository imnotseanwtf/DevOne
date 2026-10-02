'use client';

import { cn } from '@/lib/utils';

/** The Excalidraw app to embed; set NEXT_PUBLIC_EXCALIDRAW_URL to use a self-hosted copy. */
export const EXCALIDRAW_APP_URL =
  process.env.NEXT_PUBLIC_EXCALIDRAW_URL || 'https://excalidraw.com';

/** The shareable link for a live room ("<roomId>,<roomKey>"). */
export const liveRoomUrl = (room: string) => `${EXCALIDRAW_APP_URL}/#room=${room}`;

/**
 * An excalidraw.com collaboration session, embedded. Everyone who opens the drawing
 * joins the same room and sees the others' cursors live. The session is stored and
 * end-to-end encrypted by Excalidraw; DevOne only keeps the link.
 *
 * The embedded app keeps its own (light) theme, so in dark mode the frame is inverted
 * the same way Excalidraw draws its own dark theme (invert + hue-rotate), which keeps
 * colors recognizable.
 */
export function LiveExcalidrawFrame({
  room,
  originalColors = false
}: {
  room: string;
  /** Skips the dark-mode inversion, for when the embedded app is already dark. */
  originalColors?: boolean;
}) {
  return (
    <iframe
      title='Excalidraw live session'
      src={liveRoomUrl(room)}
      // A CSS `dark:` class rather than the resolved theme, so server and client render alike.
      className={cn(
        'size-full border-0 transition-[filter]',
        !originalColors && 'dark:[filter:invert(93%)_hue-rotate(180deg)]'
      )}
      allow='clipboard-read; clipboard-write; fullscreen'
      // Excalidraw needs scripts, its own origin's storage and popups (share, export).
      // The combination is only unsafe for a same-origin frame; this one is cross-origin.
      // eslint-disable-next-line react/iframe-missing-sandbox
      sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals'
    />
  );
}
