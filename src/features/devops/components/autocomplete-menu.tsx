'use client';

import type { AutocompleteMenu as Menu } from '@/features/devops/components/use-autocomplete';
import type { Completion } from '@/features/devops/terminal-helper/complete';
import { useT } from '@/i18n/client';
import { cn } from '@/lib/utils';

interface AutocompleteMenuProps {
  menu: Menu;
  onAccept: (item: Completion) => void;
}

/** The suggestion dropdown, placed at the word being typed. */
export function AutocompleteMenu({ menu, onAccept }: AutocompleteMenuProps) {
  const t = useT();
  return (
    <div
      role='listbox'
      aria-label={t('devops.terminal.tools.suggestions')}
      className='absolute z-20 w-[340px] overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 text-xs text-neutral-100 shadow-lg'
      style={{ left: menu.left, top: menu.top ?? undefined, bottom: menu.bottom ?? undefined }}
    >
      {menu.items.map((item, index) => (
        <div
          key={item.label}
          role='option'
          aria-selected={index === menu.index}
          tabIndex={-1}
          // Keeps the terminal focused: a click must not steal the keyboard.
          onMouseDown={(event) => {
            event.preventDefault();
            onAccept(item);
          }}
          className={cn(
            'flex h-[26px] cursor-pointer items-center gap-3 px-2',
            index === menu.index && 'bg-neutral-700'
          )}
        >
          <span className='font-mono'>{item.label}</span>
          <span className='ml-auto truncate text-neutral-400'>
            {item.kind === 'history' ? t('devops.terminal.tools.fromHistory') : item.description}
          </span>
        </div>
      ))}
      <div className='border-t border-neutral-700 px-2 py-1 text-[11px] text-neutral-400'>
        {t('devops.terminal.tools.menuHint')}
      </div>
    </div>
  );
}
