import type { Column, ForeignKey, Index, SchemaChange, Table } from '@/lib/database/types';

/** A staged change, not yet run against the database. */
export interface PendingChange {
  id: string;
  change: SchemaChange;
}

export type PendingStatus = 'added' | 'altered' | 'dropped';

/** A table as it will look once its pending changes run. */
export interface EffectiveTable {
  columns: (Column & { status?: PendingStatus })[];
  indexes: (Index & { status?: PendingStatus })[];
  foreignKeys: (ForeignKey & { status?: PendingStatus })[];
}

const onTable = (change: SchemaChange, table: Pick<Table, 'schema' | 'name'>) =>
  change.schema === table.schema && change.table === table.name;

export function effectiveTable(table: Table, pending: PendingChange[]): EffectiveTable {
  const result: EffectiveTable = {
    columns: table.columns.map((column) => ({ ...column })),
    indexes: table.indexes.map((index) => ({ ...index })),
    foreignKeys: table.foreignKeys.map((key) => ({ ...key }))
  };

  for (const { change } of pending) {
    if (!onTable(change, table)) continue;
    switch (change.kind) {
      case 'addColumn':
        result.columns.push({
          name: change.name,
          dataType: change.dataType,
          nullable: change.nullable,
          defaultValue: change.defaultValue,
          isPrimaryKey: false,
          status: 'added'
        });
        break;
      case 'alterColumn': {
        const column = result.columns.find((entry) => entry.name === change.column);
        if (!column) break;
        Object.assign(column, {
          name: change.name,
          dataType: change.dataType,
          nullable: change.nullable,
          defaultValue: change.defaultValue,
          status: column.status ?? 'altered'
        });
        break;
      }
      case 'dropColumn': {
        const column = result.columns.find((entry) => entry.name === change.column);
        if (column) column.status = 'dropped';
        break;
      }
      case 'createIndex':
        result.indexes.push({
          name: change.name,
          columns: change.columns,
          unique: change.unique,
          status: 'added'
        });
        break;
      case 'dropIndex': {
        const index = result.indexes.find((entry) => entry.name === change.name);
        if (index) index.status = 'dropped';
        break;
      }
      case 'addForeignKey':
        result.foreignKeys.push({
          name: change.name,
          columns: change.columns,
          referencedSchema: change.referencedSchema,
          referencedTable: change.referencedTable,
          referencedColumns: change.referencedColumns,
          status: 'added'
        });
        break;
      case 'dropForeignKey': {
        const key = result.foreignKeys.find((entry) => entry.name === change.name);
        if (key) key.status = 'dropped';
        break;
      }
    }
  }

  return result;
}

/**
 * Adds a change to the queue, folding it into an earlier one where that is
 * what the user meant: editing a column that is itself still pending updates
 * that entry, and dropping something that was only staged just un-stages it.
 */
export function stageChange(pending: PendingChange[], change: SchemaChange): PendingChange[] {
  const find = (match: (entry: SchemaChange) => boolean) =>
    pending.findIndex(
      ({ change: entry }) =>
        entry.schema === change.schema && entry.table === change.table && match(entry)
    );
  const without = (index: number) => pending.filter((_, position) => position !== index);
  const replace = (index: number, next: SchemaChange) =>
    pending.map((entry, position) => (position === index ? { ...entry, change: next } : entry));
  const append = (next: SchemaChange) => [...pending, { id: crypto.randomUUID(), change: next }];

  switch (change.kind) {
    case 'alterColumn': {
      const added = find((entry) => entry.kind === 'addColumn' && entry.name === change.column);
      if (added >= 0) {
        const { column: _column, ...definition } = change;
        return replace(added, { ...definition, kind: 'addColumn' });
      }
      const altered = find((entry) => entry.kind === 'alterColumn' && entry.name === change.column);
      if (altered >= 0) {
        const original = pending[altered].change as Extract<SchemaChange, { kind: 'alterColumn' }>;
        return replace(altered, { ...change, column: original.column });
      }
      return append(change);
    }
    case 'dropColumn': {
      const added = find((entry) => entry.kind === 'addColumn' && entry.name === change.column);
      if (added >= 0) return without(added);
      const altered = find((entry) => entry.kind === 'alterColumn' && entry.name === change.column);
      if (altered >= 0) {
        const original = pending[altered].change as Extract<SchemaChange, { kind: 'alterColumn' }>;
        return [
          ...without(altered),
          { id: crypto.randomUUID(), change: { ...change, column: original.column } }
        ];
      }
      return append(change);
    }
    case 'dropIndex': {
      const created = find((entry) => entry.kind === 'createIndex' && entry.name === change.name);
      return created >= 0 ? without(created) : append(change);
    }
    case 'dropForeignKey': {
      const added = find((entry) => entry.kind === 'addForeignKey' && entry.name === change.name);
      return added >= 0 ? without(added) : append(change);
    }
    default:
      return append(change);
  }
}

export function describeChange(change: SchemaChange): string {
  const table = `${change.schema}.${change.table}`;
  switch (change.kind) {
    case 'addColumn':
      return `Add column ${table}.${change.name} ${change.dataType}`;
    case 'alterColumn':
      return change.name === change.column
        ? `Edit column ${table}.${change.column}`
        : `Edit column ${table}.${change.column} → ${change.name}`;
    case 'dropColumn':
      return `Drop column ${table}.${change.column}`;
    case 'createIndex':
      return `Add ${change.unique ? 'unique ' : ''}index ${change.name} on ${table} (${change.columns.join(', ')})`;
    case 'dropIndex':
      return `Drop index ${change.name} on ${table}`;
    case 'addForeignKey':
      return `Add foreign key ${table} (${change.columns.join(', ')}) → ${change.referencedSchema}.${change.referencedTable} (${change.referencedColumns.join(', ')})`;
    case 'dropForeignKey':
      return `Drop foreign key ${change.name} on ${table}`;
  }
}

/** Postgres caps identifiers at 63 bytes, MySQL at 64; 63 fits both. */
export function generatedName(table: string, columns: string[], suffix: string): string {
  return `${table}_${columns.join('_')}_${suffix}`.slice(0, 63);
}
