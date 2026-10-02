'use client';

import { Icons } from '@/components/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { deleteResourceAction } from '@/features/resources/actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function DeleteResourceButton({
  resourceId,
  resourceName
}: {
  resourceId: string;
  resourceName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const remove = () => {
    setError(undefined);
    startTransition(async () => {
      const result = await deleteResourceAction({ resourceId });
      if (!result.ok) {
        setError(result.error ?? 'Could not remove the resource');
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <AlertDialogTrigger
        render={
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            className='text-muted-foreground hover:text-destructive'
          />
        }
        onClick={(event) => event.stopPropagation()}
      >
        <Icons.trash className='size-3.5' />
        <span className='sr-only'>Remove {resourceName}</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove &ldquo;{resourceName}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes its keys and credentials and unlinks its databases. The app itself is not
            touched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={remove}>
            {pending ? 'Removing…' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
