'use client';

import { Icons } from '@/components/icons';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { GitBranch } from '@/lib/git/provider';
import { useState } from 'react';

export interface BranchPickerRepository {
  id: string;
  fullName: string;
}

interface BranchPickerProps {
  branches: GitBranch[];
  current: string;
  onSelect: (name: string) => void;
  onCreate?: () => void;
  /** Other repositories linked to the project; shown only when there is more than one. */
  repositories?: BranchPickerRepository[];
  activeRepositoryId?: string;
  onSelectRepository?: (id: string) => void;
  /** The trigger element; its children are the branch label. */
  trigger: React.ReactElement;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
}

/** Searchable branch quick pick, like VS Code's "Select a branch" palette. */
export function BranchPicker({
  branches,
  current,
  onSelect,
  onCreate,
  repositories = [],
  activeRepositoryId,
  onSelectRepository,
  trigger,
  side = 'bottom',
  align = 'start'
}: BranchPickerProps) {
  const [open, setOpen] = useState(false);
  const choose = (run: () => void) => () => {
    setOpen(false);
    run();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} aria-label={`Branch ${current}, switch branch`}>
        <Icons.gitBranch aria-hidden='true' />
        <span className='truncate'>{current}</span>
        {side === 'bottom' && <Icons.chevronsUpDown aria-hidden='true' />}
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className='w-80 p-0'>
        <Command>
          <CommandInput placeholder='Select a branch…' />
          <CommandList>
            <CommandEmpty>No branches found.</CommandEmpty>
            {onCreate && (
              <CommandGroup>
                <CommandItem
                  value='__create-branch'
                  keywords={['create', 'new']}
                  onSelect={choose(onCreate)}
                >
                  <Icons.add aria-hidden='true' />
                  Create new branch…
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading='Branches'>
              {branches.map((entry) => (
                <CommandItem
                  key={entry.name}
                  value={entry.name}
                  onSelect={choose(() => onSelect(entry.name))}
                >
                  <Icons.gitBranch aria-hidden='true' />
                  <span className='truncate'>{entry.name}</span>
                  {entry.name === current ? (
                    <Icons.check className='ml-auto' aria-hidden='true' />
                  ) : (
                    <code className='text-muted-foreground ml-auto text-[10px]'>
                      {entry.sha.slice(0, 7)}
                    </code>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {repositories.length > 1 && onSelectRepository && (
              <>
                <CommandSeparator />
                <CommandGroup heading='Repositories'>
                  {repositories.map((repository) => (
                    <CommandItem
                      key={repository.id}
                      value={`repo:${repository.fullName}`}
                      onSelect={choose(() => onSelectRepository(repository.id))}
                    >
                      <Icons.github aria-hidden='true' />
                      <span className='truncate'>{repository.fullName}</span>
                      {repository.id === activeRepositoryId && (
                        <Icons.check className='ml-auto' aria-hidden='true' />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
