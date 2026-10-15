/**
 * SQLite without a native add-on: the runtime's own module, `bun:sqlite` on
 * Bun and `node:sqlite` on Node 22.13 or newer. A native package would have to
 * be compiled (or downloaded) on every install, and does not load on Bun at
 * all. Only what the adapter needs is exposed: rows as arrays, column names,
 * and plain statements.
 */

export interface SqliteStatement {
  /** Result column names; empty for a statement that returns no rows. */
  columns: string[];
  values(params: unknown[]): unknown[][];
  run(params: unknown[]): void;
}

export interface SqliteDb {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

/** SQLite binds numbers, strings, bytes and null; everything else is converted first. */
export function bindable(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && !(value instanceof Uint8Array)) return JSON.stringify(value);
  return value;
}

const bind = (params: unknown[]) => params.map(bindable);

type Constructor = new (file: string, options?: unknown) => unknown;

/** The parts of node:sqlite's statement used here; the installed @types/node predates two of them. */
interface NodeStatement {
  columns(): { name: string }[];
  setReturnArrays(enabled: boolean): void;
  all(...params: never[]): unknown[];
  run(...params: never[]): unknown;
}

export async function openSqlite(
  file: string,
  options: { create?: boolean } = {}
): Promise<SqliteDb> {
  if (process.versions.bun) {
    // A variable specifier keeps the bundler from trying to resolve a Bun-only module.
    const specifier = 'bun:sqlite';
    const { Database } = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ specifier
    )) as {
      Database: Constructor;
    };
    const db = new Database(file, { readwrite: true, create: options.create ?? false }) as {
      prepare(sql: string): {
        columnNames: string[];
        values(...params: unknown[]): unknown[][];
        run(...params: unknown[]): unknown;
      };
      exec(sql: string): void;
      close(): void;
    };
    return {
      prepare(sql) {
        const statement = db.prepare(sql);
        return {
          columns: statement.columnNames,
          values: (params) => statement.values(...bind(params)),
          run: (params) => void statement.run(...bind(params))
        };
      },
      exec: (sql) => db.exec(sql),
      close: () => db.close()
    };
  }

  const { DatabaseSync } = await import('node:sqlite');
  // Unlike bun:sqlite, node:sqlite creates a missing file; the caller has checked it exists.
  const db = new DatabaseSync(file);
  return {
    prepare(sql) {
      const statement = db.prepare(sql) as unknown as NodeStatement;
      const columns = statement.columns().map((column) => column.name);
      statement.setReturnArrays(true);
      return {
        columns,
        values: (params) => statement.all(...(bind(params) as never[])) as unknown[][],
        run: (params) => void statement.run(...(bind(params) as never[]))
      };
    },
    exec: (sql) => db.exec(sql),
    close: () => db.close()
  };
}
