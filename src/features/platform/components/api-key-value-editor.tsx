'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { KeyValueRow } from '@/lib/api-client/types';
import { cn } from '@/lib/utils';

export type EditorRow = KeyValueRow;

/** What the docs say about a row's key, shown under it. */
export interface RowHint {
  type?: string;
  required?: boolean;
  description?: string;
}

interface ApiKeyValueEditorProps {
  rows: EditorRow[];
  onChange: (rows: EditorRow[]) => void;
  label: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Adds a checkbox per row; unchecked rows are kept but not sent. */
  toggleable?: boolean;
  hints?: Record<string, RowHint>;
}

/**
 * Key/value grid with a trailing blank row, the Scalar and Postman way:
 * typing into the blank row adds it, so there is no separate "Add" button.
 */
export function ApiKeyValueEditor({
  rows,
  onChange,
  label,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  toggleable = false,
  hints = {}
}: ApiKeyValueEditorProps) {
  const display = [...rows, { key: '', value: '' }];
  const columns = toggleable ? 'grid-cols-[2rem_1fr_1fr_2rem]' : 'grid-cols-[1fr_1fr_2rem]';

  const update = (index: number, patch: Partial<EditorRow>) => {
    const next = display.map((row, position) => (position === index ? { ...row, ...patch } : row));
    // Drop the trailing blank row again; it's re-added on render.
    const last = next.at(-1);
    onChange(last && !last.key && !last.value ? next.slice(0, -1) : next);
  };

  return (
    <div className='divide-border overflow-hidden rounded-md border text-sm'>
      <div className={cn('bg-muted/50 text-muted-foreground grid border-b text-xs', columns)}>
        {toggleable && <span />}
        <span className='px-3 py-1.5'>{keyPlaceholder}</span>
        <span className='border-l px-3 py-1.5'>{valuePlaceholder}</span>
        <span />
      </div>
      {display.map((row, index) => {
        const isBlank = index === rows.length;
        const enabled = row.enabled !== false;
        const hint = hints[row.key];
        return (
          <div key={index} className='border-b last:border-b-0'>
            <div className={cn('grid', columns, !enabled && 'text-muted-foreground')}>
              {toggleable &&
                (isBlank ? (
                  <span />
                ) : (
                  <span className='flex items-center justify-center'>
                    <Checkbox
                      aria-label={`Send ${row.key || `row ${index + 1}`}`}
                      checked={enabled}
                      onCheckedChange={(checked) => update(index, { enabled: checked === true })}
                    />
                  </span>
                ))}
              <Input
                aria-label={`${label} ${index + 1} key`}
                placeholder={isBlank ? keyPlaceholder : undefined}
                value={row.key}
                onChange={(event) => update(index, { key: event.target.value })}
                className='h-8 rounded-none border-0 font-mono text-xs shadow-none focus-visible:ring-1'
              />
              <Input
                aria-label={`${label} ${index + 1} value`}
                placeholder={isBlank ? valuePlaceholder : hint?.type}
                value={row.value}
                // Typing a value into an unchecked row means "send this".
                onChange={(event) =>
                  update(index, {
                    value: event.target.value,
                    ...(toggleable && !enabled && event.target.value ? { enabled: true } : {})
                  })
                }
                className='h-8 rounded-none border-0 border-l font-mono text-xs shadow-none focus-visible:ring-1'
              />
              {isBlank ? (
                <span />
              ) : (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='text-muted-foreground size-8 rounded-none'
                  aria-label={`Remove ${label.toLowerCase()} ${row.key || index + 1}`}
                  onClick={() => onChange(rows.filter((_, position) => position !== index))}
                >
                  <Icons.close className='size-3.5' />
                </Button>
              )}
            </div>
            {hint && (hint.description || hint.required) && (
              <p
                className={cn(
                  'text-muted-foreground -mt-0.5 pb-1.5 text-[11px]',
                  toggleable ? 'pl-11' : 'pl-3'
                )}
              >
                {hint.required && (
                  <span className='mr-1.5 font-medium text-red-600 dark:text-red-400'>
                    required
                  </span>
                )}
                {hint.description}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
