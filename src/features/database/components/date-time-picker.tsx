'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useState } from 'react';

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/** Reads what the grid shows (ISO or `YYYY-MM-DD[ HH:mm:ss]`) as a UTC moment. */
function parseValue(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00Z`
    : /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)
      ? trimmed.replace(' ', 'T')
      : `${trimmed.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Calendar days are picked in UTC, matching how the grid prints timestamps. */
const utcDay = (date: Date) =>
  new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

export interface DateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Dates only (a `date` column) or a date and a time down to the second. */
  mode: 'date' | 'datetime';
  /** How a picked UTC moment is written back, e.g. ISO for Postgres. */
  format: (date: Date) => string;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  /** Opens straight away, e.g. when a cell enters edit mode. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** A calendar plus a seconds-precision time field, all in UTC. */
export function DateTimePicker({
  value,
  onChange,
  mode,
  format,
  placeholder = 'Pick a date',
  className,
  'aria-label': ariaLabel,
  defaultOpen,
  onOpenChange
}: DateTimePickerProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const current = parseValue(value);
  const time = current
    ? `${pad(current.getUTCHours())}:${pad(current.getUTCMinutes())}:${pad(current.getUTCSeconds())}`
    : '00:00:00';

  const emit = (day: Date, clock: string) => {
    const [hours = 0, minutes = 0, seconds = 0] = clock.split(':').map(Number);
    onChange(
      format(
        new Date(
          Date.UTC(
            day.getFullYear(),
            day.getMonth(),
            day.getDate(),
            hours,
            minutes,
            seconds,
            // The time field stops at seconds; keep the value's own milliseconds.
            current?.getUTCMilliseconds() ?? 0
          )
        )
      )
    );
  };

  const changeOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            size='sm'
            aria-label={ariaLabel}
            className={cn('justify-start font-mono text-xs font-normal', className)}
          />
        }
      >
        <Icons.calendar className='size-3.5' aria-hidden='true' />
        {value ? (
          <span className='truncate'>{value}</span>
        ) : (
          <span className='text-muted-foreground'>{placeholder}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align='start' className='w-auto p-0'>
        <Calendar
          mode='single'
          captionLayout='dropdown'
          selected={current ? utcDay(current) : undefined}
          defaultMonth={current ? utcDay(current) : undefined}
          onSelect={(day) => day && emit(day, time)}
        />
        <div className='flex items-center gap-2 border-t p-2'>
          {mode === 'datetime' && (
            <Input
              type='time'
              step={1}
              value={time}
              onChange={(event) =>
                emit(current ? utcDay(current) : utcDay(new Date()), event.target.value)
              }
              aria-label='Time (UTC)'
              className='h-8 w-36 font-mono text-xs'
            />
          )}
          <span className='text-muted-foreground text-xs'>UTC</span>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='ml-auto'
            onClick={() => {
              const now = new Date();
              emit(utcDay(now), mode === 'datetime' ? now.toISOString().slice(11, 19) : '00:00:00');
            }}
          >
            {mode === 'datetime' ? 'Now' : 'Today'}
          </Button>
          <Button type='button' size='sm' onClick={() => changeOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
