'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { GitBranch } from '@/lib/git/provider';
import { useId, useState } from 'react';

export interface CreateBranchInput {
  name: string;
  from: string;
}

/** Name a new branch and pick which branch it starts from. */
export function CreateBranchDialog({
  open,
  branches,
  current,
  defaultBranch,
  changeCount,
  pending,
  onClose,
  onSubmit
}: {
  open: boolean;
  branches: GitBranch[];
  current: string;
  defaultBranch: string;
  changeCount: number;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: CreateBranchInput) => void;
}) {
  const id = useId();
  const [from, setFrom] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const dropsChanges = changeCount > 0 && from !== current;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <form
          className='space-y-4'
          onSubmit={(event) => {
            event.preventDefault();
            const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
            const problem = !name
              ? 'Name the branch'
              : branches.some((entry) => entry.name === name)
                ? `${name} already exists`
                : null;
            setError(problem);
            if (!problem) onSubmit({ name, from });
          }}
        >
          <DialogHeader>
            <DialogTitle>Create branch</DialogTitle>
            <DialogDescription>
              The new branch starts at the latest commit of the source branch, then you switch to
              it.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-1.5'>
            <Label htmlFor={`${id}-name`}>Branch name</Label>
            <Input
              id={`${id}-name`}
              name='name'
              placeholder='feature/my-change'
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              maxLength={200}
              autoComplete='off'
              spellCheck={false}
              autoFocus
              className='font-mono text-sm'
            />
            {error && (
              <p id={`${id}-error`} className='text-destructive text-xs'>
                {error}
              </p>
            )}
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor={`${id}-from`}>Source branch</Label>
            <NativeSelect
              id={`${id}-from`}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className='w-full font-mono'
            >
              {branches.map((entry) => (
                <NativeSelectOption key={entry.name} value={entry.name}>
                  {entry.name}
                  {entry.name === defaultBranch ? ' (default)' : ''}
                  {entry.name === current ? ' (current)' : ''}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p
              className={
                dropsChanges
                  ? 'text-xs text-amber-600 dark:text-amber-400'
                  : 'text-muted-foreground text-xs'
              }
            >
              {changeCount === 0
                ? 'You have no uncommitted changes.'
                : dropsChanges
                  ? `Your ${changeCount} uncommitted change${changeCount === 1 ? '' : 's'} on ${current} will be discarded.`
                  : `Your ${changeCount} uncommitted change${changeCount === 1 ? '' : 's'} come${changeCount === 1 ? 's' : ''} along.`}
            </p>
          </div>

          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' disabled={pending}>
              {pending ? 'Creating…' : 'Create branch'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
