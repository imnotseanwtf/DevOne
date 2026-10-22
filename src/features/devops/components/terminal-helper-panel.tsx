'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Icons } from '@/components/icons';
import { searchCommands } from '@/features/devops/terminal-helper/commands';
import { useT } from '@/i18n/client';
import { useState } from 'react';

interface TerminalHelperPanelProps {
  /** Types the text into the terminal, without pressing Enter. */
  onInsert: (command: string) => void;
}

/** A searchable cheat sheet: pick a command and it is typed at the prompt, ready to edit and run. */
export function TerminalHelperPanel({ onInsert }: TerminalHelperPanelProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const groups = searchCommands(query);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant='ghost' size='sm' className='h-7 gap-1.5 text-neutral-300' />}
      >
        <Icons.sparkles className='size-3.5' />
        {t('devops.terminal.tools.helper')}
      </PopoverTrigger>
      <PopoverContent align='start' className='w-[min(32rem,90vw)] space-y-3 p-3'>
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('devops.terminal.tools.helperSearch')}
          aria-label={t('devops.terminal.tools.helperSearch')}
        />
        <p className='text-muted-foreground text-xs'>{t('devops.terminal.tools.helperHint')}</p>
        <div className='max-h-80 space-y-4 overflow-y-auto pr-1'>
          {groups.length === 0 && (
            <p className='text-muted-foreground text-sm'>{t('devops.terminal.tools.noMatches')}</p>
          )}
          {groups.map((group) => (
            <section key={group.id} className='space-y-1'>
              <h4 className='text-muted-foreground text-xs font-medium'>{group.title}</h4>
              <ul>
                {group.commands.map((entry) => (
                  <li key={entry.command}>
                    <button
                      type='button'
                      className='hover:bg-muted w-full rounded-md px-2 py-1.5 text-left'
                      onClick={() => {
                        onInsert(entry.command);
                        setOpen(false);
                      }}
                    >
                      <span className='flex items-center gap-2'>
                        <code className='font-mono text-xs break-all'>{entry.command}</code>
                        {entry.risky && (
                          <Badge variant='destructive' className='shrink-0'>
                            {t('devops.terminal.tools.risky')}
                          </Badge>
                        )}
                      </span>
                      <span className='text-muted-foreground block text-xs'>
                        {entry.description}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
