import type { SchemaDiff } from '@/lib/database/diff';
import { qualifiedName, type Column, type Table } from '@/lib/database/types';
import type { DatabaseProviderName } from '@/lib/database/types';

/**
 * Quotes an identifier for the target dialect. The embedded quote character is
 * doubled/escaped so a table named `we"ird` cannot terminate the quoting.
 */
export function quoteIdentifier(name: string, provider: DatabaseProviderName): string {
  return provider === 'MYSQL'
    ? `\`${name.replaceAll('`', '``')}\``
    : `"${name.replaceAll('"', '""')}"`;
}

function qualify(name: string, provider: DatabaseProviderName): string {
  return name
    .split('.')
    .map((part) => quoteIdentifier(part, provider))
    .join('.');
}

function columnDefinition(column: Column, provider: DatabaseProviderName): string {
  const parts = [quoteIdentifier(column.name, provider), column.dataType];
  if (!column.nullable) parts.push('NOT NULL');
  if (column.defaultValue !== null) parts.push(`DEFAULT ${column.defaultValue}`);
  return parts.join(' ');
}

function createTable(table: Table, provider: DatabaseProviderName): string {
  const columns = table.columns.map((column) => `  ${columnDefinition(column, provider)}`);
  if (table.primaryKeys.length > 0) {
    const keys = table.primaryKeys.map((key) => quoteIdentifier(key, provider)).join(', ');
    columns.push(`  PRIMARY KEY (${keys})`);
  }
  return `CREATE TABLE ${qualify(qualifiedName(table), provider)} (\n${columns.join(',\n')}\n);`;
}

/**
 * Renders a diff as SQL for review. Destructive statements are emitted as
 * comments: DevOne proposes migrations, it does not decide to drop your data.
 */
export function generateMigrationSql(diff: SchemaDiff, provider: DatabaseProviderName): string {
  const statements: string[] = [];

  for (const table of diff.addedTables) statements.push(createTable(table, provider));

  for (const change of diff.changedTables) {
    const table = qualify(change.table, provider);

    for (const column of change.addedColumns) {
      statements.push(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition(column, provider)};`);
    }

    for (const column of change.changedColumns) {
      const name = quoteIdentifier(column.name, provider);
      if (column.before.dataType !== column.after.dataType) {
        statements.push(
          provider === 'MYSQL'
            ? `ALTER TABLE ${table} MODIFY COLUMN ${columnDefinition(column.after, provider)};`
            : `ALTER TABLE ${table} ALTER COLUMN ${name} TYPE ${column.after.dataType};`
        );
      }
      if (column.before.nullable !== column.after.nullable && provider !== 'MYSQL') {
        statements.push(
          `ALTER TABLE ${table} ALTER COLUMN ${name} ${
            column.after.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'
          };`
        );
      }
    }

    for (const column of change.removedColumns) {
      statements.push(
        `-- DROP COLUMN is destructive; uncomment after review:\n-- ALTER TABLE ${table} DROP COLUMN ${quoteIdentifier(column.name, provider)};`
      );
    }
  }

  for (const table of diff.removedTables) {
    statements.push(
      `-- DROP TABLE is destructive; uncomment after review:\n-- DROP TABLE ${qualify(qualifiedName(table), provider)};`
    );
  }

  return statements.length === 0 ? '-- No schema changes.' : statements.join('\n\n');
}

/** Paths that look like database migrations across the common frameworks. */
const MIGRATION_PATTERNS = [
  /(^|\/)migrations?\//i,
  /(^|\/)db\/migrate\//i,
  /(^|\/)prisma\/migrations\//i,
  /\.sql$/i,
  /(^|\/)alembic\/versions\//i
];

export function looksLikeMigration(path: string): boolean {
  return MIGRATION_PATTERNS.some((pattern) => pattern.test(path));
}

/** Filters a changed-file list down to the migrations, for the PR summary. */
export function detectMigrations(paths: string[]): string[] {
  return paths.filter((path) => looksLikeMigration(path));
}
