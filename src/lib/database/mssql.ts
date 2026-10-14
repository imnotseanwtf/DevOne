import sql, { type ConnectionPool, type IResult } from 'mssql';
import { columnFilterConditions } from '@/lib/database/column-filters';
import { dialectOf } from '@/lib/database/dialect';
import { finalize } from '@/lib/database/postgres';
import { isReadStatement } from '@/lib/database/read-only';
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

const dialect = dialectOf('MSSQL');
const quoteIdent = dialect.quote;
const qualifiedIdent = (schema: string, table: string) =>
  `${quoteIdent(schema)}.${quoteIdent(table)}`;

// A server-level session lands on `master`, which every instance has.
const MAINTENANCE_DATABASE = 'master';

const SYSTEM_DATABASES = ['master', 'tempdb', 'model', 'msdb'];

const COLUMNS_SQL = `
  SELECT c.TABLE_SCHEMA AS table_schema, c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name,
         CASE
           WHEN c.CHARACTER_MAXIMUM_LENGTH IS NULL THEN c.DATA_TYPE
           WHEN c.CHARACTER_MAXIMUM_LENGTH = -1 THEN c.DATA_TYPE + '(max)'
           ELSE c.DATA_TYPE + '(' + CAST(c.CHARACTER_MAXIMUM_LENGTH AS varchar(10)) + ')'
         END AS data_type,
         c.IS_NULLABLE AS is_nullable, c.COLUMN_DEFAULT AS column_default
  FROM INFORMATION_SCHEMA.COLUMNS c
  JOIN INFORMATION_SCHEMA.TABLES t
    ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
  WHERE t.TABLE_TYPE = 'BASE TABLE'
  ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
`;

const PRIMARY_KEYS_SQL = `
  SELECT s.name AS schema_name, t.name AS table_name, col.name AS column_name, ic.key_ordinal AS ord
  FROM sys.indexes i
  JOIN sys.tables t ON t.object_id = i.object_id
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
  JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
  WHERE i.is_primary_key = 1
  ORDER BY s.name, t.name, ic.key_ordinal
`;

const FOREIGN_KEYS_SQL = `
  SELECT fk.name AS constraint_name, ps.name AS schema_name, pt.name AS table_name,
         pc.name AS column_name, rs.name AS ref_schema, rt.name AS ref_table,
         rc.name AS ref_column, fkc.constraint_column_id AS ord
  FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
  JOIN sys.tables pt ON pt.object_id = fk.parent_object_id
  JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
  JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
  JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
  JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
  JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
  ORDER BY fk.name, fkc.constraint_column_id
`;

const INDEXES_SQL = `
  SELECT s.name AS schema_name, t.name AS table_name, i.name AS index_name,
         i.is_unique AS is_unique, col.name AS column_name, ic.key_ordinal AS ord
  FROM sys.indexes i
  JOIN sys.tables t ON t.object_id = i.object_id
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
  JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
  WHERE i.is_primary_key = 0 AND i.type > 0 AND ic.is_included_column = 0
  ORDER BY i.name, ic.key_ordinal
`;

/**
 * SQL Server has no read-only transaction. A read-only run is therefore wrapped
 * in a transaction that is always rolled back (T-SQL DDL and DML are both
 * transactional), behind a leading-keyword allowlist, and statements that can
 * act outside a transaction (EXEC, xp_/sp_ procedures, OPENROWSET, BULK) are
 * refused. Least-privilege logins remain the real boundary.
 */
const OUTSIDE_TRANSACTION =
  /\b(exec|execute|xp_\w+|sp_\w+|openrowset|opendatasource|bulk|backup|restore|shutdown)\b/i;

export class MssqlReadOnlyError extends Error {
  constructor() {
    super('This connection is read-only: only SELECT-style statements are allowed');
    this.name = 'MssqlReadOnlyError';
  }
}

export function assertMssqlReadable(statement: string): void {
  if (!isReadStatement(statement) || OUTSIDE_TRANSACTION.test(statement)) {
    throw new MssqlReadOnlyError();
  }
}

function toResult(result: IResult<unknown[]>): { columns: string[]; rows: unknown[][] } {
  const set = (Array.isArray(result.recordsets) ? result.recordsets[0] : undefined) as
    | (unknown[][] & { columns?: Record<string, { index: number; name: string }> })
    | undefined;
  if (!set) return { columns: [], rows: [] };
  const columns = Object.values(set.columns ?? {})
    .toSorted((a, b) => a.index - b.index)
    .map((column) => column.name);
  return {
    columns,
    rows: set.map((row) =>
      row.map((value) => (value instanceof Buffer ? `0x${value.toString('hex')}` : value))
    )
  };
}

export function createMssqlAdapter(config: ConnectionConfig): DatabaseAdapter {
  let pool: ConnectionPool | undefined;
  const connect = async () => {
    pool ??= await new sql.ConnectionPool({
      server: config.host,
      port: config.port,
      database: config.database ?? MAINTENANCE_DATABASE,
      user: config.username,
      password: config.password,
      connectionTimeout: 10_000,
      requestTimeout: config.statementTimeoutMs,
      options: { encrypt: config.ssl, trustServerCertificate: true, appName: 'DevOne' }
    }).connect();
    return pool;
  };

  const request = async (text: string, params: unknown[] = []) => {
    const req = (await connect()).request();
    req.arrayRowMode = true;
    params.forEach((value, index) => req.input(`p${index + 1}`, value));
    return toResult((await req.query(text)) as IResult<unknown[]>);
  };

  const inTransaction = async <T>(body: (run: typeof request) => Promise<T>, commit: boolean) => {
    const transaction = new sql.Transaction(await connect());
    await transaction.begin();
    const run: typeof request = async (text, params = []) => {
      const req = transaction.request();
      req.arrayRowMode = true;
      params.forEach((value, index) => req.input(`p${index + 1}`, value));
      return toResult((await req.query(text)) as IResult<unknown[]>);
    };
    try {
      const result = await body(run);
      if (commit) await transaction.commit();
      else await transaction.rollback();
      return result;
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    }
  };

  return {
    async testConnection() {
      await request('SELECT 1');
    },

    async listDatabases() {
      const { rows } = await request(
        `SELECT name FROM sys.databases WHERE HAS_DBACCESS(name) = 1 AND name NOT IN (${SYSTEM_DATABASES.map((name) => `'${name}'`).join(', ')}) ORDER BY name`
      );
      return rows.map((row) => String(row[0]));
    },

    async getSchema() {
      const [columns, keys, foreign, indexes] = [
        await request(COLUMNS_SQL),
        await request(PRIMARY_KEYS_SQL),
        await request(FOREIGN_KEYS_SQL),
        await request(INDEXES_SQL)
      ];

      const tables = new Map<string, Table>();
      const tableFor = (schema: string, name: string): Table => {
        const key = `${schema}.${name}`;
        let table = tables.get(key);
        if (!table) {
          table = { schema, name, columns: [], primaryKeys: [], foreignKeys: [], indexes: [] };
          tables.set(key, table);
        }
        return table;
      };

      for (const [schema, name, column, dataType, nullable, defaultValue] of columns.rows) {
        tableFor(String(schema), String(name)).columns.push({
          name: String(column),
          dataType: String(dataType),
          nullable: nullable === 'YES',
          defaultValue: defaultValue === null ? null : String(defaultValue),
          isPrimaryKey: false
        });
      }
      for (const [schema, name, column] of keys.rows) {
        tableFor(String(schema), String(name)).primaryKeys.push(String(column));
      }

      const foreignKeys = new Map<string, Table['foreignKeys'][number]>();
      for (const [
        constraint,
        schema,
        name,
        column,
        refSchema,
        refTable,
        refColumn
      ] of foreign.rows) {
        const key = `${schema}.${name}.${constraint}`;
        let entry = foreignKeys.get(key);
        if (!entry) {
          entry = {
            name: String(constraint),
            columns: [],
            referencedSchema: String(refSchema),
            referencedTable: String(refTable),
            referencedColumns: []
          };
          foreignKeys.set(key, entry);
          tableFor(String(schema), String(name)).foreignKeys.push(entry);
        }
        entry.columns.push(String(column));
        entry.referencedColumns.push(String(refColumn));
      }

      const indexMap = new Map<string, Table['indexes'][number]>();
      for (const [schema, name, index, unique, column] of indexes.rows) {
        const key = `${schema}.${name}.${index}`;
        let entry = indexMap.get(key);
        if (!entry) {
          entry = { name: String(index), columns: [], unique: Boolean(unique) };
          indexMap.set(key, entry);
          tableFor(String(schema), String(name)).indexes.push(entry);
        }
        entry.columns.push(String(column));
      }

      return finalize([...tables.values()]);
    },

    async execute(statement, readOnly) {
      if (readOnly) assertMssqlReadable(statement);
      const started = performance.now();
      const { columns, rows } = await inTransaction((run) => run(statement), !readOnly);
      return {
        columns,
        rows: rows.slice(0, MAX_RESULT_ROWS),
        rowCount: rows.length,
        durationMs: Math.round(performance.now() - started),
        truncated: rows.length > MAX_RESULT_ROWS
      } satisfies QueryResult;
    },

    async fetchRows(
      schema,
      table,
      { limit, offset, filter, search, searchColumns, columnFilters = [] }
    ) {
      const conditions = filter ? [`(${filter})`] : [];
      const values: unknown[] = [];
      const bind = (value: unknown) => {
        values.push(value);
        return dialect.placeholder(values.length);
      };
      if (search && searchColumns?.length) {
        const pattern = bind(likePattern(search));
        conditions.push(
          `(${searchColumns.map((column) => dialect.containsCondition(quoteIdent(column), pattern)).join(' OR ')})`
        );
      }
      conditions.push(...columnFilterConditions('MSSQL', columnFilters, bind));
      const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
      const offsetParam = bind(offset);
      const limitParam = bind(limit + 1);
      const { columns, rows } = await request(
        `SELECT * FROM ${qualifiedIdent(schema, table)}${where} ORDER BY (SELECT NULL) OFFSET ${offsetParam} ROWS FETCH NEXT ${limitParam} ROWS ONLY`,
        values
      );
      return {
        columns,
        rows: rows.slice(0, limit),
        hasMore: rows.length > limit
      } satisfies RowPage;
    },

    async insertRow(schema, table, values) {
      const { sql: text, params } = buildRowStatement('MSSQL', schema, table, {
        kind: 'insert',
        values
      });
      await request(text, params);
    },

    async updateRow(schema, table, values, where) {
      const { sql: text, params } = buildRowStatement('MSSQL', schema, table, {
        kind: 'update',
        values,
        where
      });
      await request(text, params);
    },

    async deleteRow(schema, table, where) {
      const { sql: text, params } = buildRowStatement('MSSQL', schema, table, {
        kind: 'delete',
        where
      });
      await request(text, params);
    },

    async applyRowChanges(schema, table, changes) {
      await inTransaction(async (run) => {
        for (const [index, change] of changes.entries()) {
          const { sql: text, params } = buildRowStatement('MSSQL', schema, table, change);
          try {
            await run(text, params);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new StatementFailedError(
              `Statement ${index + 1} failed: ${reason}. Nothing was applied.`,
              index
            );
          }
        }
      }, true);
    },

    async applyStatements(statements) {
      await inTransaction(async (run) => {
        for (const [index, text] of statements.entries()) {
          try {
            await run(text);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new StatementFailedError(
              `Statement ${index + 1} failed, so nothing was applied: ${reason}`,
              index
            );
          }
        }
      }, true);
    },

    async disconnect() {
      const current = pool;
      pool = undefined;
      await current?.close().catch(() => undefined);
    }
  };
}
