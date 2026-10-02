'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/** Copies `text` to the clipboard, for commands and links shown on a card. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      type='button'
      variant='ghost'
      size='icon-sm'
      className='text-muted-foreground'
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast.success(`Copied ${label}`);
        } catch {
          toast.error('Could not copy to the clipboard');
        }
      }}
    >
      <Icons.copy className='size-3.5' />
    </Button>
  );
}
