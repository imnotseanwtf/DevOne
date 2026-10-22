'use client';

import {
  complete,
  inputAfterPrompt,
  type Completion
} from '@/features/devops/terminal-helper/complete';
import type { Terminal } from '@xterm/xterm';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface AutocompleteMenu {
  items: Completion[];
  index: number;
  left: number;
  /** Set when the menu opens below the cursor line; otherwise `bottom` is. */
  top: number | null;
  bottom: number | null;
}

/** Output counts as an answer to typing only this soon after a keystroke. */
const TYPING_WINDOW_MS = 1500;
/** Waits for the shell to echo what was typed before reading the line. */
const ECHO_WAIT_MS = 120;
const ROW_HEIGHT = 26;
const MENU_WIDTH = 340;

/**
 * Suggestions as you type, the way inshellisense does it: find where the prompt
 * ends on the cursor's line, read what has been typed after it, and show a
 * dropdown for it. Tab, the arrows and Esc are taken only while the menu is
 * open; every other key goes to the shell untouched.
 */
export function useAutocomplete(
  terminal: Terminal | null,
  wrapperRef: RefObject<HTMLElement | null>,
  send: (text: string) => void,
  getHistory: () => readonly string[]
) {
  const [menu, setMenu] = useState<AutocompleteMenu | null>(null);
  const menuRef = useRef<AutocompleteMenu | null>(null);
  const typedAt = useRef(0);
  const echoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sendRef = useRef(send);
  const historyRef = useRef(getHistory);

  useEffect(() => {
    menuRef.current = menu;
    sendRef.current = send;
    historyRef.current = getHistory;
  });

  const refresh = useCallback(() => {
    const wrapper = wrapperRef.current;
    const screen = wrapper?.querySelector('.xterm-screen');
    if (!terminal || !wrapper || !screen || Date.now() - typedAt.current > TYPING_WINDOW_MS) {
      setMenu(null);
      return;
    }
    const buffer = terminal.buffer.active;
    // vim, top and friends use the alternate screen: there is no prompt there.
    const line = buffer.type === 'normal' ? buffer.getLine(buffer.baseY + buffer.cursorY) : null;
    if (!line || line.isWrapped) {
      setMenu(null);
      return;
    }
    const before = line.translateToString(false, 0, buffer.cursorX);
    // Typing in the middle of a line: a suggestion would land in the wrong place.
    if (line.translateToString(true).length > before.length) {
      setMenu(null);
      return;
    }
    const input = inputAfterPrompt(before);
    const items = input ? complete(input, historyRef.current()) : [];
    if (!input || items.length === 0) {
      setMenu(null);
      return;
    }

    const wordLength = /\s$/.test(input) ? 0 : (input.split(/\s+/).at(-1)?.length ?? 0);
    const screenBox = screen.getBoundingClientRect();
    const wrapperBox = wrapper.getBoundingClientRect();
    const cellWidth = screenBox.width / terminal.cols;
    const cellHeight = screenBox.height / terminal.rows;
    const offsetTop = screenBox.top - wrapperBox.top;
    const left = Math.max(
      0,
      Math.min(
        screenBox.left - wrapperBox.left + (buffer.cursorX - wordLength) * cellWidth,
        wrapperBox.width - MENU_WIDTH
      )
    );
    const below = offsetTop + (buffer.cursorY + 1) * cellHeight;
    const fitsBelow = below + items.length * ROW_HEIGHT + 32 <= wrapperBox.height;

    setMenu((previous) => {
      const was = previous?.items[previous.index]?.label;
      const kept = items.findIndex((item) => item.label === was);
      return {
        items,
        index: Math.max(0, kept),
        left,
        top: fitsBelow ? below : null,
        bottom: fitsBelow ? null : wrapperBox.height - (offsetTop + buffer.cursorY * cellHeight)
      };
    });
  }, [terminal, wrapperRef]);

  const accept = useCallback((item: Completion) => {
    // The echo of what is typed brings the next menu: "docker " goes on to its subcommands.
    typedAt.current = Date.now();
    sendRef.current(item.insert);
    setMenu(null);
  }, []);

  /** Call with what the person typed (xterm's onData). */
  const onInput = useCallback(
    (data: string) => {
      clearTimeout(echoTimer.current);
      if (data.includes('\r') || data.includes('\u0003') || data.includes('\u0015')) {
        typedAt.current = 0;
        setMenu(null);
        return;
      }
      // Arrow keys and other escape sequences don't change the line in a way we can follow.
      if (data.startsWith('\u001b')) return;
      typedAt.current = Date.now();
      echoTimer.current = setTimeout(refresh, ECHO_WAIT_MS);
    },
    [refresh]
  );

  /** Call after the terminal has drawn new output. */
  const onOutput = useCallback(() => {
    if (Date.now() - typedAt.current <= TYPING_WINDOW_MS) refresh();
  }, [refresh]);

  /** For xterm's custom key handler: false means the menu used the key. */
  const handleKey = useCallback(
    (event: KeyboardEvent): boolean => {
      const current = menuRef.current;
      if (!current || event.type !== 'keydown') return true;
      if (event.ctrlKey || event.metaKey || event.altKey) return true;
      const count = current.items.length;
      if (event.key === 'ArrowDown') {
        setMenu({ ...current, index: (current.index + 1) % count });
      } else if (event.key === 'ArrowUp') {
        setMenu({ ...current, index: (current.index - 1 + count) % count });
      } else if (event.key === 'Tab' && !event.shiftKey) {
        accept(current.items[current.index]);
      } else if (event.key === 'Escape') {
        setMenu(null);
      } else {
        return true;
      }
      event.preventDefault();
      return false;
    },
    [accept]
  );

  useEffect(() => () => clearTimeout(echoTimer.current), []);

  return { menu, accept, onInput, onOutput, handleKey };
}
