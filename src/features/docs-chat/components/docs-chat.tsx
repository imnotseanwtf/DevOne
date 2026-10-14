'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useDocsAssistant } from '@/features/docs-chat/components/docs-assistant';
import { splitAnswer, summarizeChange } from '@/lib/docs-chat/proposal';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

interface Source {
  slug: string;
  title: string;
}

interface Applied {
  /** The page as it was just before the proposal replaced it, for Undo. */
  before: string;
  undone: boolean;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  failed?: boolean;
  /** Whether the model was allowed to propose an edit to the open page. */
  canEdit?: boolean;
  /** The page this answer was about, so an edit is never applied to a different one. */
  docId?: string;
  applied?: Applied;
  showProposal?: boolean;
}

const SUGGESTIONS = [
  'Summarize this page',
  'Fix the grammar on this page',
  'Add a short “Troubleshooting” section'
];

/** The text added by one SSE `data:` line of a chat completion. */
function deltaOf(line: string): string {
  if (!line.startsWith('data:')) return '';
  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') return '';
  try {
    return (
      (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta
        ?.content ?? ''
    );
  } catch {
    return '';
  }
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `The assistant could not answer (${response.status})`;
}

/** The header button that shows or hides the docked chat. */
export function DocsChatToggle() {
  const { open, setOpen } = useDocsAssistant();
  return (
    <Button
      variant={open ? 'secondary' : 'outline'}
      size='sm'
      aria-pressed={open}
      onClick={() => setOpen(!open)}
    >
      <Icons.sparkles className='size-3.5' />
      Ask AI
    </Button>
  );
}

/**
 * A chat docked beside the docs. It answers from the project's pages and can
 * propose a rewrite of the open page, which only changes after the person
 * clicks Apply (and can be undone).
 */
export function DocsChat({
  projectId,
  currentSlug,
  currentTitle
}: {
  projectId: string;
  currentSlug?: string;
  currentTitle?: string;
}) {
  const { open, setOpen, getBridge, hovered, setHovered } = useDocsAssistant();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);
  useEffect(() => () => abort.current?.abort(), []);

  if (!open) return null;

  const patchLast = (change: (message: Message) => Message) =>
    setMessages((current) => [...current.slice(0, -1), change(current.at(-1) as Message)]);
  const patchAt = (index: number, change: (message: Message) => Message) =>
    setMessages((current) => current.map((entry, i) => (i === index ? change(entry) : entry)));

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const bridge = getBridge();
    const history = [
      ...messages.filter((message) => !message.failed),
      { role: 'user' as const, content: text }
    ];
    setMessages([...messages, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;

    try {
      const response = await fetch(`/api/projects/${projectId}/docs/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
          currentSlug,
          currentBody: bridge?.getMarkdown(),
          focus: hovered && hovered.docId === bridge?.docId ? hovered.text : undefined
        }),
        signal: controller.signal
      });
      if (!response.ok || !response.body) {
        const reason = await readError(response);
        patchLast((message) => ({ ...message, content: reason, failed: true }));
        return;
      }
      const sources = (() => {
        try {
          return JSON.parse(
            decodeURIComponent(response.headers.get('x-devone-sources') ?? '[]')
          ) as Source[];
        } catch {
          return [];
        }
      })();
      const canEdit = response.headers.get('x-devone-can-edit') === '1';
      patchLast((message) => ({ ...message, canEdit, docId: bridge?.docId }));

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        const added = lines.map(deltaOf).join('');
        if (added) patchLast((message) => ({ ...message, content: message.content + added }));
      }
      patchLast((message) => ({
        ...message,
        content: message.content || 'The model sent an empty answer. Try again.',
        sources
      }));
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        patchLast((message) => ({
          ...message,
          content: 'The connection dropped. Try again.',
          failed: true
        }));
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const apply = (index: number, proposal: string) => {
    const bridge = getBridge();
    if (!bridge || bridge.docId !== messages[index]?.docId) return;
    const before = bridge.getMarkdown();
    bridge.replaceMarkdown(proposal);
    patchAt(index, (message) => ({ ...message, applied: { before, undone: false } }));
  };

  const undo = (index: number) => {
    const applied = messages[index]?.applied;
    const bridge = getBridge();
    if (!applied || applied.undone || !bridge || bridge.docId !== messages[index].docId) return;
    bridge.replaceMarkdown(applied.before);
    patchAt(index, (message) => ({ ...message, applied: { ...applied, undone: true } }));
  };

  return (
    <Card className='sticky top-4 flex h-[calc(100svh-15rem)] min-h-96 w-full flex-col gap-0 self-start overflow-hidden py-0 lg:w-96'>
      <div className='flex items-start justify-between gap-2 border-b p-3'>
        <div className='min-w-0'>
          <p className='flex items-center gap-1.5 text-sm font-medium'>
            <Icons.sparkles className='size-3.5' />
            Ask the docs
          </p>
          <p className='text-muted-foreground mt-0.5 truncate text-xs'>
            {currentTitle
              ? `Reading “${currentTitle}” and the other pages`
              : 'Answers come from this project’s pages'}
          </p>
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          {messages.length > 0 && !busy && (
            <Button type='button' size='icon-sm' variant='ghost' onClick={() => setMessages([])}>
              <Icons.trash className='size-3.5' />
              <span className='sr-only'>Clear chat</span>
            </Button>
          )}
          <Button type='button' size='icon-sm' variant='ghost' onClick={() => setOpen(false)}>
            <Icons.close className='size-3.5' />
            <span className='sr-only'>Close chat</span>
          </Button>
        </div>
      </div>

      <div ref={scroller} className='flex-1 space-y-4 overflow-y-auto p-3' aria-live='polite'>
        {messages.length === 0 ? (
          <div className='space-y-2'>
            <p className='text-muted-foreground text-sm'>
              Ask a question, or ask me to change this page. I propose edits; you decide whether to
              apply them.
            </p>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type='button'
                onClick={() => ask(suggestion)}
                className='hover:bg-muted block w-full rounded-lg border px-3 py-2 text-left text-sm'
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : (
          messages.map((message, index) => {
            const answer =
              message.role === 'assistant' && message.canEdit
                ? splitAnswer(message.content)
                : { prose: message.content, proposal: null, writing: false };
            const bridge = getBridge();
            const samePage = !!bridge && bridge.docId === message.docId;
            const change =
              answer.proposal !== null && bridge && samePage && !message.applied
                ? summarizeChange(bridge.getMarkdown(), answer.proposal)
                : null;
            return (
              <div
                key={index}
                className={cn('flex flex-col gap-1.5', message.role === 'user' && 'items-end')}
              >
                <div
                  className={cn(
                    'max-w-[95%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                    message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted',
                    message.failed && 'text-destructive'
                  )}
                >
                  {answer.prose ||
                    (busy && index === messages.length - 1 && !answer.writing ? '…' : '')}
                  {answer.writing && (
                    <span className='text-muted-foreground mt-1 block text-xs italic'>
                      Writing the new version…
                    </span>
                  )}
                </div>

                {answer.proposal !== null && (
                  <div className='bg-card w-full max-w-[95%] space-y-2 rounded-lg border p-2.5 text-xs'>
                    <p className='font-medium'>
                      {message.applied
                        ? message.applied.undone
                          ? 'Edit undone'
                          : 'Applied to the page'
                        : 'Proposed edit to this page'}
                      {change && (
                        <span className='text-muted-foreground ml-2 font-normal'>
                          <span className='text-green-600'>+{change.added}</span>{' '}
                          <span className='text-red-600'>−{change.removed}</span> lines
                        </span>
                      )}
                    </p>
                    {message.showProposal && (
                      <pre className='bg-muted max-h-64 overflow-auto rounded p-2 whitespace-pre-wrap'>
                        {answer.proposal}
                      </pre>
                    )}
                    <div className='flex flex-wrap items-center gap-1.5'>
                      {!message.applied && (
                        <Button
                          type='button'
                          size='xs'
                          disabled={!samePage || busy}
                          title={samePage ? undefined : 'This edit was for a different page'}
                          onClick={() => apply(index, answer.proposal as string)}
                        >
                          Apply to page
                        </Button>
                      )}
                      {message.applied && !message.applied.undone && (
                        <Button
                          type='button'
                          size='xs'
                          variant='outline'
                          onClick={() => undo(index)}
                        >
                          Undo
                        </Button>
                      )}
                      <Button
                        type='button'
                        size='xs'
                        variant='ghost'
                        onClick={() =>
                          patchAt(index, (entry) => ({
                            ...entry,
                            showProposal: !entry.showProposal
                          }))
                        }
                      >
                        {message.showProposal ? 'Hide' : 'Review'} new text
                      </Button>
                    </div>
                    {!samePage && !message.applied && (
                      <p className='text-muted-foreground'>This edit was for a different page.</p>
                    )}
                  </div>
                )}

                {message.sources && message.sources.length > 0 && (
                  <div className='flex max-w-[95%] flex-wrap gap-1'>
                    {message.sources.map((source) => (
                      <Link
                        key={source.slug}
                        href={`/projects/${projectId}/docs?page=${source.slug}`}
                        className='text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs'
                      >
                        <Icons.page className='size-3' />
                        {source.title}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {hovered && hovered.docId === getBridge()?.docId && (
        <div className='bg-muted/50 mx-3 mb-0 flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs'>
          <Icons.sparkles className='text-muted-foreground mt-0.5 size-3 shrink-0' />
          <p className='min-w-0 flex-1'>
            <span className='text-muted-foreground'>Pointing at: </span>
            <span className='line-clamp-2'>“{hovered.text}”</span>
          </p>
          <button
            type='button'
            onClick={() => setHovered(null)}
            className='text-muted-foreground hover:text-foreground shrink-0'
            aria-label='Stop pointing at this passage'
          >
            <Icons.close className='size-3' />
          </button>
        </div>
      )}

      <form
        className='flex items-end gap-2 border-t p-3'
        onSubmit={(event) => {
          event.preventDefault();
          void ask(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void ask(input);
            }
          }}
          placeholder={hovered ? 'Ask about the passage above…' : 'Ask, or say what to change…'}
          rows={2}
          maxLength={8000}
          className='min-h-0 flex-1 resize-none'
          aria-label='Question'
        />
        {busy ? (
          <Button
            type='button'
            size='icon'
            variant='outline'
            onClick={() => abort.current?.abort()}
          >
            <Icons.close className='size-4' />
            <span className='sr-only'>Stop</span>
          </Button>
        ) : (
          <Button type='submit' size='icon' disabled={!input.trim()}>
            <Icons.send className='size-4' />
            <span className='sr-only'>Send</span>
          </Button>
        )}
      </form>
    </Card>
  );
}
