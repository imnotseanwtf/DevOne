'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/** What the assistant can do to the page open in the editor. */
export interface DocBridge {
  docId: string;
  /** The page as it is in the editor right now, saved or not. */
  getMarkdown(): string;
  /** Replaces the page's text; the editor then saves it like any other edit. */
  replaceMarkdown(markdown: string): void;
}

/** The passage of the open page the mouse last rested on. */
export interface Hovered {
  docId: string;
  text: string;
}

interface AssistantContext {
  hovered: Hovered | null;
  setHovered(hovered: Hovered | null): void;
  open: boolean;
  setOpen(open: boolean): void;
  register(bridge: DocBridge | null): void;
  getBridge(): DocBridge | null;
}

const Context = createContext<AssistantContext | null>(null);

/** Connects the docs editor and the chat panel, which sit side by side. */
export function DocsAssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const bridge = useRef<DocBridge | null>(null);
  const register = useCallback((next: DocBridge | null) => {
    bridge.current = next;
  }, []);
  const getBridge = useCallback(() => bridge.current, []);
  const value = useMemo(
    () => ({ open, setOpen, hovered, setHovered, register, getBridge }),
    [open, hovered, register, getBridge]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDocsAssistant(): AssistantContext {
  const context = useContext(Context);
  if (!context) throw new Error('useDocsAssistant needs a DocsAssistantProvider');
  return context;
}

/** For the editor: it can be used on its own, without a chat panel beside it. */
export function useOptionalDocsAssistant(): AssistantContext | null {
  return useContext(Context);
}
