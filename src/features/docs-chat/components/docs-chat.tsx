'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

interface Source {
  slug: string;
  title: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  failed?: boolean;
}

const SUGGESTIONS = [
  'Summarize this page',
  'What should I know before deploying?',
  'Where is the database documented?'
];

/** The text added by one SSE `data:` line of a chat completion, or an error message. */
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

/** A side panel that answers questions from the project's docs, streaming as it writes. */
export function DocsChat({
  projectId,
  currentSlug,
  currentTitle
}: {
  projectId: string;
  currentSlug?: string;
  currentTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages]);
  useEffect(() => () => abort.current?.abort(), []);

  const patchLast = (change: (message: Message) => Message) =>
    setMessages((current) => [...current.slice(0, -1), change(current.at(-1) as Message)]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
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
          currentSlug
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

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant='outline' size='sm' />}>
        <Icons.sparkles className='size-3.5' />
        Ask AI
      </SheetTrigger>
      <SheetContent side='right' className='w-full gap-0 sm:max-w-md'>
        <SheetHeader className='border-b'>
          <SheetTitle>Ask the docs</SheetTitle>
          <SheetDescription>
            {currentTitle
              ? `Reading “${currentTitle}” and the rest of this project’s pages.`
              : 'Answers come from this project’s pages.'}
          </SheetDescription>
        </SheetHeader>

        <div className='flex-1 space-y-4 overflow-y-auto p-4' aria-live='polite'>
          {messages.length === 0 ? (
            <div className='space-y-2'>
              <p className='text-muted-foreground text-sm'>Try asking:</p>
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
            messages.map((message, index) => (
              <div
                key={index}
                className={cn('flex flex-col gap-1.5', message.role === 'user' && 'items-end')}
              >
                <div
                  className={cn(
                    'max-w-[92%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                    message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted',
                    message.failed && 'text-destructive'
                  )}
                >
                  {message.content || (busy && index === messages.length - 1 ? '…' : '')}
                </div>
                {message.sources && message.sources.length > 0 && (
                  <div className='flex max-w-[92%] flex-wrap gap-1'>
                    {message.sources.map((source) => (
                      <Link
                        key={source.slug}
                        href={`/projects/${projectId}/docs?page=${source.slug}`}
                        onClick={() => setOpen(false)}
                        className='text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs'
                      >
                        <Icons.page className='size-3' />
                        {source.title}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={bottom} />
        </div>

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
            placeholder='Ask about these docs…'
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
          {messages.length > 0 && !busy && (
            <Button type='button' size='icon' variant='ghost' onClick={() => setMessages([])}>
              <Icons.trash className='size-4' />
              <span className='sr-only'>Clear chat</span>
            </Button>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}
