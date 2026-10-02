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
import { useRef, useState } from 'react';

export interface NameDialogCopy {
  title: string;
  description: string;
  label: string;
  action: string;
  value: string;
}

/** One-field prompt for new file, rename and new branch; `validate` returns an error or null. */
export function NameDialog({
  copy,
  pending,
  validate,
  onClose,
  onSubmit
}: {
  copy: NameDialogCopy | null;
  pending?: boolean;
  validate: (value: string) => string | null;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // After a submit the editor takes focus; only a cancel returns it to the trigger.
  const submitted = useRef(false);

  return (
    <Dialog
      open={copy !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className='sm:max-w-md' finalFocus={() => !submitted.current}>
        {copy && (
          <form
            className='space-y-4'
            onSubmit={(event) => {
              event.preventDefault();
              const value = String(new FormData(event.currentTarget).get('name') ?? '').trim();
              const problem = validate(value);
              setError(problem);
              if (problem) return;
              submitted.current = true;
              onSubmit(value);
            }}
          >
            <DialogHeader>
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.description}</DialogDescription>
            </DialogHeader>
            <div className='space-y-1.5'>
              <Input
                name='name'
                aria-label={copy.label}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'name-dialog-error' : undefined}
                defaultValue={copy.value}
                maxLength={1000}
                autoComplete='off'
                spellCheck={false}
                autoFocus
                onFocus={(event) => {
                  // Select the file name, VS Code style, so typing replaces it.
                  const input = event.currentTarget;
                  const start = input.value.lastIndexOf('/') + 1;
                  const dot = input.value.lastIndexOf('.');
                  input.setSelectionRange(start, dot > start ? dot : input.value.length);
                }}
                className='font-mono text-sm'
              />
              {error && (
                <p id='name-dialog-error' className='text-destructive text-xs'>
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type='button' variant='outline' onClick={onClose}>
                Cancel
              </Button>
              <Button type='submit' disabled={pending}>
                {copy.action}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
