'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ConnectionForm,
  type ConnectionResourceOption
} from '@/features/database/components/connection-form';
import type { PublicConnection } from '@/features/database/service';
import { useState } from 'react';

export function EditConnectionDialog({
  connection,
  resources
}: {
  connection: PublicConnection;
  resources: ConnectionResourceOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            className='text-muted-foreground hover:text-foreground'
          />
        }
      >
        <Icons.edit className='size-3.5' />
        <span className='sr-only'>Edit {connection.name}</span>
      </DialogTrigger>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Edit &ldquo;{connection.name}&rdquo;</DialogTitle>
          <DialogDescription>
            Changing the engine, host, or port clears the default database, since the new server may
            not have it.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className='max-h-[65vh] pr-4'>
          {/* Mounted only while open, so it always starts from the saved values. */}
          {open && (
            <ConnectionForm
              projectId={connection.projectId}
              connection={connection}
              resources={resources}
              onSuccess={() => setOpen(false)}
            />
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
