'use client';

import { useEffect, useRef, useState } from 'react';

/** The draw.io editor to embed; set NEXT_PUBLIC_DRAWIO_URL to use a self-hosted copy. */
const DRAWIO_URL = process.env.NEXT_PUBLIC_DRAWIO_URL || 'https://embed.diagrams.net';

const EMPTY_DIAGRAM =
  '<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

interface DrawioMessage {
  event?: string;
  xml?: string;
}

/**
 * draw.io in its official embed mode: the iframe asks for the diagram on `init`,
 * and with `autosave` it posts the XML back after every change. Nothing is
 * stored on diagrams.net; the XML only travels between this page and the frame.
 */
export function DrawioCanvas({
  xml,
  theme,
  onChange
}: {
  xml: string | null;
  theme: 'light' | 'dark';
  /** Called once with the loaded XML, then with the new XML after each edit. */
  onChange: (xml: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // The latest diagram, so a remount (theme change) reloads edits, not the original.
  const latest = useRef(xml || EMPTY_DIAGRAM);
  const origin = new URL(DRAWIO_URL).origin;
  // draw.io posts `init` once; the frame only mounts after we're listening for it.
  const [listening, setListening] = useState(false);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      // Only this editor's own frame may talk to us.
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      if (typeof event.data !== 'string') return;
      let message: DrawioMessage;
      try {
        message = JSON.parse(event.data) as DrawioMessage;
      } catch {
        return;
      }
      if (message.event === 'init') {
        frame.current?.contentWindow?.postMessage(
          JSON.stringify({ action: 'load', xml: latest.current, autosave: 1 }),
          origin
        );
        onChangeRef.current(latest.current);
      } else if ((message.event === 'autosave' || message.event === 'save') && message.xml) {
        latest.current = message.xml;
        onChangeRef.current(message.xml);
      }
    };
    window.addEventListener('message', receive);
    setListening(true);
    return () => window.removeEventListener('message', receive);
  }, [origin]);

  const params = new URLSearchParams({
    embed: '1',
    proto: 'json',
    spin: '1',
    libraries: '1',
    noSaveBtn: '1',
    noExitBtn: '1',
    saveAndExit: '0',
    ui: 'kennedy',
    dark: theme === 'dark' ? '1' : '0'
  });

  if (!listening) return <div className='bg-muted/40 size-full animate-pulse' />;

  return (
    <iframe
      // Remounts on theme change: draw.io reads its theme from the URL once.
      key={theme}
      ref={frame}
      title='draw.io diagram editor'
      src={`${DRAWIO_URL}/?${params}`}
      className='size-full border-0'
      allow='clipboard-read; clipboard-write'
      // draw.io needs scripts and its own origin's storage. The combination is only
      // unsafe for a same-origin frame; this one is cross-origin (postMessage only).
      // eslint-disable-next-line react/iframe-missing-sandbox
      sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals'
    />
  );
}
