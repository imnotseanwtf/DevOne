'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useOptionalDocsAssistant } from '@/features/docs-chat/components/docs-assistant';
import { replaceBlock, splitBlocks } from '@/lib/docs-chat/blocks';
import { DEFAULT_MODEL, modelLabel } from '@/lib/docs-chat/models';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** How long the box lingers after the mouse leaves, so it can be reached. */
const LEAVE_DELAY_MS = 350;
const HOVER_TEXT_LIMIT = 600;

interface Target {
  element: HTMLElement;
  /** Position among the page's top-level blocks, or -1 when it can't be matched. */
  index: number;
  text: string;
}

function textOf(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The editor keeps an empty paragraph at the end (and after every blank line the
 * person types) that is not in the Markdown; blocks are matched without them.
 */
function isEmptyParagraph(element: Element): boolean {
  return (
    element.tagName === 'P' &&
    !(element.textContent ?? '').trim() &&
    !element.querySelector('img,svg,video,iframe,[data-lexical-decorator]')
  );
}

/** The editor's top-level block under `node`, if `node` is inside one. */
function blockUnder(node: Element): HTMLElement | null {
  const editor = node.closest('.mdxeditor');
  const root = editor?.querySelector<HTMLElement>('[contenteditable="true"]');
  if (!root || !root.contains(node)) return null;
  let current: Element | null = node;
  while (current && current.parentElement !== root) current = current.parentElement;
  return current instanceof HTMLElement ? current : null;
}

/**
 * Hover any paragraph, heading, list, code block or table in the editor: it is
 * outlined and a small AI button appears. The button opens a one-line box; what
 * you type rewrites just that block, straight in the editor (with Undo). The
 * hovered text is also shared with the chat panel beside the page.
 */
export function DocInlineAi({
  projectId,
  docId,
  title
}: {
  projectId: string;
  docId: string;
  title: string;
}) {
  const assistant = useOptionalDocsAssistant();
  const [target, setTarget] = useState<Target | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [asking, setAsking] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [undo, setUndo] = useState<string | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const targetRef = useRef<Target | null>(null);
  const askingRef = useRef(false);
  const setHovered = assistant?.setHovered;
  const getBridge = assistant?.getBridge;
  const model = assistant?.model;

  targetRef.current = target;
  askingRef.current = asking || busy || undo !== null;

  const close = useCallback(() => {
    abort.current?.abort();
    setAsking(false);
    setBusy(false);
    setError(undefined);
    setUndo(null);
    setInstruction('');
    setTarget(null);
  }, []);

  useEffect(() => {
    if (!setHovered || !getBridge) return;
    const clearLeaveTimer = () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    };

    const onMove = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-docs-inline-ai]')) return clearLeaveTimer();
      // While the box is open, the block it is about stays put.
      if (askingRef.current) return;

      const block = blockUnder(event.target);
      if (!block) {
        if (targetRef.current && !leaveTimer.current) {
          leaveTimer.current = setTimeout(() => {
            leaveTimer.current = null;
            if (!askingRef.current) setTarget(null);
          }, LEAVE_DELAY_MS);
        }
        return;
      }
      clearLeaveTimer();
      if (block === targetRef.current?.element) return;

      const root = block.parentElement as HTMLElement;
      const blocks = splitBlocks(getBridge()?.getMarkdown() ?? '');
      const shown = Array.from(root.children).filter((child) => !isEmptyParagraph(child));
      // Positions only line up when the editor shows exactly the page's blocks.
      const index = blocks.length === shown.length ? shown.indexOf(block) : -1;
      const text = textOf(block);
      setTarget({ element: block, index, text });
      setHovered({ docId, text: text.slice(0, HOVER_TEXT_LIMIT) });
    };

    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mousemove', onMove);
      clearLeaveTimer();
    };
  }, [docId, getBridge, setHovered]);

  // Keep the outline on the block through scrolling, resizing and edits.
  useEffect(() => {
    if (!target) return setRect(null);
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setRect(target.element.isConnected ? target.element.getBoundingClientRect() : null);
      });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [target]);

  useEffect(() => () => abort.current?.abort(), []);

  if (!assistant || !target || !rect || typeof document === 'undefined') return null;

  const submit = async () => {
    const bridge = getBridge?.();
    const text = instruction.trim();
    if (!bridge || bridge.docId !== docId || !text || busy) return;
    const markdown = bridge.getMarkdown();
    const blocks = splitBlocks(markdown);
    const block = blocks[target.index];
    if (!block)
      return setError('Could not find this block in the page. Move the mouse and try again.');

    setBusy(true);
    setError(undefined);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const response = await fetch(`/api/projects/${projectId}/docs/edit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instruction: text,
          block: block.raw,
          before: blocks[target.index - 1]?.raw.slice(-1_500),
          after: blocks[target.index + 1]?.raw.slice(0, 1_500),
          title,
          model
        }),
        signal: controller.signal
      });
      const body = (await response.json().catch(() => null)) as {
        markdown?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok || !body?.markdown) {
        setError(body?.error?.message ?? `The assistant could not edit this (${response.status})`);
        return;
      }

      // The page may have changed while the model was working: find the block again by its text.
      const latest = bridge.getMarkdown();
      const at = splitBlocks(latest).findIndex((entry) => entry.raw === block.raw);
      if (at === -1) {
        setError('The page changed while the AI was working. Try again.');
        return;
      }
      bridge.replaceMarkdown(replaceBlock(latest, at, body.markdown));
      setUndo(latest);
      setAsking(false);
      setInstruction('');
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError') setError('The connection dropped. Try again.');
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const undoEdit = () => {
    const bridge = getBridge?.();
    if (undo === null || !bridge || bridge.docId !== docId) return;
    bridge.replaceMarkdown(undo);
    close();
  };

  const cardWidth = Math.min(Math.max(rect.width, 320), 560);
  const cardLeft = Math.max(8, Math.min(rect.left, window.innerWidth - cardWidth - 8));
  const cardTop = Math.min(rect.bottom + 6, window.innerHeight - 150);

  return createPortal(
    <div data-docs-inline-ai>
      {!asking && undo === null && (
        <div
          className='pointer-events-none fixed z-[70] rounded-md ring-2 ring-violet-500/40 bg-violet-500/5'
          style={{
            top: rect.top - 2,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 4
          }}
        />
      )}
      {!asking && undo === null && (
        <Button
          type='button'
          size='icon-xs'
          variant='secondary'
          className='fixed z-[71] rounded-full shadow'
          style={{ top: rect.top - 2, left: rect.right - 14 }}
          disabled={target.index === -1}
          title={target.index === -1 ? 'Can’t edit this block here' : 'Edit with AI'}
          onClick={() => setAsking(true)}
        >
          <Icons.sparkles className='size-3' />
          <span className='sr-only'>Edit this block with AI</span>
        </Button>
      )}

      {(asking || undo !== null) && (
        <div
          role='dialog'
          aria-label='Edit this block with AI'
          className='bg-popover fixed z-[71] space-y-2 rounded-lg border p-2.5 shadow-lg'
          style={{ top: cardTop, left: cardLeft, width: cardWidth }}
        >
          {undo !== null ? (
            <div className='flex items-center justify-between gap-2 text-sm'>
              <span className='flex items-center gap-1.5'>
                <Icons.check className='size-3.5 text-green-600' />
                Edited
              </span>
              <span className='flex items-center gap-1'>
                <Button type='button' size='xs' variant='outline' onClick={undoEdit}>
                  Undo
                </Button>
                <Button type='button' size='xs' variant='ghost' onClick={close}>
                  Done
                </Button>
              </span>
            </div>
          ) : (
            <>
              <form
                className='flex items-center gap-2'
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <Icons.sparkles className='text-muted-foreground size-4 shrink-0' />
                <Input
                  autoFocus
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  onKeyDown={(event) => event.key === 'Escape' && close()}
                  placeholder='Tell AI what to change here…'
                  disabled={busy}
                  maxLength={1000}
                  className='h-8 flex-1'
                  aria-label='Instruction for this block'
                />
                <Button type='submit' size='icon-sm' disabled={busy || !instruction.trim()}>
                  {busy ? (
                    <Icons.spinner className='size-3.5 animate-spin' />
                  ) : (
                    <Icons.send className='size-3.5' />
                  )}
                  <span className='sr-only'>Edit</span>
                </Button>
                <Button type='button' size='icon-sm' variant='ghost' onClick={close}>
                  <Icons.close className='size-3.5' />
                  <span className='sr-only'>Cancel</span>
                </Button>
              </form>
              <p className='text-muted-foreground truncate text-xs'>
                Using {modelLabel(model ?? DEFAULT_MODEL)} · change it at the top of the page
              </p>
              {error && <p className='text-destructive text-xs'>{error}</p>}
            </>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}
