import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { connectionSchema, serverConnectionSchema } from '../src/features/database/schema';
import { columnFilterConditions } from '../src/lib/database/column-filters';
import { dialectOf } from '../src/lib/database/dialect';
import { assertMssqlReadable } from '../src/lib/database/mssql';
import { buildRowStatement, renderRowStatement } from '../src/lib/database/row-changes';
import { decryptSecret, encryptSecret } from '../src/lib/encryption/secrets';
import { createSqliteAdapter, resolveSqlitePath } from '../src/lib/database/sqlite';
import {
  DATABASE_PROVIDERS,
  DEFAULT_PORTS,
  PROVIDER_CAPABILITIES,
  PROVIDER_LABEL,
  isSqlProvider
} from '../src/lib/database/types';

// A blank password (SQLite, open Redis/Mongo, trust-auth Postgres) must survive a round trip.
const secretKey = Buffer.alloc(32, 7);
assert.equal(decryptSecret(encryptSecret('', secretKey), secretKey), '');
assert.equal(decryptSecret(encryptSecret('pw', secretKey), secretKey), 'pw');
assert.throws(() => decryptSecret('v1.a.b', secretKey), /Invalid encrypted secret/);

// Every provider is fully described, so a new one can't be added half-wired.
for (const provider of DATABASE_PROVIDERS) {
  assert.ok(PROVIDER_LABEL[provider], `${provider} has a label`);
  assert.ok(provider in DEFAULT_PORTS, `${provider} has a default port`);
  assert.ok(PROVIDER_CAPABILITIES[provider], `${provider} has capabilities`);
  if (!isSqlProvider(provider)) assert.equal(PROVIDER_CAPABILITIES[provider].schemaEditing, false);
}

// Dialects: identifiers, placeholders and LIKE differ per engine.
assert.equal(dialectOf('POSTGRES').quote('a"b'), '"a""b"');
assert.equal(dialectOf('MYSQL').quote('a`b'), '`a``b`');
assert.equal(dialectOf('MSSQL').quote('a]b'), '[a]]b]');
assert.equal(dialectOf('MSSQL').placeholder(2), '@p2');
assert.equal(dialectOf('POSTGRES').placeholder(2), '$2');
assert.equal(dialectOf('SQLITE').placeholder(2), '?');

const update = { kind: 'update', values: { name: "O'Hara" }, where: { id: 1 } } as const;
assert.deepEqual(buildRowStatement('MSSQL', 'dbo', 'users', update), {
  sql: 'UPDATE [dbo].[users] SET [name] = @p1 WHERE [id] = @p2',
  params: ["O'Hara", 1]
});
assert.equal(
  renderRowStatement('SQLITE', 'main', 'users', update),
  `UPDATE "main"."users" SET "name" = 'O''Hara' WHERE "id" = 1;`
);
assert.equal(
  renderRowStatement('MYSQL', 's', 't', { kind: 'insert', values: { a: 'x\\y' } }),
  "INSERT INTO `s`.`t` (`a`) VALUES ('x\\\\y');"
);
const bound: unknown[] = [];
assert.deepEqual(
  columnFilterConditions('MSSQL', [{ column: 'n', operator: 'contains', value: 'a_b' }], (value) => {
    bound.push(value);
    return `@p${bound.length}`;
  }),
  ["CAST([n] AS NVARCHAR(MAX)) LIKE @p1 ESCAPE '\\'"]
);
assert.deepEqual(bound, ['%a\\_b%']);

// SQL Server has no read-only transaction, so reads are allowlisted.
assertMssqlReadable('SELECT * FROM t');
for (const bad of ['DROP TABLE t', 'EXEC xp_cmdshell 1', 'SELECT 1; EXEC sp_who', 'DELETE FROM t']) {
  assert.throws(() => assertMssqlReadable(bad), /read-only/, bad);
}

// Per-engine connection validation.
const base = {
  projectId: 'p',
  name: 'Conn',
  password: '',
  environment: 'LOCAL',
  readOnly: true
} as const;
const ok = (input: object) => connectionSchema.safeParse({ ...base, ...input }).success;
assert.ok(ok({ provider: 'SQLITE', host: '/data/app.db', port: 0, username: '' }));
assert.ok(!ok({ provider: 'SQLITE', host: 'app.db', port: 0, username: '' }), 'relative path');
assert.ok(ok({ provider: 'REDIS', host: 'cache', port: 6379, username: '' }), 'open redis');
assert.ok(ok({ provider: 'MONGODB', host: 'db', port: 27017, username: '' }), 'open mongo');
assert.ok(!ok({ provider: 'POSTGRES', host: 'db', port: 5432, username: '' }), 'pg needs a user');
assert.ok(!ok({ provider: 'POSTGRES', host: 'db', port: 0, username: 'u' }), 'pg needs a port');
assert.ok(ok({ provider: 'DYNAMODB', host: 'us-east-1', port: 0, username: 'AKIA' }));
assert.ok(!ok({ provider: 'DYNAMODB', host: 'us-east-1', port: 0, username: '' }), 'key id');
assert.ok(
  serverConnectionSchema.safeParse({
    provider: 'DYNAMODB',
    host: 'us-east-1',
    port: 0,
    username: 'AKIA',
    password: 's',
    endpoint: ''
  }).success
);

// SQLite, end to end on a throwaway file.
const dir = mkdtempSync(path.join(tmpdir(), 'devone-sqlite-'));
try {
  const file = path.join(dir, 'app.db');
  const seed = new Database(file);
  seed.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE);
    CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), title TEXT DEFAULT 'x');
    CREATE INDEX posts_user ON posts (user_id);
    INSERT INTO users (name, email) VALUES ('Ann', 'a@x.io'), ('Bob', 'b@x.io');
  `);
  seed.close();

  assert.throws(() => resolveSqlitePath('relative.db'), /absolute/);
  assert.throws(() => resolveSqlitePath(path.join(dir, 'missing.db')), /No SQLite file/);

  const adapter = createSqliteAdapter({
    host: file,
    port: 0,
    username: '',
    password: '',
    ssl: false,
    statementTimeoutMs: 1000
  });
  assert.deepEqual(await adapter.listDatabases(), ['app.db']);

  const { tables } = await adapter.getSchema();
  const posts = tables.find((table) => table.name === 'posts');
  assert.deepEqual(posts?.primaryKeys, ['id']);
  assert.equal(posts?.foreignKeys[0]?.referencedTable, 'users');
  assert.deepEqual(posts?.indexes.map((index) => index.name), ['posts_user']);
  assert.equal(tables.find((table) => table.name === 'users')?.columns[1]?.nullable, false);

  const page = await adapter.fetchRows('main', 'users', {
    limit: 1,
    offset: 0,
    search: 'x.io',
    searchColumns: ['email']
  });
  assert.equal(page.rows.length, 1);
  assert.equal(page.hasMore, true);

  await adapter.applyRowChanges('main', 'users', [
    { kind: 'insert', values: { name: 'Cy', email: 'c@x.io' } },
    { kind: 'update', values: { name: 'Bobby' }, where: { id: 2 } }
  ]);
  await assert.rejects(
    adapter.applyRowChanges('main', 'users', [
      { kind: 'delete', where: { id: 1 } },
      { kind: 'insert', values: { name: null } }
    ]),
    /Statement 2 failed/
  );
  const count = await adapter.execute('SELECT count(*) FROM users', true);
  assert.deepEqual(count.rows, [[3]], 'a failed batch leaves nothing behind');

  await assert.rejects(adapter.execute('DELETE FROM users', true), /readonly/);
  await assert.rejects(adapter.execute('CREATE TABLE t (a)', true), /readonly/);
  await adapter.execute('CREATE TABLE t (a)', false);
  await adapter.disconnect();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Opt-in integration checks, for when a service is at hand:
//   DEVONE_TEST_REDIS=host:port        DEVONE_TEST_DYNAMODB=http://host:port
if (process.env.DEVONE_TEST_REDIS) {
  const { createRedisAdapter } = await import('../src/lib/database/document/redis');
  const [host, port] = process.env.DEVONE_TEST_REDIS.split(':');
  const redis = createRedisAdapter({
    host,
    port: Number(port),
    username: '',
    password: '',
    ssl: false,
    statementTimeoutMs: 3000
  });
  const prefix = `devone-test:${Date.now()}:`;
  try {
    await redis.testConnection();
    for (let index = 0; index < 250; index += 1) {
      await redis.saveEntry('db0', 'keys', null, {
        key: `${prefix}${index}`,
        type: 'string',
        value: String(index)
      });
    }
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await redis.listEntries('db0', 'keys', {
        limit: 40,
        cursor,
        filter: `${prefix}*`
      });
      for (const entry of result.entries) seen.add(entry.id);
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(seen.size, 250, 'paging visits every key exactly once');
  } finally {
    for (const key of await redis
      .listEntries('db0', 'keys', { limit: 100, filter: `${prefix}*` })
      .then((result) => result.entries)) {
      await redis.deleteEntry('db0', 'keys', key.id);
    }
    await redis.disconnect();
  }
}

console.log('Database engine checks passed');
process.exit(0);
