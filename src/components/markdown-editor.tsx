'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo, useRef, useState } from 'react';

marked.setOptions({ breaks: true, gfm: true });

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(marked.parse(source || '') as string);
}

/** Read-only rendered markdown, styled GitHub-like via `.markdown-body`. */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  if (!source.trim()) return null;
  return (
    <div className={cn('markdown-body', className)} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

interface MarkdownEditorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  initialTab?: 'write' | 'preview';
}

type Tab = 'write' | 'preview';

/**
 * GitHub-style comment editor: formatting toolbar, Write tab with a plain
 * textarea, Preview tab with rendered markdown. Stores markdown source.
 */
export function MarkdownEditor({
  id,
  value,
  onChange,
  disabled,
  placeholder = 'Write a description… (Markdown supported)',
  rows = 5,
  initialTab = 'write'
}: MarkdownEditorProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [fullScreen, setFullScreen] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  function replaceSelection(
    replacement: (selected: string) => { text: string; select: [number, number] }
  ) {
    const el = areaRef.current;
    if (!el || disabled) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const { text, select } = replacement(selected);
    onChange(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + select[0], start + select[1]);
    });
  }

  function wrap(before: string, after: string, placeholderText: string) {
    replaceSelection((selected) => {
      const body = selected || placeholderText;
      return {
        text: `${before}${body}${after}`,
        select: [before.length, before.length + body.length]
      };
    });
  }

  function prefixLines(prefix: (index: number) => string) {
    replaceSelection((selected) => {
      const body = selected || 'List item';
      const lines = body.split('\n');
      const prefixed = lines.map((line, index) => `${prefix(index)}${line}`).join('\n');
      return { text: prefixed, select: [0, prefixed.length] };
    });
  }

  const tools: { label: string; icon: keyof typeof Icons; run: () => void }[] = [
    { label: 'Bold', icon: 'bold', run: () => wrap('**', '**', 'bold text') },
    { label: 'Italic', icon: 'italic', run: () => wrap('*', '*', 'italic text') },
    { label: 'Strikethrough', icon: 'strikethrough', run: () => wrap('~~', '~~', 'struck text') },
    { label: 'Heading', icon: 'heading', run: () => prefixLines(() => '### ') },
    { label: 'Quote', icon: 'quote', run: () => prefixLines(() => '> ') },
    { label: 'Code', icon: 'code', run: () => wrap('`', '`', 'code') },
    {
      label: 'Link',
      icon: 'link',
      run: () =>
        replaceSelection((selected) => {
          const text = selected || 'link text';
          const snippet = `[${text}](https://…)`;
          return { text: snippet, select: [1, 1 + text.length] };
        })
    },
    { label: 'Bullet list', icon: 'list', run: () => prefixLines(() => '- ') },
    { label: 'Numbered list', icon: 'listOrdered', run: () => prefixLines((i) => `${i + 1}. `) }
  ];

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='bg-muted/40 flex items-center gap-1 border-b px-2 py-1.5'>
        <div className='mr-1 flex gap-1' role='tablist' aria-label='Editor mode'>
          {(['write', 'preview'] as const).map((mode) => (
            <button
              key={mode}
              type='button'
              role='tab'
              aria-selected={tab === mode}
              disabled={disabled}
              onClick={() => setTab(mode)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium capitalize',
                tab === mode
                  ? 'bg-background text-foreground shadow-sm ring-1 ring-foreground/10'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {mode}
            </button>
          ))}
        </div>
        {tab === 'write' ? (
          <div className='ml-auto flex items-center gap-0.5' role='toolbar' aria-label='Formatting'>
            {tools.map((tool) => {
              const Icon = Icons[tool.icon];
              return (
                <Button
                  key={tool.label}
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  title={tool.label}
                  aria-label={tool.label}
                  disabled={disabled}
                  onClick={tool.run}
                  className='text-muted-foreground hover:text-foreground'
                >
                  <Icon aria-hidden='true' />
                </Button>
              );
            })}
          </div>
        ) : (
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='ml-auto'
            onClick={() => setFullScreen(true)}
          >
            Full screen
          </Button>
        )}
      </div>

      {tab === 'write' ? (
        <Textarea
          ref={areaRef}
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={rows}
          maxLength={10000}
          placeholder={placeholder}
          disabled={disabled}
          className='resize-y rounded-none border-0 font-mono text-[13px] focus-visible:ring-0'
        />
      ) : (
        <div className='min-h-24 p-3'>
          {value.trim() ? (
            <Markdown source={value} />
          ) : (
            <p className='text-muted-foreground text-sm italic'>Nothing to preview.</p>
          )}
        </div>
      )}

      <Dialog open={fullScreen} onOpenChange={setFullScreen}>
        <DialogContent className='h-[calc(100svh-2rem)] max-w-[calc(100vw-2rem)] grid-rows-[auto_1fr] sm:max-w-[calc(100vw-2rem)]'>
          <DialogHeader>
            <DialogTitle>Markdown preview</DialogTitle>
            <DialogDescription>Full-screen rendered preview.</DialogDescription>
          </DialogHeader>
          <div className='min-h-0 overflow-auto rounded-lg border p-4'>
            {value.trim() ? (
              <Markdown source={value} />
            ) : (
              <p className='text-muted-foreground text-sm italic'>Nothing to preview.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
