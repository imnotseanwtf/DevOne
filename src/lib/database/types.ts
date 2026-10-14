import type { ColumnFilter } from '@/lib/database/column-filters';
import type { RowChange } from '@/lib/database/row-changes';
export interface ConnectionConfig {
  host: string;
  port: number;
  /** Omitted when connecting at the server level, e.g. to list databases. */
  database?: string;
  username: string;
  password: string;
  ssl: boolean;
  statementTimeoutMs: number;
  /** DynamoDB only: custom endpoint URL (DynamoDB Local, LocalStack). */
  endpoint?: string;
}

export const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

/**
 * Mirrors the Prisma enums so client components never import the generated
 * client, which is server-only. `check-core` fails if these drift apart.
 */
export const DATABASE_PROVIDERS = [
  'POSTGRES',
  'MYSQL',
  'SQLITE',
  'MSSQL',
  'MONGODB',
  'REDIS',
  'DYNAMODB'
] as const;
export const DATABASE_ENVIRONMENTS = ['LOCAL', 'DEVELOPMENT', 'STAGING', 'PRODUCTION'] as const;

export type DatabaseProviderName = (typeof DATABASE_PROVIDERS)[number];
export type DatabaseEnvironmentName = (typeof DATABASE_ENVIRONMENTS)[number];

/** The providers that speak SQL and so share the grid, SQL editor and ERD. */
export type SqlProviderName = Extract<
  DatabaseProviderName,
  'POSTGRES' | 'MYSQL' | 'SQLITE' | 'MSSQL'
>;
/** The providers browsed as documents/keys/items, with no SQL, ERD or DDL. */
export type DocumentProviderName = Exclude<DatabaseProviderName, SqlProviderName>;

export function isSqlProvider(provider: DatabaseProviderName): provider is SqlProviderName {
  return (
    provider === 'POSTGRES' || provider === 'MYSQL' || provider === 'SQLITE' || provider === 'MSSQL'
  );
}

export const DEFAULT_PORTS: Record<DatabaseProviderName, number> = {
  POSTGRES: 5432,
  MYSQL: 3306,
  // A file path and an AWS region have no port.
  SQLITE: 0,
  MSSQL: 1433,
  MONGODB: 27017,
  REDIS: 6379,
  DYNAMODB: 0
};

export const PROVIDER_LABEL: Record<DatabaseProviderName, string> = {
  POSTGRES: 'PostgreSQL',
  MYSQL: 'MySQL / MariaDB',
  SQLITE: 'SQLite',
  MSSQL: 'SQL Server',
  MONGODB: 'MongoDB',
  REDIS: 'Redis',
  DYNAMODB: 'DynamoDB'
};

/** What a provider's connection form asks for. */
export interface ProviderCapabilities {
  /** Host + port connect to a server; otherwise `host` holds a file path or region. */
  hostLabel: string;
  hasPort: boolean;
  hasUsername: boolean;
  hasPassword: boolean;
  hasSsl: boolean;
  /** Whether staged schema edits (ALTER/CREATE INDEX) are offered. */
  schemaEditing: boolean;
  /** Postgres, SQLite and SQL Server DDL is transactional; MySQL's is not. */
  transactionalDdl: boolean;
}

export const PROVIDER_CAPABILITIES: Record<DatabaseProviderName, ProviderCapabilities> = {
  POSTGRES: {
    hostLabel: 'Host',
    hasPort: true,
    hasUsername: true,
    hasPassword: true,
    hasSsl: true,
    schemaEditing: true,
    transactionalDdl: true
  },
  MYSQL: {
    hostLabel: 'Host',
    hasPort: true,
    hasUsername: true,
    hasPassword: true,
    hasSsl: true,
    schemaEditing: true,
    transactionalDdl: false
  },
  SQLITE: {
    hostLabel: 'File path',
    hasPort: false,
    hasUsername: false,
    hasPassword: false,
    hasSsl: false,
    schemaEditing: false,
    transactionalDdl: true
  },
  MSSQL: {
    hostLabel: 'Host',
    hasPort: true,
    hasUsername: true,
    hasPassword: true,
    hasSsl: true,
    schemaEditing: false,
    transactionalDdl: true
  },
  MONGODB: {
    hostLabel: 'Host',
    hasPort: true,
    hasUsername: true,
    hasPassword: true,
    hasSsl: true,
    schemaEditing: false,
    transactionalDdl: false
  },
  REDIS: {
    hostLabel: 'Host',
    hasPort: true,
    hasUsername: true,
    hasPassword: true,
    hasSsl: true,
    schemaEditing: false,
    transactionalDdl: false
  },
  DYNAMODB: {
    hostLabel: 'Region',
    hasPort: false,
    hasUsername: true,
    hasPassword: true,
    hasSsl: false,
    schemaEditing: false,
    transactionalDdl: false
  }
};

export interface Column {
  name: string;
  dataType: string;
  nullable: boolean;
  /** A SQL expression, ready to drop into DDL (`'draft'`, `0`, `now()`). */
  defaultValue: string | null;
  isPrimaryKey: boolean;
  /** MySQL-only column attributes a redefinition must keep, e.g. `auto_increment`. */
  extra?: string;
}

export interface ForeignKey {
  name: string;
  columns: string[];
  referencedSchema: string;
  referencedTable: string;
  referencedColumns: string[];
}

export interface Index {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface Table {
  schema: string;
  name: string;
  columns: Column[];
  primaryKeys: string[];
  foreignKeys: ForeignKey[];
  indexes: Index[];
}

export interface DatabaseSchema {
  tables: Table[];
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
  truncated: boolean;
}

/** Result sets above this are cut off before they reach the browser. */
export const MAX_RESULT_ROWS = 500;

export interface RowPage {
  columns: string[];
  rows: unknown[][];
  /** True when a row past `limit` exists, i.e. there's a next page. */
  hasMore: boolean;
}

export const FOREIGN_KEY_ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL'] as const;
export type ForeignKeyAction = (typeof FOREIGN_KEY_ACTIONS)[number];

/** Desired end state of a column; `dataType` and `defaultValue` are raw SQL. */
export interface ColumnDefinition {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
}

/**
 * One staged schema edit. Changes queue up in the browser and are applied
 * together, in order, by `applyStatements`.
 */
export type SchemaChange = { schema: string; table: string } & (
  | ({ kind: 'addColumn' } & ColumnDefinition)
  /** `column` is the column's current name; `name` may rename it. */
  | ({ kind: 'alterColumn'; column: string } & ColumnDefinition)
  | { kind: 'dropColumn'; column: string }
  | { kind: 'createIndex'; name: string; columns: string[]; unique: boolean }
  | { kind: 'dropIndex'; name: string }
  | {
      kind: 'addForeignKey';
      name: string;
      columns: string[];
      referencedSchema: string;
      referencedTable: string;
      referencedColumns: string[];
      onDelete: ForeignKeyAction;
      onUpdate: ForeignKeyAction;
    }
  | { kind: 'dropForeignKey'; name: string }
);

/** Thrown by `applyStatements`; `index` is the statement that failed. */
export class StatementFailedError extends Error {
  constructor(
    message: string,
    readonly index: number
  ) {
    super(message);
    this.name = 'StatementFailedError';
  }
}

export interface RowPageOptions {
  limit: number;
  offset: number;
  /** Raw SQL boolean expression, dropped straight into WHERE. */
  filter?: string;
  /** Plain text matched (case-insensitively, as a substring) against `searchColumns`. */
  search?: string;
  searchColumns?: string[];
  /** Per-column filters from the grid header, ANDed together and always parameterized. */
  columnFilters?: ColumnFilter[];
}

/** Escapes LIKE wildcards so a search term matches literally (both engines escape with \\). */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

/** Column name -> value. Always the whole primary key for `where`. */
export type RowValues = Record<string, unknown>;

export interface DatabaseAdapter {
  testConnection(): Promise<void>;
  /** Every database visible to these credentials at the server level. */
  listDatabases(): Promise<string[]>;
  getSchema(): Promise<DatabaseSchema>;
  /** `readOnly` is enforced by the database in a read-only transaction. */
  execute(sql: string, readOnly: boolean): Promise<QueryResult>;
  /** `filter` is a raw SQL boolean expression, dropped straight into WHERE. */
  fetchRows(schema: string, table: string, options: RowPageOptions): Promise<RowPage>;
  insertRow(schema: string, table: string, values: RowValues): Promise<void>;
  updateRow(schema: string, table: string, values: RowValues, where: RowValues): Promise<void>;
  deleteRow(schema: string, table: string, where: RowValues): Promise<void>;
  /** Runs staged row edits in one transaction: all of them land, or none do. */
  applyRowChanges(schema: string, table: string, changes: RowChange[]): Promise<void>;
  /**
   * Runs DDL in order. Postgres wraps it in one transaction; MySQL cannot
   * (DDL implicitly commits), so earlier statements stay applied on failure.
   */
  applyStatements(statements: string[]): Promise<void>;
  disconnect(): Promise<void>;
}

export function qualifiedName(table: Pick<Table, 'schema' | 'name'>): string {
  return `${table.schema}.${table.name}`;
}
