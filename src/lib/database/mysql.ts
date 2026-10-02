import { buildRowStatement } from '@/lib/database/row-changes';
import { columnFilterConditions } from '@/lib/database/column-filters';
import { createConnection, type Connection, type FieldPacket } from 'mysql2/promise';
import {
  MAX_RESULT_ROWS,
  type ConnectionConfig,
  type DatabaseAdapter,
  type QueryResult,
  type RowPage,
  type Table,
  likePattern,
  StatementFailedError
} from '@/lib/database/types';
import { finalize } from '@/lib/database/postgres';
import { isReadStatement, leadingKeyword } from '@/lib/database/read-only';

/** Identifiers come from our own schema scan, not user input, but still get quoted. */
function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}

function qualifiedIdent(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

const COLUMNS_SQL = `
  SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.COLUMN_TYPE, c.DATA_TYPE,
         c.IS_NULLABLE, c.COLUMN_DEFAULT, c.EXTRA
  FROM information_schema.COLUMNS c
  JOIN information_schema.TABLES t
    ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
  WHERE t.TABLE_TYPE = 'BASE TABLE' AND c.TABLE_SCHEMA = ?
  ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
`;

// ORDINAL_POSITION preserves composite key order.
const KEYS_SQL = `
  SELECT k.CONSTRAINT_NAME, k.TABLE_SCHEMA, k.TABLE_NAME, k.COLUMN_NAME,
         k.ORDINAL_POSITION, k.REFERENCED_TABLE_SCHEMA, k.REFERENCED_TABLE_NAME,
         k.REFERENCED_COLUMN_NAME, t.CONSTRAINT_TYPE
  FROM information_schema.KEY_COLUMN_USAGE k
  JOIN information_schema.TABLE_CONSTRAINTS t
    ON t.CONSTRAINT_NAME = k.CONSTRAINT_NAME
   AND t.TABLE_SCHEMA = k.TABLE_SCHEMA
   AND t.TABLE_NAME = k.TABLE_NAME
  WHERE k.TABLE_SCHEMA = ? AND t.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'FOREIGN KEY')
  ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION
`;

const INDEXES_SQL = `
  SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = ?
  ORDER BY INDEX_NAME, SEQ_IN_INDEX
`;

type Row = Record<string, string | number | null>;

const NUMERIC_TYPES = new Set([
  'tinyint',
  'smallint',
  'mediumint',
  'int',
  'integer',
  'bigint',
  'decimal',
  'numeric',
  'float',
  'double',
  'real',
  'bit',
  'year'
]);

/**
 * information_schema reports defaults differently per server: MariaDB gives
 * SQL expressions already ('draft', NULL), MySQL gives the bare value (draft)
 * and flags expression defaults as DEFAULT_GENERATED. Normalise both to a SQL
 * expression, so a default can be dropped straight back into DDL.
 */
function sqlDefault(
  raw: string | null,
  dataType: string,
  extra: string,
  isMariaDb: boolean
): string | null {
  if (raw === null) return null;
  if (isMariaDb) return raw === 'NULL' ? null : raw;

  const isCurrentTimestamp = /^current_timestamp(\(\d*\))?$/i.test(raw);
  if (extra.includes('DEFAULT_GENERATED') || isCurrentTimestamp) {
    return isCurrentTimestamp ? raw : `(${raw})`;
  }
  if (NUMERIC_TYPES.has(dataType)) return raw;
  return `'${raw.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

const INTERNAL_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

export function createMySqlAdapter(config: ConnectionConfig): DatabaseAdapter {
  let connection: Connection | undefined;

  const connect = async (): Promise<Connection> => {
    connection ??= await createConnection({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      connectTimeout: 10_000,
      // Refuses stacked statements, so one editor tab cannot smuggle a second command.
      multipleStatements: false,
      dateStrings: true
    });
    return connection;
  };

  return {
    async testConnection() {
      const client = await connect();
      await client.query('SELECT 1');
    },

    async listDatabases() {
      const client = await connect();
      const [rows] = await client.query('SHOW DATABASES');
      return (rows as Row[])
        .map((row) => String(row.Database))
        .filter((name) => !INTERNAL_DATABASES.has(name));
    },

    async getSchema() {
      const client = await connect();
      await client.query(`SET SESSION MAX_EXECUTION_TIME = ${config.statementTimeoutMs}`);

      const [versionRows] = await client.query('SELECT VERSION() AS version');
      const isMariaDb = String((versionRows as Row[])[0]?.version).includes('MariaDB');
      const columns = await client.query(COLUMNS_SQL, [config.database]);
      const keys = await client.query(KEYS_SQL, [config.database]);
      const indexes = await client.query(INDEXES_SQL, [config.database]);

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

      for (const row of columns[0] as Row[]) {
        const extra = String(row.EXTRA ?? '');
        // DEFAULT_GENERATED is a marker, not something DDL accepts back.
        const keptExtra = extra.replace('DEFAULT_GENERATED', '').trim();
        tableFor(String(row.TABLE_SCHEMA), String(row.TABLE_NAME)).columns.push({
          name: String(row.COLUMN_NAME),
          dataType: String(row.COLUMN_TYPE),
          nullable: row.IS_NULLABLE === 'YES',
          defaultValue: sqlDefault(
            row.COLUMN_DEFAULT === null ? null : String(row.COLUMN_DEFAULT),
            String(row.DATA_TYPE).toLowerCase(),
            extra,
            isMariaDb
          ),
          isPrimaryKey: false,
          ...(keptExtra && { extra: keptExtra })
        });
      }

      // KEY_COLUMN_USAGE returns one row per column; regroup them per constraint.
      const foreignKeys = new Map<
        string,
        {
          table: Table;
          name: string;
          columns: string[];
          refSchema: string;
          refTable: string;
          refColumns: string[];
        }
      >();

      for (const row of keys[0] as Row[]) {
        const table = tableFor(String(row.TABLE_SCHEMA), String(row.TABLE_NAME));
        if (row.CONSTRAINT_TYPE === 'PRIMARY KEY') {
          table.primaryKeys.push(String(row.COLUMN_NAME));
          continue;
        }
        if (!row.REFERENCED_TABLE_NAME) continue;

        const key = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}.${row.CONSTRAINT_NAME}`;
        const existing = foreignKeys.get(key) ?? {
          table,
          name: String(row.CONSTRAINT_NAME),
          columns: [],
          refSchema: String(row.REFERENCED_TABLE_SCHEMA),
          refTable: String(row.REFERENCED_TABLE_NAME),
          refColumns: []
        };
        existing.columns.push(String(row.COLUMN_NAME));
        existing.refColumns.push(String(row.REFERENCED_COLUMN_NAME));
        foreignKeys.set(key, existing);
      }

      for (const key of foreignKeys.values()) {
        key.table.foreignKeys.push({
          name: key.name,
          columns: key.columns,
          referencedSchema: key.refSchema,
          referencedTable: key.refTable,
          referencedColumns: key.refColumns
        });
      }

      const indexColumns = new Map<string, { table: Table; unique: boolean; columns: string[] }>();
      for (const row of indexes[0] as Row[]) {
        const table = tableFor(String(row.TABLE_SCHEMA), String(row.TABLE_NAME));
        const key = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}.${row.INDEX_NAME}`;
        const existing = indexColumns.get(key) ?? {
          table,
          unique: Number(row.NON_UNIQUE) === 0,
          columns: []
        };
        existing.columns.push(String(row.COLUMN_NAME));
        indexColumns.set(key, existing);
      }

      for (const [key, value] of indexColumns) {
        value.table.indexes.push({
          name: key.split('.').slice(2).join('.'),
          columns: value.columns,
          unique: value.unique
        });
      }

      return finalize([...tables.values()]);
    },

    async execute(sql, readOnly) {
      // MySQL DDL implicitly commits and so ignores a read-only transaction.
      // See lib/database/read-only.ts for why the leading keyword is enough.
      if (readOnly && !isReadStatement(sql)) {
        throw new Error(
          `${leadingKeyword(sql) || 'That statement'} is not allowed on a read-only connection`
        );
      }

      const client = await connect();
      const started = performance.now();

      await client.query(`SET SESSION MAX_EXECUTION_TIME = ${config.statementTimeoutMs}`);
      await client.query(readOnly ? 'START TRANSACTION READ ONLY' : 'START TRANSACTION');
      try {
        const [rows, fields] = await client.query({ sql, rowsAsArray: true });
        await client.query(readOnly ? 'ROLLBACK' : 'COMMIT');

        const list = Array.isArray(rows) ? (rows as unknown[][]) : [];
        return {
          columns: ((fields ?? []) as FieldPacket[]).map((field) => field.name),
          rows: list.slice(0, MAX_RESULT_ROWS),
          rowCount: list.length,
          durationMs: Math.round(performance.now() - started),
          truncated: list.length > MAX_RESULT_ROWS
        } satisfies QueryResult;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    },

    async fetchRows(
      schema,
      table,
      { limit, offset, filter, search, searchColumns, columnFilters = [] }
    ) {
      const client = await connect();
      const conditions = filter ? [`(${filter})`] : [];
      // In the order their `?` appear; LIMIT and OFFSET come last.
      const searchValues: unknown[] = [];
      if (search && searchColumns?.length) {
        conditions.push(
          `(${searchColumns.map((column) => `CAST(${quoteIdent(column)} AS CHAR) LIKE ?`).join(' OR ')})`
        );
        searchValues.push(...searchColumns.map(() => likePattern(search)));
      }
      conditions.push(
        ...columnFilterConditions('MYSQL', columnFilters, (value) => {
          searchValues.push(value);
          return '?';
        })
      );
      const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
      // Fetch one extra row to know whether a next page exists, without a COUNT(*).
      const [rows, fields] = await client.query(
        {
          sql: `SELECT * FROM ${qualifiedIdent(schema, table)}${where} LIMIT ? OFFSET ?`,
          rowsAsArray: true
        },
        [...searchValues, limit + 1, offset]
      );
      const list = Array.isArray(rows) ? (rows as unknown[][]) : [];
      return {
        columns: ((fields ?? []) as FieldPacket[]).map((field) => field.name),
        rows: list.slice(0, limit),
        hasMore: list.length > limit
      } satisfies RowPage;
    },

    async insertRow(schema, table, values) {
      const client = await connect();
      const { sql, params } = buildRowStatement('MYSQL', schema, table, { kind: 'insert', values });
      await client.query(sql, params);
    },

    async updateRow(schema, table, values, where) {
      const client = await connect();
      const { sql, params } = buildRowStatement('MYSQL', schema, table, {
        kind: 'update',
        values,
        where
      });
      await client.query(sql, params);
    },

    async deleteRow(schema, table, where) {
      const client = await connect();
      const { sql, params } = buildRowStatement('MYSQL', schema, table, { kind: 'delete', where });
      await client.query(sql, params);
    },

    async applyRowChanges(schema, table, changes) {
      const client = await connect();
      // Row edits (unlike DDL) are transactional on InnoDB.
      await client.beginTransaction();
      for (const [index, change] of changes.entries()) {
        const { sql, params } = buildRowStatement('MYSQL', schema, table, change);
        try {
          await client.query(sql, params);
        } catch (error) {
          await client.rollback().catch(() => undefined);
          const reason = error instanceof Error ? error.message : String(error);
          throw new StatementFailedError(
            `Statement ${index + 1} failed: ${reason}. Nothing was applied.`,
            index
          );
        }
      }
      await client.commit();
    },

    async applyStatements(statements) {
      const client = await connect();
      await client.query(`SET SESSION MAX_EXECUTION_TIME = ${config.statementTimeoutMs}`);
      // MySQL DDL commits implicitly, so there is no transaction to roll back.
      for (const [index, sql] of statements.entries()) {
        try {
          await client.query(sql);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const applied =
            index === 0
              ? 'Nothing was applied.'
              : `MySQL can't roll back schema changes, so the ${index} statement${index === 1 ? '' : 's'} before it stayed applied.`;
          throw new StatementFailedError(
            `Statement ${index + 1} failed: ${reason}. ${applied}`,
            index
          );
        }
      }
    },

    async disconnect() {
      const client = connection;
      connection = undefined;
      await client?.end().catch(() => undefined);
    }
  };
}
