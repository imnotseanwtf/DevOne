'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DocPicker } from '@/features/platform/components/doc-picker';
import Link from 'next/link';

export interface PickerDrawing {
  id: string;
  title: string;
}

/** Chips for a task's drawings plus a picker; callers decide when links are saved. */
export function LinkedDrawingsField({
  projectId,
  drawings,
  available,
  disabled,
  onAdd,
  onRemove,
  error
}: {
  projectId: string;
  drawings: PickerDrawing[];
  available: PickerDrawing[];
  disabled?: boolean;
  onAdd: (drawing: PickerDrawing) => void;
  onRemove: (drawing: PickerDrawing) => void;
  error?: string;
}) {
  return (
    <div className='space-y-2'>
      <Label>Linked drawings</Label>
      <div className='flex flex-wrap items-center gap-2'>
        {drawings.map((drawing) => (
          <span
            key={drawing.id}
            className='bg-muted flex items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-xs'
          >
            <Link
              href={`/projects/${projectId}/drawings?drawing=${drawing.id}`}
              className='flex items-center gap-1.5 hover:underline'
            >
              <Icons.drawing className='text-muted-foreground size-3.5' aria-hidden='true' />
              {drawing.title}
            </Link>
            <Button
              type='button'
              variant='ghost'
              size='icon-xs'
              aria-label={`Unlink ${drawing.title}`}
              disabled={disabled}
              onClick={() => onRemove(drawing)}
            >
              <Icons.close />
            </Button>
          </span>
        ))}
        <DocPicker
          docs={available
            .filter((drawing) => !drawings.some((linked) => linked.id === drawing.id))
            .map((drawing) => ({ ...drawing, slug: drawing.id }))}
          onSelect={(doc) => onAdd({ id: doc.id, title: doc.title })}
          disabled={disabled}
          triggerLabel='Link drawing'
          searchPlaceholder='Search drawings…'
          emptyLabel='No drawings found.'
          itemIcon='drawing'
        />
      </div>
      {error && <p className='text-destructive text-xs'>{error}</p>}
    </div>
  );
}
