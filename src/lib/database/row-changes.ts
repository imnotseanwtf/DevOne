import type { DatabaseProviderName, RowValues } from '@/lib/database/types';

/** One staged edit to a table's rows; `where` is the row's primary key. */
export type RowChange =
  | { kind: 'insert'; values: RowValues }
  | { kind: 'update'; values: RowValues; where: RowValues }
  | { kind: 'delete'; where: RowValues };

export interface RowStatement {
  sql: string;
  params: unknown[];
}

function quoteIdent(name: string, provider: DatabaseProviderName): string {
  return provider === 'MYSQL'
    ? `\`${name.replaceAll('`', '``')}\``
    : `"${name.replaceAll('"', '""')}"`;
}

/** Builds one change's SQL; `value` decides how each value appears in it. */
function composeRowSql(
  provider: DatabaseProviderName,
  schema: string,
  table: string,
  change: RowChange,
  value: (value: unknown) => string
): string {
  const ident = (name: string) => quoteIdent(name, provider);
  const target = `${ident(schema)}.${ident(table)}`;
  const pairs = (values: RowValues, separator: string) =>
    Object.entries(values)
      .map(([column, entry]) => `${ident(column)} = ${value(entry)}`)
      .join(separator);

  switch (change.kind) {
    case 'insert': {
      const columns = Object.keys(change.values);
      if (columns.length === 0) {
        return provider === 'MYSQL'
          ? `INSERT INTO ${target} () VALUES ()`
          : `INSERT INTO ${target} DEFAULT VALUES`;
      }
      const values = columns.map((column) => value(change.values[column]));
      return `INSERT INTO ${target} (${columns.map(ident).join(', ')}) VALUES (${values.join(', ')})`;
    }
    case 'update':
      return `UPDATE ${target} SET ${pairs(change.values, ', ')} WHERE ${pairs(change.where, ' AND ')}`;
    case 'delete':
      return `DELETE FROM ${target} WHERE ${pairs(change.where, ' AND ')}`;
  }
}

/**
 * The parameterized statement for one change: `$1…` for Postgres, `?` for MySQL.
 * The adapters run this; the preview renders the same statement with literals.
 */
export function buildRowStatement(
  provider: DatabaseProviderName,
  schema: string,
  table: string,
  change: RowChange
): RowStatement {
  const params: unknown[] = [];
  const sql = composeRowSql(provider, schema, table, change, (value) => {
    params.push(value);
    return provider === 'MYSQL' ? '?' : `$${params.length}`;
  });
  return { sql, params };
}

/** A value written as a SQL literal, for showing a statement to a person. */
export function sqlLiteral(value: unknown, provider: DatabaseProviderName): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  const escaped =
    provider === 'MYSQL'
      ? text.replaceAll('\\', '\\\\').replaceAll("'", "''")
      : text.replaceAll("'", "''");
  return `'${escaped}'`;
}

/** The statement a change will run, with its values inlined, ending in `;`. */
export function renderRowStatement(
  provider: DatabaseProviderName,
  schema: string,
  table: string,
  change: RowChange
): string {
  return `${composeRowSql(provider, schema, table, change, (value) => sqlLiteral(value, provider))};`;
}
