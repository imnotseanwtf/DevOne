'use client';

import { useXterm } from '@/features/devops/components/use-xterm';
import { useEffect, useRef } from 'react';

interface SshTerminalProps {
  sessionId: string;
  /** Called once when the shell ends, with the reason. */
  onExit: (reason: string) => void;
  fontSize?: number;
}

function post(sessionId: string, body: unknown) {
  return fetch(`/api/ssh/sessions/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A live SSH shell: output streams in over SSE, keystrokes go out as POSTs. */
export function SshTerminal({ sessionId, onExit, fontSize }: SshTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminal = useXterm(containerRef, { fontSize });
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    if (!terminal) return;
    let ended = false;
    const end = (reason: string) => {
      if (ended) return;
      ended = true;
      source.close();
      // Dimmed note, then hide the cursor: nothing more can be typed.
      terminal.write(`\r\n\x1b[2m[${reason}]\x1b[0m\r\n\x1b[?25l`);
      terminal.options.disableStdin = true;
      terminal.options.cursorBlink = false;
      onExitRef.current(reason);
    };

    const source = new EventSource(`/api/ssh/sessions/${sessionId}/stream`);
    source.addEventListener('message', (event) => terminal.write(decodeBase64(event.data)));
    source.addEventListener('exit', (event) => {
      const { reason } = JSON.parse((event as MessageEvent<string>).data) as { reason: string };
      end(reason);
    });
    // EventSource retries on its own; it gives up (CLOSED) once the session is gone.
    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) end('Disconnected');
    });

    // Keystrokes are batched: one request in flight, the rest queued behind it,
    // so fast typing and pastes arrive in order.
    let pending = '';
    let sending = false;
    const flush = async () => {
      if (sending || !pending || ended) return;
      sending = true;
      const data = pending;
      pending = '';
      const response = await post(sessionId, { type: 'input', data }).catch(() => null);
      sending = false;
      if (response?.status === 404) end('Session ended');
      else void flush();
    };
    const input = terminal.onData((data) => {
      pending += data;
      void flush();
    });

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const sendSize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!ended)
          void post(sessionId, { type: 'resize', cols: terminal.cols, rows: terminal.rows });
      }, 150);
    };
    const resize = terminal.onResize(sendSize);
    sendSize();
    terminal.focus();

    return () => {
      ended = true;
      clearTimeout(resizeTimer);
      input.dispose();
      resize.dispose();
      // Detaches only: the server keeps the shell briefly in case this was a reload.
      source.close();
    };
  }, [terminal, sessionId]);

  return <div ref={containerRef} className='h-full w-full' />;
}
