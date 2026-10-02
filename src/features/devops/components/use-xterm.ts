'use client';

import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState, type RefObject } from 'react';

interface UseXtermOptions {
  /** Output only, e.g. a CI log: no cursor, no keyboard input. */
  readOnly?: boolean;
  fontSize?: number;
}

/**
 * Mounts an xterm.js terminal in `containerRef` and keeps it sized to it.
 * xterm touches `window` on import, so it loads in the browser only; the
 * terminal is null until then.
 */
export function useXterm(
  containerRef: RefObject<HTMLDivElement | null>,
  { readOnly = false, fontSize = 13 }: UseXtermOptions = {}
): Terminal | null {
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const readOnlyRef = useRef(readOnly);
  const fontSizeRef = useRef(fontSize);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let cleanup = () => {};

    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(
      ([{ Terminal }, { FitAddon }]) => {
        if (disposed) return;
        const term = new Terminal({
          convertEol: readOnlyRef.current,
          disableStdin: readOnlyRef.current,
          cursorBlink: !readOnlyRef.current,
          cursorStyle: readOnlyRef.current ? 'underline' : 'block',
          cursorInactiveStyle: 'none',
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          fontSize: fontSizeRef.current,
          scrollback: 10_000,
          theme: { background: '#0a0a0a', foreground: '#e5e5e5', cursor: '#e5e5e5' }
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(container);

        const refit = () => {
          // A hidden container (closed tab, collapsed panel) has no size to fit.
          if (container.clientWidth > 0 && container.clientHeight > 0) fit.fit();
        };
        refit();
        const observer = new ResizeObserver(refit);
        observer.observe(container);

        cleanup = () => {
          observer.disconnect();
          term.dispose();
        };
        setTerminal(term);
      }
    );

    return () => {
      disposed = true;
      cleanup();
      setTerminal(null);
    };
  }, [containerRef]);

  return terminal;
}
