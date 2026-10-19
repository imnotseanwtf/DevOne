'use client';

import { Icons } from '@/components/icons';
import { Markdown } from '@/components/markdown-editor';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea
} from '@/components/ui/input-group';
import { ModelSelect } from '@/features/docs-chat/components/model-select';
import { useDocsAssistant } from '@/features/docs-chat/components/docs-assistant';
import { splitAnswer, summarizeChange } from '@/lib/docs-chat/proposal';
import { modelLabel } from '@/lib/docs-chat/models';
import { readChatStream } from '@/lib/docs-chat/stream';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

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
  error?: string;
  stopped?: boolean;
  /** Whether the model was allowed to propose an edit to the open page. */
  canEdit?: boolean;
  /** The page this answer was about, so an edit is never applied to a different one. */
  docId?: string;
  applied?: Applied;
  showProposal?: boolean;
}

const PAGE_SUGGESTIONS = [
  'Summarize this page',
  'Fix the grammar on this page',
  'Add a short “Troubleshooting” section'
];

const TASK_SUGGESTIONS = [
  'Write a description for this task',
  'Add acceptance criteria',
  'Make this clearer and shorter'
];

function CopyResponse({ content }: { content: string }) {
  const [copied, setCopied] = useState('');
  return (
    <Button
      type='button'
      variant='ghost'
      size='icon-xs'
      aria-label={copied === content ? 'Response copied' : 'Copy response'}
      title={copied === content ? 'Copied' : 'Copy response'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(content);
          setCopied(content);
        } catch {
          toast.error('Could not copy the response.');
        }
      }}
    >
      {copied === content ? <Icons.check /> : <Icons.copy />}
    </Button>
  );
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
  currentTitle,
  kind = 'page',
  variant = 'dock'
}: {
  projectId: string;
  currentSlug?: string;
  currentTitle?: string;
  /** `task`: the open text is a task's description, with `currentTitle` the task's title. */
  kind?: 'page' | 'task';
  /** `dock`: a sticky column beside the page; `inline`: a block in the flow, e.g. in a dialog. */
  variant?: 'dock' | 'inline';
}) {
  const task = kind === 'task';
  const { open, setOpen, getBridge, hovered, setHovered, model } = useDocsAssistant();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    if (follow.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, open]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!open) abort.current?.abort();
  }, [open]);

  if (!open) return null;

  const patchLast = (change: (message: Message) => Message) =>
    setMessages((current) =>
      current.length ? [...current.slice(0, -1), change(current.at(-1) as Message)] : current
    );
  const patchAt = (index: number, change: (message: Message) => Message) =>
    setMessages((current) => current.map((entry, i) => (i === index ? change(entry) : entry)));

  const ask = async (question: string, previous = messages) => {
    const text = question.trim();
    if (!text || busy || abort.current) return;
    const bridge = getBridge();
    const history = [
      ...previous.filter((message) => !message.failed && !message.stopped && message.content),
      { role: 'user' as const, content: text }
    ];
    setMessages([...previous, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    follow.current = true;
    setShowJump(false);
    setInput('');
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;

    try {
      const response = await fetch(`/api/projects/${projectId}/docs/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: history
            .slice(-40)
            .map(({ role, content }) => ({ role, content: content.slice(0, 8000) })),
          ...(task ? { taskTitle: currentTitle ?? '' } : { currentSlug }),
          model,
          currentBody: bridge?.getMarkdown(),
          focus: hovered && hovered.docId === bridge?.docId ? hovered.text : undefined
        }),
        signal: controller.signal
      });
      if (!response.ok || !response.body) {
        const reason = await readError(response);
        patchLast((message) => ({ ...message, error: reason, failed: true }));
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

      await readChatStream(response, (added) =>
        patchLast((message) => ({ ...message, content: message.content + added }))
      );
      patchLast((message) => ({
        ...message,
        ...(message.content
          ? {}
          : { error: 'The model sent an empty answer. Try again.', failed: true }),
        sources
      }));
    } catch (error) {
      if (controller.signal.aborted) {
        patchLast((message) => ({ ...message, stopped: true }));
      } else {
        patchLast((message) => ({
          ...message,
          error: error instanceof Error ? error.message : 'The connection dropped. Try again.',
          failed: true
        }));
      }
    } finally {
      abort.current = null;
      setBusy(false);
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
    <Card
      className={cn(
        'flex w-full min-w-0 flex-col gap-0 overflow-hidden py-0',
        variant === 'dock'
          ? 'sticky top-4 h-[calc(100svh-12rem)] min-h-96 self-start lg:w-96 xl:w-[26rem]'
          : 'h-[32rem] max-h-[75svh]'
      )}
    >
      <div className='flex shrink-0 items-start justify-between gap-2 border-b p-4'>
        <div className='min-w-0 flex-1'>
          <p className='flex items-center gap-1.5 text-sm font-medium'>
            <Icons.sparkles className='size-4' />
            {task ? 'Ask AI about this task' : 'Ask the docs'}
          </p>
          <p className='text-muted-foreground mt-0.5 truncate text-xs'>
            {task
              ? 'Reading this task’s description and the project’s docs'
              : currentTitle
                ? `Reading “${currentTitle}” and the other pages`
                : 'Answers come from this project’s pages'}
          </p>
          <ModelSelect className='-ml-2 mt-2' />
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

      <div className='relative flex min-h-0 flex-1 flex-col'>
        <div
          ref={scroller}
          className='flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 py-5'
          role='log'
          aria-label='Conversation'
          aria-live='polite'
          onScroll={(event) => {
            const element = event.currentTarget;
            follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
            setShowJump(!follow.current);
          }}
        >
          {messages.length === 0 ? (
            <div className='my-auto flex flex-col items-center gap-5 py-6'>
              <div className='bg-muted flex size-12 items-center justify-center rounded-2xl'>
                <Icons.sparkles className='size-6' />
              </div>
              <div className='flex flex-col gap-2 text-center'>
                <p className='text-lg font-semibold tracking-tight'>How can I help?</p>
                <p className='text-muted-foreground max-w-64 text-sm leading-relaxed'>
                  Ask about your project, explore an idea, or improve this{' '}
                  {task ? 'description' : 'page'} together.
                </p>
              </div>
              <div className='flex w-full flex-col gap-2'>
                {(task ? TASK_SUGGESTIONS : PAGE_SUGGESTIONS).map((suggestion) => (
                  <button
                    key={suggestion}
                    type='button'
                    onClick={() => ask(suggestion)}
                    className='hover:bg-muted focus-visible:ring-ring group flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left text-sm transition-colors outline-none focus-visible:ring-2'
                  >
                    {suggestion}
                    <Icons.arrowRight className='text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5' />
                  </button>
                ))}
              </div>
              <p className='text-muted-foreground max-w-64 text-center text-xs leading-relaxed'>
                I use your project’s docs for context. Edits are only applied when you approve them.
              </p>
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
                  className={cn(
                    'flex min-w-0 flex-col gap-2',
                    message.role === 'user' && 'items-end'
                  )}
                >
                  {message.role === 'assistant' && (
                    <div className='text-muted-foreground flex items-center gap-2 text-xs'>
                      <Icons.sparkles className='size-3.5' />
                      <span>Assistant</span>
                    </div>
                  )}
                  <div
                    className={cn(
                      'min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere]',
                      message.role === 'user'
                        ? 'bg-muted max-w-[90%] rounded-2xl rounded-tr-sm px-4 py-2.5 whitespace-pre-wrap'
                        : 'w-full'
                    )}
                  >
                    {message.role === 'user' ? (
                      answer.prose
                    ) : (
                      <Markdown
                        source={answer.prose}
                        className='text-sm leading-relaxed [&_pre]:max-w-full [&_pre]:text-xs [&_table]:block [&_table]:overflow-x-auto'
                      />
                    )}
                    {busy && index === messages.length - 1 && !answer.prose && !answer.writing && (
                      <span
                        role='status'
                        className='text-muted-foreground flex items-center gap-2 py-1'
                      >
                        <span className='bg-foreground size-2 rounded-full motion-safe:animate-pulse' />
                        Thinking…
                      </span>
                    )}
                    {answer.writing && busy && index === messages.length - 1 && (
                      <span
                        role='status'
                        className='text-muted-foreground mt-2 flex items-center gap-2 text-xs'
                      >
                        <Icons.spinner className='size-3.5 animate-spin motion-reduce:animate-none' />
                        Writing the new version…
                      </span>
                    )}
                  </div>
                  {message.error && (
                    <p
                      role='alert'
                      className='text-destructive bg-destructive/5 rounded-lg border border-destructive/20 px-3 py-2 text-xs leading-relaxed'
                    >
                      {message.error}
                    </p>
                  )}
                  {message.stopped && (
                    <p className='text-muted-foreground text-xs'>Response stopped</p>
                  )}

                  {answer.proposal !== null && !message.failed && !message.stopped && (
                    <div className='bg-card flex w-full flex-col gap-2 rounded-xl border p-3 text-xs'>
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
                    <div className='flex flex-wrap gap-1'>
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
                  {message.role === 'assistant' && !(busy && index === messages.length - 1) && (
                    <div className='text-muted-foreground flex items-center gap-1'>
                      {answer.prose && <CopyResponse content={answer.prose} />}
                      {index === messages.length - 1 &&
                        messages[index - 1]?.role === 'user' &&
                        (!message.applied || message.applied.undone) && (
                          <Button
                            type='button'
                            variant='ghost'
                            size='xs'
                            disabled={busy}
                            onClick={() =>
                              ask(messages[index - 1].content, messages.slice(0, index - 1))
                            }
                          >
                            <Icons.refresh className='size-3.5' />
                            {message.failed || message.stopped ? 'Try again' : 'Regenerate'}
                          </Button>
                        )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        {showJump && (
          <Button
            type='button'
            variant='outline'
            size='icon-sm'
            className='absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md'
            aria-label='Scroll to latest message'
            onClick={() => {
              follow.current = true;
              setShowJump(false);
              scroller.current?.scrollTo({
                top: scroller.current.scrollHeight,
                behavior: 'smooth'
              });
            }}
          >
            <Icons.arrowDown />
          </Button>
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

      <div className='flex shrink-0 flex-col gap-2 p-3 pt-2'>
        <InputGroup className='rounded-2xl'>
          <InputGroupTextarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void ask(input);
              }
            }}
            placeholder={hovered ? 'Ask about the passage above…' : 'Ask, or say what to change…'}
            rows={1}
            maxLength={8000}
            className='max-h-40 min-h-12 px-3 pt-3'
            aria-label='Question'
          />
          <InputGroupAddon align='block-end' className='justify-between gap-2'>
            <span className='min-w-0 truncate text-xs font-normal'>{modelLabel(model)}</span>
            {busy ? (
              <InputGroupButton
                type='button'
                size='icon-sm'
                variant='default'
                className='rounded-full'
                onClick={() => abort.current?.abort()}
              >
                <Icons.stop className='size-4' />
                <span className='sr-only'>Stop response</span>
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type='button'
                variant='default'
                size='icon-sm'
                className='rounded-full'
                aria-disabled={!input.trim()}
                onClick={() => void ask(input)}
              >
                <Icons.arrowUp className='size-4' />
                <span className='sr-only'>Send</span>
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
        <p className='text-muted-foreground text-center text-[10px]'>
          Enter to send · Shift + Enter for a new line
        </p>
      </div>
    </Card>
  );
}
