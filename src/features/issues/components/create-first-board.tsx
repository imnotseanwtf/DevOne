'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Icons } from '@/components/icons';
import { createBoardAction } from '@/features/issues/actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/** Shown instead of the board when a project has none yet — nothing to drag
 * cards into until the user names their first one. */
export function CreateFirstBoard({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <div className='mx-auto max-w-md space-y-4 py-16 text-center'>
      <Icons.kanban className='text-muted-foreground mx-auto size-10' aria-hidden='true' />
      <div className='space-y-1'>
        <h2 className='text-lg font-semibold'>Create your first board</h2>
        <p className='text-muted-foreground text-sm'>
          This project has no boards yet. Name one to start planning work.
        </p>
      </div>
      <form
        className='flex items-start justify-center gap-2'
        onSubmit={(event) => {
          event.preventDefault();
          setError(undefined);
          startTransition(async () => {
            const result = await createBoardAction({ projectId, name });
            if (!result.ok || !result.boardId) {
              setError(result.error ?? 'Could not create the board');
              return;
            }
            router.push(
              `/projects/${projectId}/issues?board=${encodeURIComponent(result.boardId)}`
            );
            router.refresh();
          });
        }}
      >
        <div className='text-left'>
          <Label htmlFor='first-board-name' className='sr-only'>
            Board name
          </Label>
          <Input
            id='first-board-name'
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder='Board name'
            minLength={2}
            maxLength={80}
            required
            autoFocus
          />
        </div>
        <Button type='submit' disabled={pending}>
          {pending ? 'Creating…' : 'Create board'}
        </Button>
      </form>
      {error && (
        <Alert variant='destructive' className='text-left'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
