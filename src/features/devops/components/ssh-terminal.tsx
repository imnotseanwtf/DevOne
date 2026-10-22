'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Icons } from '@/components/icons';
import { AutocompleteMenu } from '@/features/devops/components/autocomplete-menu';
import { TerminalHelperPanel } from '@/features/devops/components/terminal-helper-panel';
import { useAutocomplete } from '@/features/devops/components/use-autocomplete';
import { useXterm } from '@/features/devops/components/use-xterm';
import {
  correctLine,
  detectMistake,
  LineTracker,
  stripAnsi,
  type Mistake
} from '@/features/devops/terminal-helper/suggest';
import type { ContainerName } from '@/features/devops/terminal-helper/complete';
import { useT } from '@/i18n/client';
import type { SearchAddon } from '@xterm/addon-search';
import { useCallback, useEffect, useRef, useState } from 'react';

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

/** How much recent output is kept to look for a shell error in. */
const TAIL_CHARS = 1000;
/** Only these messages are worth running the typo detector on. */
const MISTAKE_HINT = /not found|not a docker command/;
/** How many recent keystroke-to-screen times the readout averages over. */
const LATENCY_SAMPLES = 20;

/**
 * A live SSH shell: output streams in over SSE, keystrokes go out as POSTs.
 * Around it: search (Ctrl+Shift+F), clickable links, a command helper that types
 * into the prompt, and a "did you mean" offer when the shell reports a typo.
 */
export function SshTerminal({ sessionId, onExit, fontSize }: SshTerminalProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const terminal = useXterm(containerRef, { fontSize });
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const sendRef = useRef<(text: string) => void>(() => {});
  const searchRef = useRef<SearchAddon | null>(null);
  const lastLine = useRef('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const typedLines = useRef<readonly string[]>([]);
  const [mistake, setMistake] = useState<Mistake | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [noMatch, setNoMatch] = useState(false);

  // Asked over this terminal's own connection, so it works for servers that were never saved.
  const loadContainers = useCallback(async (): Promise<ContainerName[]> => {
    const response = await fetch(`/api/ssh/sessions/${sessionId}/containers`);
    if (!response.ok) return [];
    return ((await response.json()) as { containers: ContainerName[] }).containers;
  }, [sessionId]);

  const autocomplete = useAutocomplete(
    terminal,
    wrapperRef,
    (text) => sendRef.current(text),
    () => typedLines.current,
    loadContainers
  );
  // Read in handlers that must not re-run when the menu changes.
  const autocompleteRef = useRef(autocomplete);
  useEffect(() => {
    autocompleteRef.current = autocomplete;
  });

  const insert = useCallback(
    (text: string) => {
      sendRef.current(text);
      terminal?.focus();
    },
    [terminal]
  );

  // Add-ons load after the terminal exists; they only touch the browser.
  useEffect(() => {
    if (!terminal) return;
    let disposed = false;
    void Promise.all([import('@xterm/addon-search'), import('@xterm/addon-web-links')]).then(
      ([{ SearchAddon }, { WebLinksAddon }]) => {
        if (disposed) return;
        const search = new SearchAddon();
        terminal.loadAddon(search);
        terminal.loadAddon(new WebLinksAddon());
        searchRef.current = search;
      }
    );
    // Ctrl+F belongs to the shell (and the browser); Ctrl+Shift+F opens our search.
    terminal.attachCustomKeyEventHandler((event) => {
      if (!autocompleteRef.current.handleKey(event)) return false;
      if (event.type === 'keydown' && event.ctrlKey && event.shiftKey && event.key === 'F') {
        setSearching(true);
        return false;
      }
      return true;
    });
    return () => {
      disposed = true;
      searchRef.current = null;
    };
  }, [terminal]);

  const find = (backwards: boolean) => {
    const addon = searchRef.current;
    if (!addon || !query) return;
    const options = { caseSensitive: false };
    setNoMatch(!(backwards ? addon.findPrevious(query, options) : addon.findNext(query, options)));
  };

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
    const decoder = new TextDecoder();
    let tail = '';
    // Key press to first output after it: what the person feels as lag (network, server, SSH, echo).
    let keyAt: number | null = null;
    const samples: number[] = [];
    let shownAt = 0;
    const measure = () => {
      if (keyAt === null) return;
      samples.push(performance.now() - keyAt);
      keyAt = null;
      if (samples.length > LATENCY_SAMPLES) samples.shift();
      // The readout is a median, redrawn at most once a second.
      if (performance.now() - shownAt < 1000) return;
      shownAt = performance.now();
      const sorted = samples.toSorted((a, b) => a - b);
      setLatency(Math.round(sorted[Math.floor(sorted.length / 2)]));
    };
    source.addEventListener('message', (event) => {
      measure();
      const bytes = decodeBase64(event.data);
      terminal.write(bytes, () => autocompleteRef.current.onOutput());
      tail = (tail + stripAnsi(decoder.decode(bytes, { stream: true }))).slice(-TAIL_CHARS);
      // Looking for an error is a regex over the tail; skip it unless the output could hold one.
      const found = MISTAKE_HINT.test(tail) ? detectMistake(tail) : null;
      if (found) {
        // Look at each error once: the same line stays in view for a while.
        tail = '';
        setMistake(found);
      }
    });
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
    const send = (text: string) => {
      pending += text;
      void flush();
    };
    sendRef.current = send;
    const typed = new LineTracker();
    const input = terminal.onData((data) => {
      // A single typed character is echoed straight back: time that, not pastes or escape keys.
      if (keyAt === null && data.length === 1 && data >= ' ') keyAt = performance.now();
      typed.push(data);
      lastLine.current = typed.last;
      typedLines.current = typed.history;
      autocompleteRef.current.onInput(data);
      // Typing again means the offer is no longer about what is on screen.
      setMistake(null);
      send(data);
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

  const correction = mistake
    ? (correctLine(lastLine.current, mistake) ?? mistake.suggestion)
    : null;

  return (
    <div ref={wrapperRef} className='relative flex h-full w-full flex-col'>
      <div className='flex flex-wrap items-center gap-1 pb-1'>
        <TerminalHelperPanel onInsert={insert} />
        <Button
          variant='ghost'
          size='sm'
          className='h-7 gap-1.5 text-neutral-300'
          onClick={() => setSearching((current) => !current)}
          title='Ctrl+Shift+F'
        >
          <Icons.search className='size-3.5' />
          {t('devops.terminal.tools.search')}
        </Button>
        {searching && (
          <div className='flex items-center gap-1'>
            <Input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setNoMatch(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') find(event.shiftKey);
                if (event.key === 'Escape') {
                  setSearching(false);
                  searchRef.current?.clearDecorations();
                  terminal?.focus();
                }
              }}
              placeholder={t('devops.terminal.tools.searchPlaceholder')}
              aria-label={t('devops.terminal.tools.search')}
              aria-invalid={noMatch}
              className='h-7 w-48 bg-neutral-900 text-xs text-neutral-100'
            />
            <Button
              variant='ghost'
              size='icon'
              className='size-7 text-neutral-300'
              aria-label={t('devops.terminal.tools.previous')}
              onClick={() => find(true)}
            >
              <Icons.chevronUp className='size-4' />
            </Button>
            <Button
              variant='ghost'
              size='icon'
              className='size-7 text-neutral-300'
              aria-label={t('devops.terminal.tools.next')}
              onClick={() => find(false)}
            >
              <Icons.chevronDown className='size-4' />
            </Button>
            {noMatch && (
              <span className='text-xs text-red-400'>{t('devops.terminal.tools.noMatch')}</span>
            )}
          </div>
        )}
        {latency !== null && (
          <span
            className='ml-auto text-xs text-neutral-500 tabular-nums'
            title={t('devops.terminal.tools.latencyHint')}
          >
            {latency} ms
          </span>
        )}
        {mistake && correction && (
          <div className='ml-2 flex items-center gap-2 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200'>
            <span>{t('devops.terminal.tools.didYouMean')}</span>
            <code className='font-mono'>{correction}</code>
            <Button
              size='sm'
              variant='secondary'
              className='h-6 px-2 text-xs'
              onClick={() => {
                setMistake(null);
                insert(correction);
              }}
            >
              {t('devops.terminal.tools.insert')}
            </Button>
            <button
              type='button'
              aria-label={t('devops.terminal.tools.dismiss')}
              className='opacity-70 hover:opacity-100'
              onClick={() => setMistake(null)}
            >
              <Icons.close className='size-3.5' />
            </button>
          </div>
        )}
      </div>
      <div ref={containerRef} className='min-h-0 w-full flex-1' />
      {autocomplete.menu && (
        <AutocompleteMenu menu={autocomplete.menu} onAccept={autocomplete.accept} />
      )}
    </div>
  );
}
