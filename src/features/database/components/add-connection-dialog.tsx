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
import { useState } from 'react';

export function AddConnectionDialog({
  projectId,
  resources,
  variant = 'default'
}: {
  projectId: string;
  resources: ConnectionResourceOption[];
  variant?: 'default' | 'empty';
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant={variant === 'empty' ? 'default' : 'outline'} size='sm' />}
      >
        <Icons.add className='size-4' />
        Add connection
      </DialogTrigger>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Add a connection</DialogTitle>
          <DialogDescription>
            Connect to a Postgres or MySQL server. You&apos;ll browse and pick a database on it
            afterward.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className='max-h-[65vh] pr-4'>
          <ConnectionForm
            projectId={projectId}
            resources={resources}
            onSuccess={() => setOpen(false)}
          />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
