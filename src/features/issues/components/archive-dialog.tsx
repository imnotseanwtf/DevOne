'use client';

import { Icons } from '@/components/icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { deleteArchivedIssueAction, restoreIssueAction } from '@/features/issues/actions';
import { useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';

export interface ArchivedIssue {
  id: string;
  issueKey: string;
  title: string;
  type: string;
  status: string;
  archivedAt: string;
}

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

/** Tasks deleted from this board: restore them, or delete them for good. */
export function ArchiveDialog({
  open,
  onOpenChange,
  issues
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: ArchivedIssue[];
}) {
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<ArchivedIssue | null>(null);
  const [, startTransition] = useTransition();
  const [visible, hide] = useOptimistic(issues, (current, id: string) =>
    current.filter((issue) => issue.id !== id)
  );

  const term = query.trim().toLowerCase();
  const shown = term
    ? visible.filter(
        (issue) =>
          issue.title.toLowerCase().includes(term) || issue.issueKey.toLowerCase().includes(term)
      )
    : visible;

  const run = (
    issue: ArchivedIssue,
    action: (input: { issueId: string }) => Promise<{ ok: boolean; error?: string }>,
    done: string
  ) =>
    startTransition(async () => {
      hide(issue.id);
      const result = await action({ issueId: issue.id });
      if (!result.ok) toast.error(result.error ?? 'Something went wrong');
      else toast.success(done);
    });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Archive</DialogTitle>
            <DialogDescription>
              Tasks deleted from this board. Restore puts a task back in its column; delete removes
              it for good.
            </DialogDescription>
          </DialogHeader>
          {visible.length > 0 && (
            <div className='relative'>
              <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2' />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder='Search archived tasks…'
                aria-label='Search archived tasks'
                className='pl-9'
              />
            </div>
          )}
          {shown.length === 0 ? (
            <p className='text-muted-foreground py-6 text-center text-sm'>
              {visible.length === 0
                ? 'Nothing archived. Deleted tasks show up here.'
                : `No archived tasks match “${query.trim()}”.`}
            </p>
          ) : (
            <ul className='max-h-[60svh] divide-y overflow-y-auto rounded-md border'>
              {shown.map((issue) => (
                <li key={issue.id} className='flex items-center gap-3 px-3 py-2'>
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm font-medium'>
                      <code className='text-muted-foreground mr-2 text-xs'>{issue.issueKey}</code>
                      {issue.title}
                    </p>
                    <p className='text-muted-foreground text-xs'>
                      {issue.type} · was in {issue.status.replaceAll('_', ' ')} · deleted{' '}
                      {dateFormat.format(new Date(issue.archivedAt))}
                    </p>
                  </div>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() =>
                      run(issue, restoreIssueAction, `${issue.issueKey} is back on the board`)
                    }
                  >
                    <Icons.discard aria-hidden='true' />
                    Restore
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='text-muted-foreground hover:text-destructive'
                    aria-label={`Delete ${issue.issueKey} permanently`}
                    onClick={() => setConfirm(issue)}
                  >
                    <Icons.trash aria-hidden='true' />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm !== null} onOpenChange={(next) => !next && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirm?.issueKey} permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirm?.title}” and its comments and links are removed for good. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                if (confirm)
                  run(
                    confirm,
                    deleteArchivedIssueAction,
                    `${confirm.issueKey} deleted permanently`
                  );
                setConfirm(null);
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
