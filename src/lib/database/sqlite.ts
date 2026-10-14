import Database from 'better-sqlite3';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { columnFilterConditions } from '@/lib/database/column-filters';
import { dialectOf } from '@/lib/database/dialect';
import { finalize } from '@/lib/database/postgres';
import { buildRowStatement } from '@/lib/database/row-changes';
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
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`;
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function createSqliteAdapter(config: ConnectionConfig): DatabaseAdapter {
  let db: Database.Database | undefined;
  const open = () => {
    if (!db) {
      db = new Database(resolveSqlitePath(config.host), { fileMustExist: true, timeout: 10_000 });
      db.defaultSafeIntegers(false);
    }
    return db;
  };

  /** Rows as arrays plus column names, whatever kind of statement this is. */
  const run = (sql: string, params: unknown[] = []) => {
    const statement = open().prepare(sql);
    if (!statement.reader) {
      statement.run(...params);
      return { columns: [] as string[], rows: [] as unknown[][] };
    }
    const columns = statement.columns().map((column) => column.name);
    const rows = statement
      .raw(true)
      .all(...params)
      .map((row) => (row as unknown[]).map(plain));
    return { columns, rows };
  };

  const transaction = <T>(body: () => T): T => {
    const connection = open();
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
      run('SELECT 1');
    },

    async listDatabases() {
      return [path.basename(resolveSqlitePath(config.host))];
    },

    async getSchema() {
      const connection = open();
      const names = connection
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name`
        )
        .all() as { name: string }[];

      const tables: Table[] = names.map(({ name }) => {
        const columns = connection.prepare('SELECT * FROM pragma_table_xinfo(?)').all(name) as {
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
          hidden: number;
        }[];
        const keyed = columns.filter((column) => column.pk > 0).toSorted((a, b) => a.pk - b.pk);

        const foreign = connection
          .prepare('SELECT * FROM pragma_foreign_key_list(?)')
          .all(name) as {
          id: number;
          seq: number;
          table: string;
          from: string;
          to: string | null;
        }[];
        const byId = new Map<number, typeof foreign>();
        for (const row of foreign) byId.set(row.id, [...(byId.get(row.id) ?? []), row]);

        const indexRows = connection.prepare('SELECT * FROM pragma_index_list(?)').all(name) as {
          name: string;
          unique: number;
          origin: string;
        }[];

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
              columns: (
                connection
                  .prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno')
                  .all(index.name) as { name: string }[]
              ).map((column) => column.name)
            }))
        } satisfies Table;
      });

      return finalize(tables);
    },

    async execute(sql, readOnly) {
      const connection = open();
      const started = performance.now();
      // query_only makes SQLite itself refuse every write, DDL included.
      connection.pragma(`query_only = ${readOnly ? 'ON' : 'OFF'}`);
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
        connection.pragma('query_only = OFF');
      }
    },

    async fetchRows(
      _schema,
      table,
      { limit, offset, filter, search, searchColumns, columnFilters = [] }
    ) {
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
      const { sql, params } = buildRowStatement('SQLITE', schema, table, {
        kind: 'insert',
        values
      });
      run(sql, params);
    },

    async updateRow(schema, table, values, where) {
      const { sql, params } = buildRowStatement('SQLITE', schema, table, {
        kind: 'update',
        values,
        where
      });
      run(sql, params);
    },

    async deleteRow(schema, table, where) {
      const { sql, params } = buildRowStatement('SQLITE', schema, table, { kind: 'delete', where });
      run(sql, params);
    },

    async applyRowChanges(schema, table, changes) {
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
