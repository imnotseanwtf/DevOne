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
import { cn } from '@/lib/utils';
import { useId, useState } from 'react';

export interface PickerRepository {
  connectionId: string;
  providerRepositoryId: string;
  fullName: string;
}

export function repositoryPickerValue(repository: PickerRepository): string {
  return `${repository.connectionId}:${repository.providerRepositoryId}`;
}

/** Suggests a project name from a repo: "acme/bantay-benta-api" → "Bantay Benta Api". */
export function suggestProjectName(fullName: string): string {
  const short = fullName.split('/').pop()?.trim() || fullName.trim();
  return (
    short
      .replaceAll(/[-_.]+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
      .slice(0, 80) || fullName.slice(0, 80)
  );
}

interface RepositoryPickerProps {
  id?: string;
  repositories: PickerRepository[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/** Searchable repository select — Popover + Command per the shadcn combobox pattern. */
export function RepositoryPicker({
  id,
  repositories,
  value,
  onChange,
  disabled,
  placeholder = 'Select a repository',
  className
}: RepositoryPickerProps) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const selected = repositories.find((repository) => repositoryPickerValue(repository) === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant='outline'
            role='combobox'
            aria-controls={listboxId}
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              'w-full justify-between font-normal',
              !selected && 'text-muted-foreground',
              className
            )}
          />
        }
      >
        <span className='truncate'>{selected?.fullName ?? placeholder}</span>
        <Icons.chevronsUpDown className='ml-2 size-4 shrink-0 opacity-50' />
      </PopoverTrigger>
      <PopoverContent className='w-(--anchor-width) p-0'>
        <Command>
          <CommandInput placeholder='Search repositories…' />
          <CommandList id={listboxId}>
            <CommandEmpty>No repositories found.</CommandEmpty>
            <CommandGroup>
              {repositories.map((repository) => {
                const optionValue = repositoryPickerValue(repository);
                return (
                  <CommandItem
                    key={optionValue}
                    value={optionValue}
                    keywords={[repository.fullName]}
                    onSelect={(next) => {
                      onChange(next);
                      setOpen(false);
                    }}
                  >
                    <Icons.check
                      className={cn(
                        'mr-2 size-4',
                        value === optionValue ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className='truncate'>{repository.fullName}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
