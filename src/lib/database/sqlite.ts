import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { columnFilterConditions } from '@/lib/database/column-filters';
import { dialectOf } from '@/lib/database/dialect';
import { finalize } from '@/lib/database/postgres';
import { buildRowStatement } from '@/lib/database/row-changes';
import { openSqlite, type SqliteDb } from '@/lib/database/sqlite-driver';
import {
  MAX_RESULT_ROWS,
  StatementFailedError,
  likePattern,
  type ConnectionConfig,
  type DatabaseAdapter,
  type QueryResult,
  type RowPage,
  type Table
} from '@/lib/database/types';

const SCHEMA = 'main';
const dialect = dialectOf('SQLITE');
const quoteIdent = dialect.quote;

/**
 * A SQLite "connection" is a file on the machine DevOne runs on, so the path is
 * the only thing standing between a project member and every database file on
 * that host. It must be absolute and point at an existing file (no file is ever
 * created), and when `DEVONE_SQLITE_DIR` is set it must sit inside that folder.
 */
export function resolveSqlitePath(input: string): string {
  const resolved = path.resolve(input);
  if (!path.isAbsolute(input)) throw new Error('Use an absolute path to the SQLite file');

  const root = process.env.DEVONE_SQLITE_DIR;
  if (root) {
    const relative = path.relative(path.resolve(root), resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`The file must be inside ${root}`);
    }
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error('No SQLite file at that path');
  }
  return resolved;
}

/** Blobs can't cross to the browser as-is; show them as hex like other tools do. */
function plain(value: unknown): unknown {
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString('hex')}`;
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function createSqliteAdapter(config: ConnectionConfig): DatabaseAdapter {
  let db: SqliteDb | undefined;
  /** Opens the file on first use; every method starts here, then works on `current()`. */
  const open = async () => {
    db ??= await openSqlite(resolveSqlitePath(config.host));
  };
  const current = (): SqliteDb => {
    if (!db) throw new Error('The SQLite file is not open');
    return db;
  };

  /** Rows as arrays plus column names, whatever kind of statement this is. */
  const run = (sql: string, params: unknown[] = []) => {
    const statement = current().prepare(sql);
    if (statement.columns.length === 0) {
      statement.run(params);
      return { columns: [] as string[], rows: [] as unknown[][] };
    }
    return {
      columns: statement.columns,
      rows: statement.values(params).map((row) => row.map(plain))
    };
  };

  /** Rows as objects keyed by column name, for the schema queries. */
  const query = <T>(sql: string, params: unknown[] = []): T[] => {
    const { columns, rows } = run(sql, params);
    return rows.map(
      (row) => Object.fromEntries(columns.map((name, index) => [name, row[index]])) as T
    );
  };

  const transaction = <T>(body: () => T): T => {
    const connection = current();
    connection.exec('BEGIN');
    try {
      const result = body();
      connection.exec('COMMIT');
      return result;
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  };

  return {
    async testConnection() {
      await open();
      run('SELECT 1');
    },

    async listDatabases() {
      return [path.basename(resolveSqlitePath(config.host))];
    },

    async getSchema() {
      await open();
      const names = query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name`
      );

      const tables: Table[] = names.map(({ name }) => {
        const columns = query<{
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
          hidden: number;
        }>('SELECT * FROM pragma_table_xinfo(?)', [name]);
        const keyed = columns.filter((column) => column.pk > 0).toSorted((a, b) => a.pk - b.pk);

        const foreign = query<{
          id: number;
          seq: number;
          table: string;
          from: string;
          to: string | null;
        }>('SELECT * FROM pragma_foreign_key_list(?)', [name]);
        const byId = new Map<number, typeof foreign>();
        for (const row of foreign) byId.set(row.id, [...(byId.get(row.id) ?? []), row]);

        const indexRows = query<{
          name: string;
          unique: number;
          origin: string;
        }>('SELECT * FROM pragma_index_list(?)', [name]);

        return {
          schema: SCHEMA,
          name,
          columns: columns
            .filter((column) => column.hidden === 0)
            .map((column) => ({
              name: column.name,
              dataType: column.type || 'any',
              nullable: column.notnull === 0 && column.pk === 0,
              defaultValue: column.dflt_value,
              isPrimaryKey: column.pk > 0
            })),
          primaryKeys: keyed.map((column) => column.name),
          foreignKeys: [...byId.entries()].map(([id, parts]) => ({
            name: `fk_${name}_${id}`,
            columns: parts.toSorted((a, b) => a.seq - b.seq).map((part) => part.from),
            referencedSchema: SCHEMA,
            referencedTable: parts[0].table,
            referencedColumns: parts.toSorted((a, b) => a.seq - b.seq).map((part) => part.to ?? '')
          })),
          indexes: indexRows
            // Primary-key autoindexes duplicate the key already shown.
            .filter((index) => index.origin !== 'pk')
            .map((index) => ({
              name: index.name,
              unique: index.unique === 1,
              columns: query<{ name: string }>(
                'SELECT name FROM pragma_index_info(?) ORDER BY seqno',
                [index.name]
              ).map((column) => column.name)
            }))
        } satisfies Table;
      });

      return finalize(tables);
    },

    async execute(sql, readOnly) {
      await open();
      const started = performance.now();
      // query_only makes SQLite itself refuse every write, DDL included.
      current().exec(`PRAGMA query_only = ${readOnly ? 'ON' : 'OFF'}`);
      try {
        const { columns, rows } = run(sql);
        return {
          columns,
          rows: rows.slice(0, MAX_RESULT_ROWS),
          rowCount: rows.length,
          durationMs: Math.round(performance.now() - started),
          truncated: rows.length > MAX_RESULT_ROWS
        } satisfies QueryResult;
      } finally {
        current().exec('PRAGMA query_only = OFF');
      }
    },

    async fetchRows(
      _schema,
      table,
      { limit, offset, filter, search, searchColumns, columnFilters = [] }
    ) {
      await open();
      const conditions = filter ? [`(${filter})`] : [];
      const values: unknown[] = [];
      const bind = (value: unknown) => {
        values.push(value);
        return '?';
      };
      if (search && searchColumns?.length) {
        const pattern = likePattern(search);
        conditions.push(
          `(${searchColumns
            .map((column) => dialect.containsCondition(quoteIdent(column), bind(pattern)))
            .join(' OR ')})`
        );
      }
      conditions.push(...columnFilterConditions('SQLITE', columnFilters, bind));
      const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
      const { columns, rows } = run(`SELECT * FROM ${quoteIdent(table)}${where} LIMIT ? OFFSET ?`, [
        ...values,
        limit + 1,
        offset
      ]);
      return {
        columns,
        rows: rows.slice(0, limit),
        hasMore: rows.length > limit
      } satisfies RowPage;
    },

    async insertRow(schema, table, values) {
      await open();
      const { sql, params } = buildRowStatement('SQLITE', schema, table, {
        kind: 'insert',
        values
      });
      run(sql, params);
    },

    async updateRow(schema, table, values, where) {
      await open();
      const { sql, params } = buildRowStatement('SQLITE', schema, table, {
        kind: 'update',
        values,
        where
      });
      run(sql, params);
    },

    async deleteRow(schema, table, where) {
      await open();
      const { sql, params } = buildRowStatement('SQLITE', schema, table, { kind: 'delete', where });
      run(sql, params);
    },

    async applyRowChanges(schema, table, changes) {
      await open();
      transaction(() => {
        for (const [index, change] of changes.entries()) {
          const { sql, params } = buildRowStatement('SQLITE', schema, table, change);
          try {
            run(sql, params);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new StatementFailedError(
              `Statement ${index + 1} failed: ${reason}. Nothing was applied.`,
              index
            );
          }
        }
      });
    },

    async applyStatements(statements) {
      await open();
      transaction(() => {
        for (const [index, sql] of statements.entries()) {
          try {
            run(sql);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new StatementFailedError(
              `Statement ${index + 1} failed, so nothing was applied: ${reason}`,
              index
            );
          }
        }
      });
    },

    async disconnect() {
      db?.close();
      db = undefined;
    }
  };
}
