import { buildRowStatement } from '@/lib/database/row-changes';
import { columnFilterConditions } from '@/lib/database/column-filters';
import { Client } from 'pg';
import {
  MAX_RESULT_ROWS,
  type Column,
  type ConnectionConfig,
  type DatabaseAdapter,
  type DatabaseSchema,
  type ForeignKey,
  type Index,
  type QueryResult,
  type RowPage,
  type Table,
  likePattern,
  StatementFailedError
} from '@/lib/database/types';

/** Identifiers come from our own schema scan, not user input, but still get quoted. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function qualifiedIdent(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema'];

// Covers pg_catalog plus the schemas Postgres names dynamically per-session
// (pg_toast, pg_temp_N, pg_toast_temp_N), none of which are user schemas.
const SYSTEM_SCHEMA_PATTERN = 'pg\\_%';

// format_type gives the full, DDL-ready type (`character varying(255)`,
// `integer[]`, enum names) where information_schema.data_type drops it.
const COLUMNS_SQL = `
  SELECT c.table_schema, c.table_name, c.column_name,
         format_type(a.atttypid, a.atttypmod) AS data_type,
         c.is_nullable, c.column_default
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name
  JOIN pg_attribute a
    ON a.attrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
   AND a.attname = c.column_name
  WHERE t.table_type = 'BASE TABLE'
    AND c.table_schema <> ALL($1)
    AND c.table_schema NOT LIKE $2
  ORDER BY c.table_schema, c.table_name, c.ordinal_position
`;

// pg_catalog keeps key column order, which information_schema does not for composites.
// attname is type `name`; aggregating it without ::text yields name[], which
// node-pg has no array parser for and returns as a raw string.
const CONSTRAINTS_SQL = `
  SELECT con.conname, con.contype, ns.nspname AS schema_name, cl.relname AS table_name,
         (SELECT array_agg(att.attname::text ORDER BY u.ord)
            FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.attnum
         ) AS columns,
         fns.nspname AS ref_schema, fcl.relname AS ref_table,
         (SELECT array_agg(att.attname::text ORDER BY u.ord)
            FROM unnest(con.confkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = u.attnum
         ) AS ref_columns
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = cl.relnamespace
  LEFT JOIN pg_class fcl ON fcl.oid = con.confrelid
  LEFT JOIN pg_namespace fns ON fns.oid = fcl.relnamespace
  WHERE con.contype IN ('p', 'f') AND ns.nspname <> ALL($1) AND ns.nspname NOT LIKE $2
`;

const INDEXES_SQL = `
  SELECT ns.nspname AS schema_name, cl.relname AS table_name,
         ic.relname AS index_name, idx.indisunique AS is_unique,
         (SELECT array_agg(att.attname::text ORDER BY u.ord)
            FROM unnest(idx.indkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute att ON att.attrelid = cl.oid AND att.attnum = u.attnum
         ) AS columns
  FROM pg_index idx
  JOIN pg_class cl ON cl.oid = idx.indrelid
  JOIN pg_class ic ON ic.oid = idx.indexrelid
  JOIN pg_namespace ns ON ns.oid = cl.relnamespace
  WHERE ns.nspname <> ALL($1) AND ns.nspname NOT LIKE $2
`;

// Postgres has no database-less connection, so a server-level session (no
// `database` given, e.g. to list what's on the server) lands on the
// maintenance database every server ships with.
const MAINTENANCE_DATABASE = 'postgres';

export function createPostgresAdapter(config: ConnectionConfig): DatabaseAdapter {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database ?? MAINTENANCE_DATABASE,
    user: config.username,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10_000,
    statement_timeout: config.statementTimeoutMs,
    application_name: 'DevOne'
  });

  let connected = false;
  const connect = async () => {
    if (!connected) {
      await client.connect();
      connected = true;
    }
  };

  return {
    async testConnection() {
      await connect();
      await client.query('SELECT 1');
    },

    async listDatabases() {
      await connect();
      const result = await client.query<{ datname: string }>(
        `SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn = true ORDER BY datname`
      );
      return result.rows.map((row) => row.datname);
    },

    async getSchema() {
      await connect();
      // A single pg Client cannot multiplex, so these run in sequence.
      const columns = await client.query(COLUMNS_SQL, [SYSTEM_SCHEMAS, SYSTEM_SCHEMA_PATTERN]);
      const constraints = await client.query(CONSTRAINTS_SQL, [
        SYSTEM_SCHEMAS,
        SYSTEM_SCHEMA_PATTERN
      ]);
      const indexes = await client.query(INDEXES_SQL, [SYSTEM_SCHEMAS, SYSTEM_SCHEMA_PATTERN]);

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

      for (const row of columns.rows) {
        tableFor(row.table_schema, row.table_name).columns.push({
          name: row.column_name,
          dataType: row.data_type,
          nullable: row.is_nullable === 'YES',
          defaultValue: row.column_default,
          isPrimaryKey: false
        } satisfies Column);
      }

      for (const row of constraints.rows) {
        const table = tableFor(row.schema_name, row.table_name);
        if (row.contype === 'p') {
          table.primaryKeys = row.columns ?? [];
        } else if (row.ref_table) {
          table.foreignKeys.push({
            name: row.conname,
            columns: row.columns ?? [],
            referencedSchema: row.ref_schema,
            referencedTable: row.ref_table,
            referencedColumns: row.ref_columns ?? []
          } satisfies ForeignKey);
        }
      }

      for (const row of indexes.rows) {
        tableFor(row.schema_name, row.table_name).indexes.push({
          name: row.index_name,
          columns: row.columns ?? [],
          unique: row.is_unique
        } satisfies Index);
      }

      return finalize([...tables.values()]);
    },

    async execute(sql, readOnly) {
      await connect();
      const started = performance.now();

      // A read-only transaction is refused by the server itself, unlike SQL parsing.
      await client.query(readOnly ? 'BEGIN TRANSACTION READ ONLY' : 'BEGIN');
      try {
        const result = await client.query({ text: sql, rowMode: 'array' });
        await client.query(readOnly ? 'ROLLBACK' : 'COMMIT');

        const rows = (result.rows ?? []) as unknown[][];
        return {
          columns: (result.fields ?? []).map((field) => field.name),
          rows: rows.slice(0, MAX_RESULT_ROWS),
          rowCount: rows.length,
          durationMs: Math.round(performance.now() - started),
          truncated: rows.length > MAX_RESULT_ROWS
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
      await connect();
      const conditions = filter ? [`(${filter})`] : [];
      const values: unknown[] = [limit + 1, offset];
      const bind = (value: unknown) => {
        values.push(value);
        return `$${values.length}`;
      };
      if (search && searchColumns?.length) {
        const pattern = bind(likePattern(search));
        conditions.push(
          `(${searchColumns.map((column) => `${quoteIdent(column)}::text ILIKE ${pattern}`).join(' OR ')})`
        );
      }
      conditions.push(...columnFilterConditions('POSTGRES', columnFilters, bind));
      const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
      // Fetch one extra row to know whether a next page exists, without a COUNT(*).
      const result = await client.query({
        text: `SELECT * FROM ${qualifiedIdent(schema, table)}${where} LIMIT $1 OFFSET $2`,
        values,
        rowMode: 'array'
      });
      const rows = (result.rows ?? []) as unknown[][];
      return {
        columns: (result.fields ?? []).map((field) => field.name),
        rows: rows.slice(0, limit),
        hasMore: rows.length > limit
      } satisfies RowPage;
    },

    async insertRow(schema, table, values) {
      await connect();
      const { sql, params } = buildRowStatement('POSTGRES', schema, table, {
        kind: 'insert',
        values
      });
      await client.query(sql, params);
    },

    async updateRow(schema, table, values, where) {
      await connect();
      const { sql, params } = buildRowStatement('POSTGRES', schema, table, {
        kind: 'update',
        values,
        where
      });
      await client.query(sql, params);
    },

    async deleteRow(schema, table, where) {
      await connect();
      const { sql, params } = buildRowStatement('POSTGRES', schema, table, {
        kind: 'delete',
        where
      });
      await client.query(sql, params);
    },

    async applyRowChanges(schema, table, changes) {
      await connect();
      await client.query('BEGIN');
      for (const [index, change] of changes.entries()) {
        const { sql, params } = buildRowStatement('POSTGRES', schema, table, change);
        try {
          await client.query(sql, params);
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          const reason = error instanceof Error ? error.message : String(error);
          throw new StatementFailedError(
            `Statement ${index + 1} failed: ${reason}. Nothing was applied.`,
            index
          );
        }
      }
      await client.query('COMMIT');
    },

    async applyStatements(statements) {
      await connect();
      // Postgres DDL is transactional: either every statement lands or none do.
      await client.query('BEGIN');
      for (const [index, sql] of statements.entries()) {
        try {
          await client.query(sql);
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          const reason = error instanceof Error ? error.message : String(error);
          throw new StatementFailedError(
            `Statement ${index + 1} failed, so nothing was applied: ${reason}`,
            index
          );
        }
      }
      await client.query('COMMIT');
    },

    async disconnect() {
      if (connected) {
        connected = false;
        await client.end().catch(() => undefined);
      }
    }
  };
}

/** Marks primary-key columns and gives every list a stable order. */
export function finalize(tables: Table[]): DatabaseSchema {
  for (const table of tables) {
    const primaryKeys = new Set(table.primaryKeys);
    for (const column of table.columns) column.isPrimaryKey = primaryKeys.has(column.name);
    table.foreignKeys.sort((a, b) => a.name.localeCompare(b.name));
    table.indexes.sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    tables: tables.toSorted(
      (a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name)
    )
  };
}
