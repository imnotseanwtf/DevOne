import type {
  Column,
  DatabaseProviderName,
  DatabaseSchema,
  SchemaChange
} from '@/lib/database/types';

function columnClauses(column: { nullable: boolean; defaultValue: string | null }): string {
  return `${column.nullable ? '' : ' NOT NULL'}${column.defaultValue ? ` DEFAULT ${column.defaultValue}` : ''}`;
}

/**
 * Turns staged schema changes into DDL, one group of statements per change.
 * `live` is the schema as it is right now; Postgres diffs column edits
 * against it, and MySQL reads the column attributes a redefinition must keep.
 *
 * `dataType` and `defaultValue` are raw SQL fragments on purpose: they are
 * only ever run on a writable connection, whose user can already run any SQL.
 */
export function buildSchemaStatements(
  provider: DatabaseProviderName,
  changes: SchemaChange[],
  live: DatabaseSchema
): string[][] {
  const quote =
    provider === 'POSTGRES'
      ? (name: string) => `"${name.replace(/"/g, '""')}"`
      : (name: string) => `\`${name.replace(/`/g, '``')}\``;
  const list = (names: string[]) => names.map(quote).join(', ');

  const liveColumn = (change: SchemaChange, name: string): Column => {
    const table = live.tables.find(
      (entry) => entry.schema === change.schema && entry.name === change.table
    );
    const column = table?.columns.find((entry) => entry.name === name);
    if (!column) {
      throw new Error(`Column ${change.schema}.${change.table}.${name} no longer exists`);
    }
    return column;
  };

  return changes.map((change) => {
    const table = `${quote(change.schema)}.${quote(change.table)}`;

    switch (change.kind) {
      case 'addColumn':
        return [
          `ALTER TABLE ${table} ADD COLUMN ${quote(change.name)} ${change.dataType}${columnClauses(change)}`
        ];

      case 'alterColumn': {
        const current = liveColumn(change, change.column);
        const defaultValue = change.defaultValue || null;

        if (provider === 'MYSQL') {
          if (current.extra?.includes('GENERATED')) {
            throw new Error(`Generated column ${change.column} can't be edited here`);
          }
          // MySQL redefines the whole column, so carry over what the form doesn't show.
          const extra = current.extra ? ` ${current.extra}` : '';
          const nullClause = change.nullable ? ' NULL' : ' NOT NULL';
          const defaultClause = defaultValue ? ` DEFAULT ${defaultValue}` : '';
          return [
            `ALTER TABLE ${table} CHANGE COLUMN ${quote(change.column)} ${quote(change.name)} ${change.dataType}${nullClause}${defaultClause}${extra}`
          ];
        }

        const column = quote(change.column);
        const statements: string[] = [];
        if (change.dataType !== current.dataType) {
          statements.push(
            `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${change.dataType} USING ${column}::${change.dataType}`
          );
        }
        if (change.nullable !== current.nullable) {
          statements.push(
            `ALTER TABLE ${table} ALTER COLUMN ${column} ${change.nullable ? 'DROP' : 'SET'} NOT NULL`
          );
        }
        if (defaultValue !== current.defaultValue) {
          statements.push(
            defaultValue
              ? `ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${defaultValue}`
              : `ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT`
          );
        }
        // Renamed last, so the statements above can keep using the current name.
        if (change.name !== change.column) {
          statements.push(`ALTER TABLE ${table} RENAME COLUMN ${column} TO ${quote(change.name)}`);
        }
        return statements;
      }

      case 'dropColumn':
        return [`ALTER TABLE ${table} DROP COLUMN ${quote(change.column)}`];

      case 'createIndex':
        return [
          `CREATE ${change.unique ? 'UNIQUE ' : ''}INDEX ${quote(change.name)} ON ${table} (${list(change.columns)})`
        ];

      case 'dropIndex':
        return [
          provider === 'POSTGRES'
            ? `DROP INDEX ${quote(change.schema)}.${quote(change.name)}`
            : `DROP INDEX ${quote(change.name)} ON ${table}`
        ];

      case 'addForeignKey':
        return [
          `ALTER TABLE ${table} ADD CONSTRAINT ${quote(change.name)} FOREIGN KEY (${list(change.columns)}) REFERENCES ${quote(change.referencedSchema)}.${quote(change.referencedTable)} (${list(change.referencedColumns)}) ON DELETE ${change.onDelete} ON UPDATE ${change.onUpdate}`
        ];

      case 'dropForeignKey':
        return [
          provider === 'POSTGRES'
            ? `ALTER TABLE ${table} DROP CONSTRAINT ${quote(change.name)}`
            : `ALTER TABLE ${table} DROP FOREIGN KEY ${quote(change.name)}`
        ];
    }
  });
}
