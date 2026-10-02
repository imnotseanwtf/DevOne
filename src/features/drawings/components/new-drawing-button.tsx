'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createDrawingAction } from '@/features/drawings/actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/** Creates an untitled drawing and opens it; the name is edited in place afterwards. */
export function NewDrawingButton({
  projectId,
  kind,
  live = false,
  className,
  variant = 'default'
}: {
  projectId: string;
  kind: 'EXCALIDRAW' | 'DRAWIO';
  /** Excalidraw only: create a live sketch. */
  live?: boolean;
  className?: string;
  variant?: 'default' | 'outline';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <>
      <Button
        type='button'
        variant={variant}
        className={className}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const result = await createDrawingAction({
              projectId,
              kind,
              live,
              title: kind === 'DRAWIO' ? 'Untitled diagram' : 'Untitled drawing'
            });
            if (!result.ok || !result.drawingId) {
              setError(result.error ?? 'Could not create the drawing');
              return;
            }
            router.push(`/projects/${projectId}/drawings?drawing=${result.drawingId}`);
          })
        }
      >
        {pending ? (
          <Icons.spinner className='animate-spin' aria-hidden='true' />
        ) : kind === 'DRAWIO' ? (
          <Icons.diagram aria-hidden='true' />
        ) : (
          <Icons.drawing aria-hidden='true' />
        )}
        {kind === 'DRAWIO'
          ? 'New diagram (draw.io)'
          : live
            ? 'New live sketch'
            : 'New local sketch'}
      </Button>
      {error && <p className='text-destructive text-xs'>{error}</p>}
    </>
  );
}
