'use client';

import { Icons } from '@/components/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { applySchemaChangesAction, previewSchemaChangesAction } from '@/features/database/actions';
import { describeChange, type PendingChange } from '@/features/database/schema-changes';
import type { DatabaseProviderName } from '@/lib/database/types';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function PendingChanges({
  pending,
  connectionId,
  database,
  provider,
  onRemove,
  onDiscard,
  onApplied
}: {
  pending: PendingChange[];
  connectionId: string;
  database?: string;
  provider: DatabaseProviderName;
  onRemove: (id: string) => void;
  onDiscard: () => void;
  /** Called with how many leading changes landed; the rest stay staged. */
  onApplied: (count: number) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [statements, setStatements] = useState<string[]>();
  const [error, setError] = useState<string>();
  const [previewing, startPreviewing] = useTransition();
  const [running, startRunning] = useTransition();

  if (pending.length === 0) return null;
  const changes = pending.map((entry) => entry.change);

  const onOpenChange = (next: boolean) => {
    if (running) return;
    setOpen(next);
    if (!next) return;
    setStatements(undefined);
    setError(undefined);
    startPreviewing(async () => {
      const result = await previewSchemaChangesAction({ connectionId, changes, database });
      if (!result.ok) {
        setError(result.error ?? 'Could not build the SQL');
        return;
      }
      setStatements(result.statements ?? []);
    });
  };

  const execute = () => {
    setError(undefined);
    startRunning(async () => {
      const result = await applySchemaChangesAction({ connectionId, changes, database });
      if (result.ok) {
        onApplied(changes.length);
        setOpen(false);
        router.refresh();
        return;
      }
      setError(result.error ?? 'Could not apply the changes');
      if (result.appliedChanges) {
        onApplied(result.appliedChanges);
        router.refresh();
      }
    });
  };

  return (
    <div className='border-primary/40 bg-primary/5 space-y-2 rounded-lg border p-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-sm font-medium'>
          {pending.length} pending change{pending.length === 1 ? '' : 's'}
        </p>
        <div className='flex items-center gap-2'>
          <Button type='button' variant='ghost' size='sm' onClick={onDiscard}>
            Discard all
          </Button>
          <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogTrigger render={<Button type='button' size='sm' />}>
              <Icons.run className='size-3.5' />
              Execute
            </DialogTrigger>
            <DialogContent className='sm:max-w-2xl'>
              <DialogHeader>
                <DialogTitle>Execute schema changes</DialogTitle>
                <DialogDescription>
                  {provider === 'POSTGRES'
                    ? 'Runs in a single transaction — if any statement fails, nothing is applied.'
                    : "MySQL commits every schema statement on its own and can't roll them back. They run in order and stop at the first failure; anything before it stays applied."}
                </DialogDescription>
              </DialogHeader>

              {previewing ? (
                <p className='text-muted-foreground py-6 text-center text-sm'>Building SQL…</p>
              ) : statements ? (
                <pre className='bg-muted max-h-80 overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap'>
                  {provider === 'POSTGRES' && 'BEGIN;\n'}
                  {statements.map((sql) => `${sql};`).join('\n')}
                  {provider === 'POSTGRES' && '\nCOMMIT;'}
                </pre>
              ) : null}

              {error && (
                <Alert variant='destructive'>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <Button
                  type='button'
                  variant='outline'
                  disabled={running}
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type='button'
                  disabled={running || previewing || !statements?.length}
                  onClick={execute}
                >
                  <Icons.run className='size-3.5' />
                  {running ? 'Executing…' : 'Execute'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <ol className='space-y-1'>
        {pending.map((entry, index) => (
          <li key={entry.id} className='flex items-center gap-2 text-xs'>
            <span className='text-muted-foreground w-5 shrink-0 text-right'>{index + 1}.</span>
            <span className='min-w-0 flex-1 truncate font-mono'>
              {describeChange(entry.change)}
            </span>
            <Button
              type='button'
              variant='ghost'
              size='icon-xs'
              aria-label='Remove this change'
              onClick={() => onRemove(entry.id)}
            >
              <Icons.close className='size-3' />
            </Button>
          </li>
        ))}
      </ol>
    </div>
  );
}
