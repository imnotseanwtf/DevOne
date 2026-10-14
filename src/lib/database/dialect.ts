import { likePattern, type SqlProviderName } from '@/lib/database/types';

/** The few places SQL engines disagree, once, so builders don't branch on provider. */
export interface SqlDialect {
  quote(name: string): string;
  /** Placeholder for the nth (1-based) bound parameter. */
  placeholder(index: number): string;
  /** `value` is a LIKE pattern already bound; matches case-insensitively as text. */
  containsCondition(target: string, bound: string): string;
  /** Escapes a string for a quoted literal (MySQL treats backslash as an escape). */
  escapeString(text: string): string;
  emptyInsert(target: string): string;
}

const doubleQuote = (name: string) => `"${name.replaceAll('"', '""')}"`;

const DIALECTS: Record<SqlProviderName, SqlDialect> = {
  POSTGRES: {
    quote: doubleQuote,
    placeholder: (index) => `$${index}`,
    containsCondition: (target, bound) => `${target}::text ILIKE ${bound}`,
    escapeString: (text) => text.replaceAll("'", "''"),
    emptyInsert: (target) => `INSERT INTO ${target} DEFAULT VALUES`
  },
  MYSQL: {
    quote: (name) => `\`${name.replaceAll('`', '``')}\``,
    placeholder: () => '?',
    containsCondition: (target, bound) => `CAST(${target} AS CHAR) LIKE ${bound}`,
    escapeString: (text) => text.replaceAll('\\', '\\\\').replaceAll("'", "''"),
    emptyInsert: (target) => `INSERT INTO ${target} () VALUES ()`
  },
  SQLITE: {
    quote: doubleQuote,
    placeholder: () => '?',
    // SQLite's LIKE is case-insensitive for ASCII; ESCAPE makes `\` literal-safe.
    containsCondition: (target, bound) => `CAST(${target} AS TEXT) LIKE ${bound} ESCAPE '\\'`,
    escapeString: (text) => text.replaceAll("'", "''"),
    emptyInsert: (target) => `INSERT INTO ${target} DEFAULT VALUES`
  },
  MSSQL: {
    quote: (name) => `[${name.replaceAll(']', ']]')}]`,
    placeholder: (index) => `@p${index}`,
    containsCondition: (target, bound) =>
      `CAST(${target} AS NVARCHAR(MAX)) LIKE ${bound} ESCAPE '\\'`,
    escapeString: (text) => text.replaceAll("'", "''"),
    emptyInsert: (target) => `INSERT INTO ${target} DEFAULT VALUES`
  }
};

export function dialectOf(provider: SqlProviderName): SqlDialect {
  return DIALECTS[provider];
}

export { likePattern };
