'use client';

import { Label } from '@/components/ui/label';
import { RichMarkdownEditor } from '@/components/rich-markdown-editor';
import {
  DocsAssistantProvider,
  useDocsAssistant
} from '@/features/docs-chat/components/docs-assistant';
import { DocInlineAi } from '@/features/docs-chat/components/doc-inline-ai';
import { DocsChat, DocsChatToggle } from '@/features/docs-chat/components/docs-chat';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import { useEffect, useRef } from 'react';

interface AiDescriptionEditorProps {
  projectId: string;
  /** Identifies what is being edited: the task's id, or `new` while it is being created. */
  scopeId: string;
  /** The task's title as typed so far, so the AI knows what the description is for. */
  title: string;
  label: string;
  labelFor?: string;
  value: string;
  onChange: (markdown: string) => void;
  readOnly?: boolean;
}

/**
 * A task's description editor with the docs AI built in: hover a block to edit
 * it, or open "Ask AI" for a chat that can answer, write the description from
 * scratch, or propose a rewrite (which only lands when applied, and can be
 * undone). Uses the same model choice as the docs.
 */
export function AiDescriptionEditor(props: AiDescriptionEditorProps) {
  return (
    <DocsAssistantProvider>
      <Inner {...props} />
    </DocsAssistantProvider>
  );
}

function Inner({
  projectId,
  scopeId,
  title,
  label,
  labelFor,
  value,
  onChange,
  readOnly
}: AiDescriptionEditorProps) {
  const { register, open } = useDocsAssistant();
  const chat = useRef<HTMLDivElement>(null);
  const editor = useRef<MDXEditorMethods>(null);
  // The bridge outlives renders, so it reads the latest callback and value from here.
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  useEffect(() => {
    register({
      docId: scopeId,
      getMarkdown: () => editor.current?.getMarkdown() ?? latest.current.value,
      replaceMarkdown: (markdown) => {
        editor.current?.setMarkdown(markdown);
        latest.current.onChange(markdown);
      }
    });
    return () => register(null);
  }, [register, scopeId]);

  // The chat opens under a tall editor, often below the fold of a dialog: bring it into view.
  useEffect(() => {
    if (open) chat.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open]);

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between gap-2'>
        <Label htmlFor={labelFor}>{label}</Label>
        {!readOnly && <DocsChatToggle />}
      </div>
      <RichMarkdownEditor ref={editor} markdown={value} onChange={onChange} readOnly={readOnly} />
      {!readOnly && <DocInlineAi projectId={projectId} docId={scopeId} title={title} />}
      <div ref={chat}>
        <DocsChat projectId={projectId} currentTitle={title} kind='task' variant='inline' />
      </div>
    </div>
  );
}
