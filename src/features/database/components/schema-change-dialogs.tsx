'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { ScrollArea } from '@/components/ui/scroll-area';
import { generatedName } from '@/features/database/schema-changes';
import { useAppForm } from '@/lib/form';
import {
  FOREIGN_KEY_ACTIONS,
  qualifiedName,
  type Column,
  type DatabaseProviderName,
  type ForeignKeyAction,
  type SchemaChange,
  type Table
} from '@/lib/database/types';
import { useState } from 'react';
import { z } from 'zod';

type Stage = (change: SchemaChange) => void;

function StageDialog({
  title,
  description,
  trigger,
  children
}: {
  title: string;
  description: string;
  trigger: React.ReactElement;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ScrollArea className='max-h-[65vh] pr-4'>
          {/* Mounted only while open, so the form always starts from current values. */}
          {open && children(() => setOpen(false))}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

const STAGED_NOTE = 'Staged until you press Execute — nothing runs yet.';

const columnFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(64),
  dataType: z
    .string()
    .trim()
    .min(1, 'Type is required')
    .max(100)
    .regex(/^[^;]+$/, 'Type cannot contain ";"'),
  nullable: z.boolean(),
  defaultValue: z.string().max(500)
});

/** Adds a column, or edits `column` when one is given. */
export function ColumnDialog({
  table,
  column,
  provider,
  onStage
}: {
  table: Table;
  column?: Column;
  provider: DatabaseProviderName;
  onStage: Stage;
}) {
  return (
    <StageDialog
      title={column ? `Edit column ${column.name}` : `Add column to ${table.name}`}
      description={STAGED_NOTE}
      trigger={
        column ? (
          <Button type='button' variant='ghost' size='icon-sm' aria-label={`Edit ${column.name}`}>
            <Icons.edit className='size-3.5' />
          </Button>
        ) : (
          <Button type='button' variant='outline' size='sm'>
            <Icons.add className='size-3.5' />
            Add column
          </Button>
        )
      }
    >
      {(close) => (
        <ColumnForm
          table={table}
          column={column}
          provider={provider}
          onStage={onStage}
          onDone={close}
        />
      )}
    </StageDialog>
  );
}

function ColumnForm({
  table,
  column,
  provider,
  onStage,
  onDone
}: {
  table: Table;
  column?: Column;
  provider: DatabaseProviderName;
  onStage: Stage;
  onDone: () => void;
}) {
  const form = useAppForm({
    defaultValues: {
      name: column?.name ?? '',
      dataType: column?.dataType ?? (provider === 'POSTGRES' ? 'text' : 'varchar(255)'),
      nullable: column?.nullable ?? true,
      defaultValue: column?.defaultValue ?? ''
    },
    validators: { onSubmit: columnFormSchema },
    onSubmit: ({ value }) => {
      const definition = {
        name: value.name.trim(),
        dataType: value.dataType.trim(),
        nullable: value.nullable,
        defaultValue: value.defaultValue.trim() || null
      };
      const target = { schema: table.schema, table: table.name };
      if (!column) {
        onStage({ kind: 'addColumn', ...target, ...definition });
      } else if (
        definition.name !== column.name ||
        definition.dataType !== column.dataType ||
        definition.nullable !== column.nullable ||
        definition.defaultValue !== column.defaultValue
      ) {
        onStage({ kind: 'alterColumn', ...target, column: column.name, ...definition });
      }
      onDone();
    }
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.AppField
          name='name'
          children={(field) => <field.TextField label='Name' required autoComplete='off' />}
        />
        <form.AppField
          name='dataType'
          children={(field) => (
            <field.TextField
              label='Type'
              required
              className='font-mono'
              description={
                provider === 'POSTGRES'
                  ? 'Any Postgres type, e.g. integer, varchar(255), timestamptz, jsonb.'
                  : 'Any MySQL type, e.g. int, varchar(255), datetime, json.'
              }
            />
          )}
        />
        <form.AppField
          name='nullable'
          children={(field) => (
            <field.SwitchField label='Nullable' description='Off adds NOT NULL.' />
          )}
        />
        <form.AppField
          name='defaultValue'
          children={(field) => (
            <field.TextField
              label='Default'
              className='font-mono'
              placeholder='No default'
              description={
                provider === 'POSTGRES'
                  ? "A SQL expression — quote text: 'draft', or now(), 0."
                  : "A SQL expression — quote text: 'draft', or CURRENT_TIMESTAMP, 0."
              }
            />
          )}
        />
        <form.AppForm>
          <form.SubmitButton className='w-full'>
            {column ? 'Stage changes' : 'Stage new column'}
          </form.SubmitButton>
        </form.AppForm>
      </FieldGroup>
    </form>
  );
}

const indexFormSchema = z.object({
  name: z.string().trim().max(64),
  columns: z.array(z.string()).min(1, 'Pick at least one column'),
  unique: z.boolean()
});

export function IndexDialog({
  table,
  columns,
  onStage
}: {
  table: Table;
  /** The table's columns as they will be, pending changes included. */
  columns: string[];
  onStage: Stage;
}) {
  return (
    <StageDialog
      title={`Add index to ${table.name}`}
      description={STAGED_NOTE}
      trigger={
        <Button type='button' variant='outline' size='sm'>
          <Icons.add className='size-3.5' />
          Add index
        </Button>
      }
    >
      {(close) => <IndexForm table={table} columns={columns} onStage={onStage} onDone={close} />}
    </StageDialog>
  );
}

function IndexForm({
  table,
  columns,
  onStage,
  onDone
}: {
  table: Table;
  columns: string[];
  onStage: Stage;
  onDone: () => void;
}) {
  const form = useAppForm({
    defaultValues: { name: '', columns: [] as string[], unique: false },
    validators: { onSubmit: indexFormSchema },
    onSubmit: ({ value }) => {
      onStage({
        kind: 'createIndex',
        schema: table.schema,
        table: table.name,
        name:
          value.name.trim() ||
          generatedName(table.name, value.columns, value.unique ? 'key' : 'idx'),
        columns: value.columns,
        unique: value.unique
      });
      onDone();
    }
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.AppField
          name='columns'
          mode='array'
          children={(field) => (
            <field.CheckboxGroupField
              label='Columns'
              required
              description='Indexed in the order you tick them.'
              className='grid grid-cols-2 gap-2'
              options={columns.map((name) => ({ value: name, label: name }))}
            />
          )}
        />
        <form.AppField
          name='unique'
          children={(field) => (
            <field.SwitchField label='Unique' description='Reject duplicate values.' />
          )}
        />
        <form.Subscribe selector={(state) => [state.values.columns, state.values.unique] as const}>
          {([selected, unique]) => (
            <form.AppField
              name='name'
              children={(field) => (
                <field.TextField
                  label='Name'
                  autoComplete='off'
                  placeholder={generatedName(
                    table.name,
                    selected.length ? selected : ['…'],
                    unique ? 'key' : 'idx'
                  )}
                  description='Leave blank to use the suggested name.'
                />
              )}
            />
          )}
        </form.Subscribe>
        <form.AppForm>
          <form.SubmitButton className='w-full'>Stage index</form.SubmitButton>
        </form.AppForm>
      </FieldGroup>
    </form>
  );
}

const foreignKeyFormSchema = z
  .object({
    name: z.string().trim().max(64),
    columns: z.array(z.string()).min(1, 'Pick at least one column'),
    referencedTable: z.string().min(1, 'Pick a table'),
    referencedColumns: z.array(z.string()).min(1, 'Pick at least one column'),
    onDelete: z.enum(FOREIGN_KEY_ACTIONS),
    onUpdate: z.enum(FOREIGN_KEY_ACTIONS)
  })
  .refine((value) => value.columns.length === value.referencedColumns.length, {
    message: 'Pick as many referenced columns as columns',
    path: ['referencedColumns']
  });

const ACTION_OPTIONS = FOREIGN_KEY_ACTIONS.map((action) => ({ value: action, label: action }));

export function ForeignKeyDialog({
  table,
  columns,
  tables,
  columnsOf,
  onStage
}: {
  table: Table;
  columns: string[];
  tables: Table[];
  /** Pending-aware column list for any table, for the referenced side. */
  columnsOf: (table: Table) => string[];
  onStage: Stage;
}) {
  return (
    <StageDialog
      title={`Add foreign key to ${table.name}`}
      description={STAGED_NOTE}
      trigger={
        <Button type='button' variant='outline' size='sm'>
          <Icons.add className='size-3.5' />
          Add foreign key
        </Button>
      }
    >
      {(close) => (
        <ForeignKeyForm
          table={table}
          columns={columns}
          tables={tables}
          columnsOf={columnsOf}
          onStage={onStage}
          onDone={close}
        />
      )}
    </StageDialog>
  );
}

function ForeignKeyForm({
  table,
  columns,
  tables,
  columnsOf,
  onStage,
  onDone
}: {
  table: Table;
  columns: string[];
  tables: Table[];
  columnsOf: (table: Table) => string[];
  onStage: Stage;
  onDone: () => void;
}) {
  const findTable = (name: string) => tables.find((entry) => qualifiedName(entry) === name);

  const form = useAppForm({
    defaultValues: {
      name: '',
      columns: [] as string[],
      referencedTable: '',
      referencedColumns: [] as string[],
      onDelete: 'NO ACTION' as ForeignKeyAction,
      onUpdate: 'NO ACTION' as ForeignKeyAction
    },
    validators: { onSubmit: foreignKeyFormSchema },
    onSubmit: ({ value }) => {
      const referenced = findTable(value.referencedTable);
      if (!referenced) return;
      onStage({
        kind: 'addForeignKey',
        schema: table.schema,
        table: table.name,
        name: value.name.trim() || generatedName(table.name, value.columns, 'fkey'),
        columns: value.columns,
        referencedSchema: referenced.schema,
        referencedTable: referenced.name,
        referencedColumns: value.referencedColumns,
        onDelete: value.onDelete,
        onUpdate: value.onUpdate
      });
      onDone();
    }
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.AppField
          name='columns'
          mode='array'
          children={(field) => (
            <field.CheckboxGroupField
              label={`Columns on ${table.name}`}
              required
              description='Paired with the referenced columns in the order you tick them.'
              className='grid grid-cols-2 gap-2'
              options={columns.map((name) => ({ value: name, label: name }))}
            />
          )}
        />
        <form.AppField
          name='referencedTable'
          listeners={{
            // Most foreign keys point at the primary key, so start there.
            onChange: ({ value }) => {
              const referenced = findTable(value);
              form.setFieldValue(
                'referencedColumns',
                referenced ? [...referenced.primaryKeys] : []
              );
            }
          }}
          children={(field) => (
            <field.SelectField
              label='References table'
              required
              placeholder='Pick a table'
              options={tables.map((entry) => ({
                value: qualifiedName(entry),
                label: qualifiedName(entry)
              }))}
            />
          )}
        />
        <form.Subscribe selector={(state) => state.values.referencedTable}>
          {(referencedName) => {
            const referenced = findTable(referencedName);
            return referenced ? (
              <form.AppField
                name='referencedColumns'
                mode='array'
                children={(field) => (
                  <field.CheckboxGroupField
                    label={`Columns on ${referenced.name}`}
                    required
                    className='grid grid-cols-2 gap-2'
                    options={columnsOf(referenced).map((name) => ({ value: name, label: name }))}
                  />
                )}
              />
            ) : null;
          }}
        </form.Subscribe>
        <div className='grid gap-4 sm:grid-cols-2'>
          <form.AppField
            name='onDelete'
            children={(field) => <field.SelectField label='On delete' options={ACTION_OPTIONS} />}
          />
          <form.AppField
            name='onUpdate'
            children={(field) => <field.SelectField label='On update' options={ACTION_OPTIONS} />}
          />
        </div>
        <form.Subscribe selector={(state) => state.values.columns}>
          {(selected) => (
            <form.AppField
              name='name'
              children={(field) => (
                <field.TextField
                  label='Name'
                  autoComplete='off'
                  placeholder={generatedName(
                    table.name,
                    selected.length ? selected : ['…'],
                    'fkey'
                  )}
                  description='Leave blank to use the suggested name.'
                />
              )}
            />
          )}
        </form.Subscribe>
        <form.AppForm>
          <form.SubmitButton className='w-full'>Stage foreign key</form.SubmitButton>
        </form.AppForm>
      </FieldGroup>
    </form>
  );
}
