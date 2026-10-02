import { createHash } from 'node:crypto';
import { qualifiedName, type DatabaseSchema } from '@/lib/database/types';

/**
 * Stable across scan order so an unchanged database keeps producing the same
 * hash, which is what lets schema snapshots deduplicate instead of piling up.
 */
export function hashSchema(schema: DatabaseSchema): string {
  const canonical = schema.tables
    .map((table) => ({
      id: qualifiedName(table),
      columns: table.columns
        .map((column) =>
          [column.name, column.dataType, column.nullable, column.defaultValue].join('|')
        )
        .toSorted(),
      primaryKeys: table.primaryKeys.toSorted(),
      foreignKeys: table.foreignKeys
        .map((key) =>
          [
            key.columns.toSorted().join(','),
            key.referencedSchema,
            key.referencedTable,
            key.referencedColumns.toSorted().join(',')
          ].join('|')
        )
        .toSorted(),
      indexes: table.indexes
        .map((index) => [index.name, index.columns.toSorted().join(','), index.unique].join('|'))
        .toSorted()
    }))
    .toSorted((a, b) => a.id.localeCompare(b.id));

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
