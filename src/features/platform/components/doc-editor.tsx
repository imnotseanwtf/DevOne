'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { RichMarkdownEditor } from '@/components/rich-markdown-editor';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import { Icons } from '@/components/icons';
import {
  deleteDocAction,
  linkDocToIssueAction,
  saveDocAction,
  unlinkDocFromIssueAction
} from '@/features/platform/actions';
import { IssuePicker, type PickerIssue } from '@/features/issues/components/issue-picker';
import { useAppForm } from '@/lib/form';
import { cn } from '@/lib/utils';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import { useStore } from '@tanstack/react-form';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { z } from 'zod';

const titleSchema = z.string().trim().min(2, 'Use at least 2 characters for the title').max(200);

interface DocEditorProps {
  docId: string;
  projectId: string;
  initialTitle?: string;
  initialBody?: string;
  availableIssues?: PickerIssue[];
  initialLinkedIssues?: PickerIssue[];
}

export function DocEditor({
  docId,
  projectId,
  initialTitle = 'Untitled',
  initialBody = '',
  availableIssues = [],
  initialLinkedIssues = []
}: DocEditorProps) {
  const router = useRouter();
  const [linkedIssues, setLinkedIssues] = useState(initialLinkedIssues);
  const [linkPending, startLinkTransition] = useTransition();
  const [linkError, setLinkError] = useState<string>();

  function addLink(issue: PickerIssue) {
    setLinkError(undefined);
    setLinkedIssues((current) => [issue, ...current]);
    startLinkTransition(async () => {
      const result = await linkDocToIssueAction({
        projectId,
        docId,
        issueId: issue.id
      });
      if (!result.ok) {
        setLinkedIssues((current) => current.filter((entry) => entry.id !== issue.id));
        setLinkError(result.error ?? 'Could not link the task');
        return;
      }
      router.refresh();
    });
  }

  function removeLink(issue: PickerIssue) {
    setLinkError(undefined);
    setLinkedIssues((current) => current.filter((entry) => entry.id !== issue.id));
    startLinkTransition(async () => {
      const result = await unlinkDocFromIssueAction({
        projectId,
        docId,
        issueId: issue.id
      });
      if (!result.ok) {
        setLinkedIssues((current) => [issue, ...current]);
        setLinkError(result.error ?? 'Could not remove the link');
        return;
      }
      router.refresh();
    });
  }
  const editorRef = useRef<MDXEditorMethods>(null);
  const saveQueue = useRef(Promise.resolve());
  const mounted = useRef(false);
  const deletingRef = useRef(false);
  const lastSaved = useRef(`${initialTitle}\0${initialBody}`);
  const form = useAppForm({
    defaultValues: { title: initialTitle, body: initialBody }
  });
  const { title, body } = useStore(form.store, (state) => state.values);
  const [error, setError] = useState<string>();
  const [savedValue, setSavedValue] = useState(lastSaved.current);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  const save = useCallback(() => {
    const { title, body } = form.state.values;
    const markdown = editorRef.current?.getMarkdown() ?? body;
    const value = `${title}\0${markdown}`;
    if (deletingRef.current || !titleSchema.safeParse(title).success) return saveQueue.current;

    saveQueue.current = saveQueue.current.then(async () => {
      if (deletingRef.current || value === lastSaved.current) return;
      if (mounted.current) {
        setSaving(true);
        setError(undefined);
      }
      try {
        const result = await saveDocAction({
          docId,
          projectId,
          title,
          body: markdown
        });
        if (!result.ok) throw new Error(result.error ?? 'Could not save the page');
        lastSaved.current = value;
        if (mounted.current) {
          setSavedValue(value);
          router.refresh();
        }
      } catch (cause) {
        if (mounted.current) {
          setError(cause instanceof Error ? cause.message : 'Could not save the page');
        }
      } finally {
        if (mounted.current) setSaving(false);
      }
    });
    return saveQueue.current;
  }, [docId, form, projectId, router]);

  useEffect(() => {
    if (deleting || `${title}\0${body}` === savedValue) return;
    const timeout = setTimeout(() => void save(), 1000);
    return () => clearTimeout(timeout);
  }, [body, deleting, save, savedValue, title]);

  useEffect(() => {
    mounted.current = true;
    const warnIfUnsaved = (event: BeforeUnloadEvent) => {
      const { title, body } = form.state.values;
      if (!deletingRef.current && `${title}\0${body}` !== lastSaved.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warnIfUnsaved);
    return () => {
      mounted.current = false;
      window.removeEventListener('beforeunload', warnIfUnsaved);
      void save();
    };
  }, [form, save]);

  async function deletePage() {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await saveQueue.current;
      const result = await deleteDocAction({ docId, projectId });
      if (!result.ok) throw new Error(result.error ?? 'Could not delete the page');
      router.replace(`/projects/${projectId}/docs`);
      router.refresh();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Could not delete the page');
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  const saveState = error
    ? 'error'
    : saving
      ? 'saving'
      : `${title}\0${body}` === savedValue
        ? 'saved'
        : 'unsaved';

  return (
    <div className='flex min-w-0 flex-col gap-3'>
      <form.AppForm>
        <div className='flex flex-wrap items-center gap-3'>
          <form.Field name='title' validators={{ onChange: titleSchema }}>
            {(field) => (
              <div className='flex w-full max-w-sm flex-col gap-1'>
                <Input
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  maxLength={200}
                  disabled={deleting}
                  aria-label='Page title'
                  aria-invalid={field.state.meta.errors.length > 0 || undefined}
                  className='h-9 text-base font-semibold'
                />
                {field.state.meta.errors.length > 0 && (
                  <p className='text-destructive text-xs'>
                    {field.state.meta.errors
                      .map((issue) => (typeof issue === 'string' ? issue : issue?.message))
                      .join(', ')}
                  </p>
                )}
              </div>
            )}
          </form.Field>
          <span
            role='status'
            className={cn(
              'text-muted-foreground flex items-center gap-1.5 text-xs',
              saveState === 'error' && 'text-destructive'
            )}
          >
            {saveState === 'saving' ? (
              <Icons.spinner className='size-3.5 animate-spin' aria-hidden='true' />
            ) : saveState === 'saved' ? (
              <Icons.check className='size-3.5' aria-hidden='true' />
            ) : null}
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'unsaved'
                ? 'Unsaved changes'
                : saveState === 'error'
                  ? 'Not saved'
                  : 'Saved'}
          </span>
          {saveState === 'error' && (
            <Button type='button' variant='outline' size='sm' onClick={() => void save()}>
              Retry
            </Button>
          )}
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='ml-auto'
            onClick={() => setFullScreen(true)}
          >
            <Icons.maximize aria-hidden='true' />
            Full screen
          </Button>
          <AlertDialog open={deleteOpen} onOpenChange={(open) => !deleting && setDeleteOpen(open)}>
            <AlertDialogTrigger
              render={
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='text-muted-foreground hover:text-destructive'
                />
              }
            >
              <Icons.trash aria-hidden='true' />
              Delete
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this page?</AlertDialogTitle>
                <AlertDialogDescription>
                  “{title}” will be permanently deleted. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {deleteError && (
                <Alert variant='destructive'>
                  <AlertDescription>{deleteError}</AlertDescription>
                </Alert>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                <LoadingButton
                  type='button'
                  variant='destructive'
                  loading={deleting}
                  loadingLabel='Deleting page…'
                  onClick={() => void deletePage()}
                >
                  Delete page
                </LoadingButton>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-muted-foreground text-xs'>Linked tasks</span>
          {linkedIssues.map((issue) => (
            <span
              key={issue.id}
              className='bg-muted flex items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-xs'
            >
              <Link href={`/projects/${projectId}/issues`} className='hover:underline'>
                <span className='text-muted-foreground'>{issue.issueKey}</span> {issue.title}
              </Link>
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                aria-label={`Unlink ${issue.issueKey}`}
                disabled={linkPending || deleting}
                onClick={() => removeLink(issue)}
              >
                <Icons.close />
              </Button>
            </span>
          ))}
          <IssuePicker
            issues={availableIssues.filter(
              (issue) => !linkedIssues.some((linked) => linked.id === issue.id)
            )}
            onSelect={addLink}
            disabled={linkPending || deleting}
          />
        </div>
        {linkError && <p className='text-destructive text-sm'>{linkError}</p>}
        {error && <p className='text-destructive text-sm'>{error}</p>}

        <form.Field name='body'>
          {(field) => (
            <RichMarkdownEditor
              ref={editorRef}
              markdown={field.state.value}
              onChange={field.handleChange}
              readOnly={deleting}
              fullScreen={fullScreen}
              onFullScreenChange={setFullScreen}
            />
          )}
        </form.Field>
      </form.AppForm>
    </div>
  );
}
