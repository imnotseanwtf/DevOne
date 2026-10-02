/**
 * MySQL's `START TRANSACTION READ ONLY` refuses INSERT, UPDATE and DELETE, but
 * DDL performs an implicit commit and escapes it entirely: CREATE, DROP and
 * TRUNCATE all succeed inside a read-only transaction. PostgreSQL has no such
 * gap, because its DDL is transactional.
 *
 * So MySQL needs a second layer covering exactly that gap. The transaction
 * still blocks every form of DML, including `WITH ... DELETE`, which means this
 * layer only has to stop DDL - and every DDL statement begins with its own
 * keyword. Checking the leading keyword against an allowlist is therefore
 * sufficient here, and an allowlist cannot be slipped past the way a denylist
 * of `DROP` and friends could be.
 *
 * The driver is configured with `multipleStatements: false`, so a single
 * statement is all that can ever arrive, and a second command cannot be
 * stacked behind an allowed first one.
 */
const READ_STATEMENTS = [
  'SELECT',
  'WITH',
  'SHOW',
  'DESCRIBE',
  'DESC',
  'EXPLAIN',
  'TABLE',
  'VALUES'
];

/** Strips leading comments and whitespace so `/*x*​/ DROP ...` cannot hide the keyword. */
export function stripLeadingNoise(sql: string): string {
  let rest = sql;
  let changed = true;

  while (changed) {
    changed = false;
    const trimmed = rest.trimStart();
    if (trimmed !== rest) {
      rest = trimmed;
      changed = true;
    }
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/');
      rest = end === -1 ? '' : rest.slice(end + 2);
      changed = true;
    } else if (rest.startsWith('--') || rest.startsWith('#')) {
      const end = rest.indexOf('\n');
      rest = end === -1 ? '' : rest.slice(end + 1);
      changed = true;
    } else if (rest.startsWith('(')) {
      // A parenthesised SELECT, as in `(SELECT 1) UNION (SELECT 2)`.
      rest = rest.slice(1);
      changed = true;
    }
  }

  return rest;
}

export function leadingKeyword(sql: string): string {
  const match = /^[A-Za-z_]+/.exec(stripLeadingNoise(sql));
  return match ? match[0].toUpperCase() : '';
}

/** True when the statement only reads, judged by its leading keyword. */
export function isReadStatement(sql: string): boolean {
  return READ_STATEMENTS.includes(leadingKeyword(sql));
}
