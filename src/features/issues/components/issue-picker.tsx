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

export interface PickerIssue {
  id: string;
  issueKey: string;
  title: string;
}

interface IssuePickerProps {
  issues: PickerIssue[];
  onSelect: (issue: PickerIssue) => void;
  disabled?: boolean;
  triggerLabel?: string;
}

/** Searchable "link a task" picker — Popover + Command per the shadcn combobox pattern. */
export function IssuePicker({
  issues,
  onSelect,
  disabled,
  triggerLabel = 'Link task'
}: IssuePickerProps) {
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
          <CommandInput placeholder='Search tasks…' />
          <CommandList id={listboxId}>
            <CommandEmpty>No tasks found.</CommandEmpty>
            <CommandGroup>
              {issues.map((issue) => (
                <CommandItem
                  key={issue.id}
                  value={issue.id}
                  keywords={[issue.issueKey, issue.title]}
                  onSelect={() => {
                    onSelect(issue);
                    setOpen(false);
                  }}
                >
                  <span className='text-muted-foreground shrink-0 text-xs'>{issue.issueKey}</span>
                  <span className='truncate'>{issue.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
