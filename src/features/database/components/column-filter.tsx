'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DateTimePicker } from '@/features/database/components/date-time-picker';
import {
  OPERATOR_LABEL,
  valueKindOf,
  type ColumnFilter,
  type FilterOperator
} from '@/lib/database/column-filters';
import type { Column } from '@/lib/database/types';
import { cn } from '@/lib/utils';
import { useState } from 'react';

const isNumeric = (dataType: string) =>
  /int|numeric|decimal|real|double|float|serial|money/i.test(dataType);

function operatorsFor(column: Column): FilterOperator[] {
  const kind = valueKindOf(column.dataType);
  const nullable: FilterOperator[] = column.nullable ? ['isNull', 'isNotNull'] : [];
  if (kind === 'boolean') return ['eq', ...nullable];
  if (kind === 'datetime' || kind === 'date' || isNumeric(column.dataType)) {
    return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', ...nullable];
  }
  return ['contains', 'eq', 'neq', ...nullable];
}

/** A chip label: `created_at ≥ 2026-09-23T00:00:00.000Z`. */
export function describeFilter(filter: ColumnFilter): string {
  const label = OPERATOR_LABEL[filter.operator];
  if (filter.operator === 'isNull' || filter.operator === 'isNotNull') {
    return `${filter.column} ${label}`;
  }
  if (filter.operator === 'between') {
    return `${filter.column} between ${filter.value} and ${filter.valueTo}`;
  }
  return `${filter.column} ${label} ${filter.value}`;
}

export function ColumnFilterButton({
  column,
  filter,
  format,
  onApply
}: {
  column: Column;
  filter: ColumnFilter | undefined;
  /** Writes a picked date the way this database expects it. */
  format: (date: Date, kind: 'date' | 'datetime') => string;
  onApply: (filter: ColumnFilter | null) => void;
}) {
  const operators = operatorsFor(column);
  const kind = valueKindOf(column.dataType);
  const [open, setOpen] = useState(false);
  const [operator, setOperator] = useState<FilterOperator>(filter?.operator ?? operators[0]);
  const [value, setValue] = useState(filter?.value ?? (kind === 'boolean' ? 'true' : ''));
  const [valueTo, setValueTo] = useState(filter?.valueTo ?? '');

  const needsValue = operator !== 'isNull' && operator !== 'isNotNull';
  const ready = !needsValue || (value !== '' && (operator !== 'between' || valueTo !== ''));

  const valueInput = (current: string, change: (next: string) => void, label: string) =>
    kind === 'datetime' || kind === 'date' ? (
      <DateTimePicker
        value={current}
        onChange={change}
        mode={kind}
        format={(date) => format(date, kind)}
        aria-label={label}
        className='w-full'
      />
    ) : kind === 'boolean' ? (
      <NativeSelect
        value={current}
        onChange={(event) => change(event.target.value)}
        aria-label={label}
        className='w-full'
      >
        <option value='true'>true</option>
        <option value='false'>false</option>
      </NativeSelect>
    ) : (
      <Input
        value={current}
        onChange={(event) => change(event.target.value)}
        placeholder='Value'
        aria-label={label}
        className='h-8 font-mono text-xs'
        onKeyDown={(event) => {
          if (event.key === 'Enter' && ready) apply();
        }}
      />
    );

  function apply() {
    onApply({
      column: column.name,
      operator,
      value: needsValue ? value : undefined,
      valueTo: operator === 'between' ? valueTo : undefined
    });
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setOperator(filter?.operator ?? operators[0]);
          setValue(filter?.value ?? (kind === 'boolean' ? 'true' : ''));
          setValueTo(filter?.valueTo ?? '');
        }
      }}
    >
      <PopoverTrigger
        render={
          <button
            type='button'
            aria-label={`Filter ${column.name}`}
            title={filter ? describeFilter(filter) : `Filter ${column.name}`}
            className={cn(
              'hover:bg-background grid size-6 place-items-center rounded',
              filter ? 'text-primary' : 'text-muted-foreground opacity-60 hover:opacity-100'
            )}
          />
        }
      >
        <Icons.filter className={cn('size-3.5', filter && 'fill-current')} />
      </PopoverTrigger>
      <PopoverContent align='start' className='w-72 space-y-2 p-3'>
        <p className='font-mono text-xs font-medium'>
          {column.name} <span className='text-muted-foreground'>{column.dataType}</span>
        </p>
        <NativeSelect
          value={operator}
          onChange={(event) => setOperator(event.target.value as FilterOperator)}
          aria-label='Condition'
          className='w-full'
        >
          {operators.map((entry) => (
            <option key={entry} value={entry}>
              {OPERATOR_LABEL[entry]}
            </option>
          ))}
        </NativeSelect>
        {needsValue && valueInput(value, setValue, operator === 'between' ? 'From' : 'Value')}
        {operator === 'between' && valueInput(valueTo, setValueTo, 'To')}
        <div className='flex justify-end gap-2 pt-1'>
          {filter && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => {
                onApply(null);
                setOpen(false);
              }}
            >
              Clear
            </Button>
          )}
          <Button type='button' size='sm' disabled={!ready} onClick={apply}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
