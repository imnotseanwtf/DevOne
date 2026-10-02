import { qualifiedName, type Column, type DatabaseSchema, type Table } from '@/lib/database/types';

export interface ColumnChange {
  name: string;
  before: Column;
  after: Column;
}

export interface TableDiff {
  table: string;
  addedColumns: Column[];
  removedColumns: Column[];
  changedColumns: ColumnChange[];
  addedForeignKeys: string[];
  removedForeignKeys: string[];
  addedIndexes: string[];
  removedIndexes: string[];
}

export interface SchemaDiff {
  addedTables: Table[];
  removedTables: Table[];
  changedTables: TableDiff[];
}

export function isEmptyDiff(diff: SchemaDiff): boolean {
  return (
    diff.addedTables.length === 0 &&
    diff.removedTables.length === 0 &&
    diff.changedTables.length === 0
  );
}

function byName<T>(items: T[], key: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [key(item), item]));
}

function columnChanged(before: Column, after: Column): boolean {
  return (
    before.dataType !== after.dataType ||
    before.nullable !== after.nullable ||
    before.defaultValue !== after.defaultValue ||
    before.isPrimaryKey !== after.isPrimaryKey
  );
}

/** Describes what changed going from `before` to `after`. Order-independent. */
export function diffSchemas(before: DatabaseSchema, after: DatabaseSchema): SchemaDiff {
  const beforeTables = byName(before.tables, qualifiedName);
  const afterTables = byName(after.tables, qualifiedName);

  const addedTables = after.tables.filter((table) => !beforeTables.has(qualifiedName(table)));
  const removedTables = before.tables.filter((table) => !afterTables.has(qualifiedName(table)));
  const changedTables: TableDiff[] = [];

  for (const [name, afterTable] of afterTables) {
    const beforeTable = beforeTables.get(name);
    if (!beforeTable) continue;

    const beforeColumns = byName(beforeTable.columns, (column) => column.name);
    const afterColumns = byName(afterTable.columns, (column) => column.name);

    const addedColumns = afterTable.columns.filter((column) => !beforeColumns.has(column.name));
    const removedColumns = beforeTable.columns.filter((column) => !afterColumns.has(column.name));
    const changedColumns: ColumnChange[] = [];

    for (const [columnName, afterColumn] of afterColumns) {
      const beforeColumn = beforeColumns.get(columnName);
      if (beforeColumn && columnChanged(beforeColumn, afterColumn)) {
        changedColumns.push({ name: columnName, before: beforeColumn, after: afterColumn });
      }
    }

    const beforeKeys = new Set(beforeTable.foreignKeys.map((key) => key.name));
    const afterKeys = new Set(afterTable.foreignKeys.map((key) => key.name));
    const addedForeignKeys = [...afterKeys].filter((key) => !beforeKeys.has(key));
    const removedForeignKeys = [...beforeKeys].filter((key) => !afterKeys.has(key));

    const beforeIndexes = new Set(beforeTable.indexes.map((index) => index.name));
    const afterIndexes = new Set(afterTable.indexes.map((index) => index.name));
    const addedIndexes = [...afterIndexes].filter((index) => !beforeIndexes.has(index));
    const removedIndexes = [...beforeIndexes].filter((index) => !afterIndexes.has(index));

    if (
      addedColumns.length ||
      removedColumns.length ||
      changedColumns.length ||
      addedForeignKeys.length ||
      removedForeignKeys.length ||
      addedIndexes.length ||
      removedIndexes.length
    ) {
      changedTables.push({
        table: name,
        addedColumns,
        removedColumns,
        changedColumns,
        addedForeignKeys,
        removedForeignKeys,
        addedIndexes,
        removedIndexes
      });
    }
  }

  return {
    addedTables,
    removedTables,
    changedTables: changedTables.toSorted((a, b) => a.table.localeCompare(b.table))
  };
}

/** One line per change, in the shape the spec's schema-diff panel shows. */
export function summarizeDiff(diff: SchemaDiff): string[] {
  const lines: string[] = [];

  for (const table of diff.addedTables) lines.push(`+ ${qualifiedName(table)} table`);
  for (const table of diff.removedTables) lines.push(`- ${qualifiedName(table)} table`);

  for (const change of diff.changedTables) {
    for (const column of change.addedColumns) lines.push(`+ ${change.table}.${column.name}`);
    for (const column of change.removedColumns) lines.push(`- ${change.table}.${column.name}`);
    for (const column of change.changedColumns) {
      lines.push(
        `~ ${change.table}.${column.name} (${column.before.dataType} → ${column.after.dataType})`
      );
    }
    for (const key of change.addedForeignKeys) lines.push(`+ FK ${change.table}.${key}`);
    for (const key of change.removedForeignKeys) lines.push(`- FK ${change.table}.${key}`);
    for (const index of change.addedIndexes) lines.push(`+ INDEX ${change.table}.${index}`);
    for (const index of change.removedIndexes) lines.push(`- INDEX ${change.table}.${index}`);
  }

  return lines;
}
