'use client';

import { DEFAULT_MODEL, MODEL_STORAGE_KEY, parseModelIds, pickModel } from '@/lib/docs-chat/models';
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
  /** The router model name used for chat and inline edits. */
  model: string;
  setModel(model: string): void;
  /** What the router offers, once loaded; null until then or when it can't be listed. */
  models: string[] | null;
  /** Fetches the router's models the first time it is called. */
  loadModels(): void;
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
  const [models, setModels] = useState<string[] | null>(null);
  const [model, setModelState] = useState(() => {
    try {
      return pickModel(window.localStorage.getItem(MODEL_STORAGE_KEY), null);
    } catch {
      return DEFAULT_MODEL;
    }
  });
  const loading = useRef(false);
  const bridge = useRef<DocBridge | null>(null);
  const register = useCallback((next: DocBridge | null) => {
    bridge.current = next;
  }, []);
  const getBridge = useCallback(() => bridge.current, []);
  const setModel = useCallback((next: string) => {
    setModelState(next);
    try {
      window.localStorage.setItem(MODEL_STORAGE_KEY, next);
    } catch {
      // Private windows can refuse storage; the choice then lasts until reload.
    }
  }, []);
  const loadModels = useCallback(() => {
    if (loading.current) return;
    loading.current = true;
    fetch('/api/ai/v1/models')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const ids = parseModelIds(body);
        setModels(ids);
        // A model that was removed since last time falls back to auto.
        setModelState((current) => pickModel(current, ids));
      })
      .catch(() => undefined)
      .finally(() => {
        loading.current = false;
      });
  }, []);
  const value = useMemo(
    () => ({
      open,
      setOpen,
      hovered,
      setHovered,
      model,
      setModel,
      models,
      loadModels,
      register,
      getBridge
    }),
    [open, hovered, model, setModel, models, loadModels, register, getBridge]
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
