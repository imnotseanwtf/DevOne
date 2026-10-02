'use client';

import { Icons } from '@/components/icons';
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
import { importDrawingAction } from '@/features/drawings/actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/** Paste an excalidraw.com shareable link or live-session link; it becomes a DevOne sketch. */
export function ImportDrawingDialog({
  projectId,
  folder,
  open,
  onOpenChange
}: {
  projectId: string;
  folder: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setError(undefined);
        onOpenChange(next);
      }}
    >
      <DialogContent className='sm:max-w-lg'>
        <form
          className='space-y-4'
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setError(undefined);
            startTransition(async () => {
              const result = await importDrawingAction({
                projectId,
                folder,
                url: String(data.get('url') ?? ''),
                title: String(data.get('title') ?? '')
              });
              if (!result.ok || !result.drawingId) {
                setError(result.error ?? 'Could not import the drawing');
                return;
              }
              onOpenChange(false);
              router.push(`/projects/${projectId}/drawings?drawing=${result.drawingId}`);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Import from Excalidraw</DialogTitle>
            <DialogDescription>
              Paste a shareable link (<code>#json=…</code>) or a live-session link (
              <code>#room=…</code>) from excalidraw.com. A copy of the drawing is saved in DevOne
              {folder ? ` in ${folder}` : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-1.5'>
            <Label htmlFor='import-url'>Excalidraw link</Label>
            <Input
              id='import-url'
              name='url'
              placeholder='https://excalidraw.com/#room=…'
              autoComplete='off'
              required
              autoFocus
              disabled={pending}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='import-title'>Name</Label>
            <Input
              id='import-title'
              name='title'
              placeholder='Imported drawing'
              maxLength={120}
              disabled={pending}
            />
          </div>
          {error && <p className='text-destructive text-sm'>{error}</p>}
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type='submit' disabled={pending}>
              {pending ? (
                <Icons.spinner className='animate-spin' aria-hidden='true' />
              ) : (
                <Icons.import aria-hidden='true' />
              )}
              {pending ? 'Importing…' : 'Import'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Import from Excalidraw" for the empty state. */
export function ImportDrawingButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type='button' variant='outline' onClick={() => setOpen(true)}>
        <Icons.import aria-hidden='true' />
        Import from Excalidraw
      </Button>
      <ImportDrawingDialog projectId={projectId} folder={null} open={open} onOpenChange={setOpen} />
    </>
  );
}
