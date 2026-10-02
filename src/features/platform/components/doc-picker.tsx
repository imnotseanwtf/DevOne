'use client';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Icons } from '@/components/icons';
import { useId, useState } from 'react';

export interface PickerDoc {
  id: string;
  slug: string;
  title: string;
}

interface DocPickerProps {
  docs: PickerDoc[];
  onSelect: (doc: PickerDoc) => void;
  disabled?: boolean;
  triggerLabel?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  /** The icon beside each item; drawings reuse this picker. */
  itemIcon?: 'doc' | 'drawing';
}

/** Searchable "link a doc" picker — Popover + Command per the shadcn combobox pattern. */
export function DocPicker({
  docs,
  onSelect,
  disabled,
  triggerLabel = 'Link doc',
  searchPlaceholder = 'Search pages…',
  emptyLabel = 'No pages found.',
  itemIcon = 'doc'
}: DocPickerProps) {
  const ItemIcon = itemIcon === 'drawing' ? Icons.drawing : Icons.post;
  const [open, setOpen] = useState(false);
  const listboxId = useId();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type='button' variant='outline' size='sm' disabled={disabled} />}
      >
        <Icons.add aria-hidden='true' />
        {triggerLabel}
      </PopoverTrigger>
      <PopoverContent className='w-80 p-0'>
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList id={listboxId}>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {docs.map((doc) => (
                <CommandItem
                  key={doc.id}
                  value={doc.id}
                  keywords={[doc.title]}
                  onSelect={() => {
                    onSelect(doc);
                    setOpen(false);
                  }}
                >
                  <ItemIcon className='text-muted-foreground' aria-hidden='true' />
                  <span className='truncate'>{doc.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
