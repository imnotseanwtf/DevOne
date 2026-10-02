'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

/** A labelled side list that folds down to its toggle; the choice is remembered per `storageKey`. */
export function CollapsibleSidebar({
  label,
  storageKey,
  expandedClassName = 'lg:w-60',
  children
}: {
  label: string;
  storageKey: string;
  /** Width while expanded, e.g. 'md:w-64'. */
  expandedClassName?: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(storageKey) === '1');
    } catch {
      // Private browsing / blocked storage: fall back to expanded.
    }
  }, [storageKey]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        // Nothing to persist to; the toggle still works for this render.
      }
      return next;
    });
  };

  return (
    <aside
      aria-label={label}
      className={cn(
        'shrink-0 transition-[width] duration-150',
        collapsed ? 'w-9' : expandedClassName
      )}
    >
      <div className='mb-1 flex items-center justify-between gap-1'>
        {!collapsed && (
          <span className='text-muted-foreground px-1 text-xs font-medium tracking-wide uppercase'>
            {label}
          </span>
        )}
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          onClick={toggle}
          className={collapsed ? 'mx-auto' : undefined}
          aria-label={
            collapsed ? `Expand ${label.toLowerCase()}` : `Collapse ${label.toLowerCase()}`
          }
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <Icons.chevronsRight className='size-4' />
          ) : (
            <Icons.chevronsLeft className='size-4' />
          )}
        </Button>
      </div>
      <div className={cn(collapsed && 'hidden')}>{children}</div>
    </aside>
  );
}
