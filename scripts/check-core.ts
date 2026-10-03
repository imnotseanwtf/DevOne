import assert from 'node:assert/strict';
import { decryptSecret, encryptSecret, parseEncryptionKey } from '../src/lib/encryption/secrets';
import {
  createSessionToken,
  getSessionExpiry,
  hashSessionToken
} from '../src/lib/auth/session-token';
import {
  normalizeGitHubIdentity,
  normalizeGitLabBaseUrl,
  normalizeGitLabIdentity,
  getAllowedOrganizations,
  isMembershipAllowed,
  assertSafeRepositoryPath,
  decodeBase64File,
  normalizeGitHubRepository,
  normalizeGitLabRepository,
  normalizeGitHubMergeRequests,
  normalizeGitLabTree,
  sortTree,
  ProviderAuthenticationError
} from '../src/lib/git/provider';
import { toProjectSlug, withSlugSuffix } from '../src/lib/projects/slug';
import { createGitHubProvider } from '../src/lib/git/github';
import { createGitLabProvider } from '../src/lib/git/gitlab';
import { projectSchema } from '../src/features/projects/schema';
import { authRateLimitKey, nextAuthRateLimitState } from '../src/lib/auth/rate-limit';
import { decideRegistration } from '../src/lib/auth/registration-policy';
import { buildRowStatement, renderRowStatement, sqlLiteral } from '../src/lib/database/row-changes';
import { columnFilterConditions, valueKindOf } from '../src/lib/database/column-filters';
import { isNewer, isSyncedElement, pickNewer } from '../src/lib/drawings/live-sync';
import {
  compressData,
  decompressData,
  ExcalidrawImportError,
  importExcalidrawLink,
  parseExcalidrawLink
} from '../src/lib/excalidraw/import';
import { applyFolderChange, droppedFolderPath, renamedFolder } from '../src/lib/folders';
import {
  buildAuthorizeUrl,
  exchangeOAuthCode,
  getAppUrl,
  getOAuthConfig,
  OAuthExchangeError,
  oauthCallbackUrl,
  parseTokenResponse
} from '../src/lib/auth/oauth';
import { qualifiedName, type DatabaseSchema } from '../src/lib/database/types';
import { hashSchema } from '../src/lib/database/hash';
import { isReadStatement, leadingKeyword } from '../src/lib/database/read-only';
import {
  applyVariables,
  assertSafeRequestUrl,
  BlockedRequestError,
  isBlockedAddress,
  parseRequestUrl
} from '../src/lib/api-client/guard';
import { diffSchemas, isEmptyDiff, summarizeDiff } from '../src/lib/database/diff';
import { CurlParseError, parseCurl, tokenizeShell } from '../src/lib/api-client/curl';
import { openApiToCollection, parseOpenApiText } from '../src/lib/api-client/openapi';
import { isPostmanCollection, postmanToCollection } from '../src/lib/api-client/postman';
import { toCurl, toFetch } from '../src/lib/api-client/snippets';
import {
  buildOutgoingRequest,
  isInFolder,
  joinQuery,
  normalizeFolder,
  NO_AUTH,
  parseStoredAuth,
  applyPathParams,
  pathParamNames,
  authVariables,
  withEnvironmentAuth,
  withEnvironmentHeaders,
  splitQuery,
  type ApiRequestDraft
} from '../src/lib/api-client/types';

// An environment's auth stands in only for a request with no auth of its own.
{
  const envAuth = { type: 'bearer', token: 'env-token' } as const;
  const bare = { ...buildDraftForAuthCheck(), auth: { type: 'none' } as const };
  const own = { ...bare, auth: { type: 'bearer', token: 'mine' } as const };
  assert.deepEqual(withEnvironmentAuth(bare, envAuth).auth, envAuth);
  assert.deepEqual(withEnvironmentAuth(own, envAuth).auth, own.auth);
  assert.deepEqual(withEnvironmentAuth(bare, { type: 'none' }).auth, { type: 'none' });
  assert.deepEqual(authVariables(envAuth), { TOKEN: 'env-token' });
  assert.deepEqual(authVariables({ type: 'basic', username: 'u', password: 'p' }), {
    USERNAME: 'u',
    PASSWORD: 'p'
  });
  assert.deepEqual(
    authVariables({ type: 'apiKey', name: 'X-Key', value: 'k', in: 'header' }),
    { API_KEY: 'k' }
  );
}

function buildDraftForAuthCheck(): ApiRequestDraft {
  return {
    method: 'GET',
    url: 'https://api.example.com',
    headers: {},
    body: '',
    bodyType: 'NONE',
    auth: { type: 'none' },
    pathParams: {}
  };
}

// Environment headers are added, except where the request sets its own (any case).
assert.deepEqual(
  withEnvironmentHeaders({ Accept: 'x', 'X-Tenant': 'mine' }, [
    { name: 'x-devone-bypass', value: ' s3cret ' },
    { name: 'x-tenant', value: 'env' },
    { name: 'x-empty', value: '  ' }
  ]),
  { Accept: 'x', 'X-Tenant': 'mine', 'x-devone-bypass': 's3cret' }
);

// A placeholder in the origin is the environment's, not a path param.
assert.deepEqual(pathParamNames('{{baseUrl}}/api/v1/users/{{id}}?q={{term}}'), ['id']);
assert.deepEqual(pathParamNames('https://{{host}}/items/{{itemId}}'), ['itemId']);
assert.deepEqual(pathParamNames('/users/{{id}}'), ['id']);
assert.equal(
  applyPathParams('{{baseUrl}}/users/{{id}}', { baseUrl: 'https://x.com', id: 'a b' }),
  '{{baseUrl}}/users/a%20b'
);
import {
  detectMigrations,
  generateMigrationSql,
  looksLikeMigration,
  quoteIdentifier
} from '../src/lib/database/migration';
import { DATABASE_ENVIRONMENTS, DATABASE_PROVIDERS } from '../src/lib/database/types';
import {
  DatabaseEnvironment,
  DatabaseProvider,
  ResourceKind
} from '../src/generated/prisma/client';
import { RESOURCE_KINDS } from '../src/features/resources/labels';
import { finalize } from '../src/lib/database/postgres';
import { layoutErd, tableDepths } from '../src/lib/erd/layout';
import { toggleMarkdownTask } from '../src/features/git/markdown-tasks';
import { desktopDownloads, RELEASES_URL } from '../src/features/landing/desktop-release';
import {
  formatIssueKey,
  issueKeysForPrefix,
  parseIssueKeys,
  toIssuePrefix,
  withPrefixSuffix
} from '../src/lib/issues/keys';

const key = parseEncryptionKey(Buffer.alloc(32, 7).toString('base64'));
const encrypted = encryptSecret('github_pat_secret', key);

assert.notEqual(encrypted, 'github_pat_secret');
assert.equal(decryptSecret(encrypted, key), 'github_pat_secret');
assert.throws(() => decryptSecret(encrypted, Buffer.alloc(32, 8)));

assert.equal(
  hashSessionToken('session-token'),
  'c101e911469c969171040b50d70543313cf968fdef5bacc780776f8fb399ab36'
);
assert.notEqual(createSessionToken(), createSessionToken());
assert.equal(
  getSessionExpiry(new Date('2026-09-18T00:00:00.000Z')).toISOString(),
  '2026-10-18T00:00:00.000Z'
);

const fakeResolve = async (hostname: string) => {
  if (hostname === 'gitlab.com' || hostname === 'git.company.com') return ['203.0.113.10'];
  throw new Error('ENOTFOUND');
};

assert.equal(await normalizeGitLabBaseUrl('https://gitlab.com/', fakeResolve), 'https://gitlab.com');
assert.equal(
  await normalizeGitLabBaseUrl('https://git.company.com/gitlab/', fakeResolve),
  'https://git.company.com/gitlab'
);
assert.equal(
  await normalizeGitLabBaseUrl('http://git.company.com', fakeResolve),
  'http://git.company.com'
);
await assert.rejects(normalizeGitLabBaseUrl('ftp://git.company.com', fakeResolve));
await assert.rejects(normalizeGitLabBaseUrl('https://internal.invalid', fakeResolve));

// IP literals: allowed, including private ranges (on-prem GitLab) and http
// (a throwaway/local test instance may lack TLS), but never
// loopback/link-local/metadata/multicast/reserved — no resolver needed since
// IP literals skip DNS.
assert.equal(await normalizeGitLabBaseUrl('https://203.0.113.5'), 'https://203.0.113.5');
assert.equal(await normalizeGitLabBaseUrl('https://10.20.30.40'), 'https://10.20.30.40');
assert.equal(await normalizeGitLabBaseUrl('http://165.22.252.112'), 'http://165.22.252.112');
await assert.rejects(normalizeGitLabBaseUrl('https://127.0.0.1'));
await assert.rejects(normalizeGitLabBaseUrl('https://169.254.169.254'));

assert.deepEqual(normalizeGitHubIdentity({ id: 42, login: 'octocat', name: 'Mona', avatar_url: 'https://img' }), {
  provider: 'github',
  providerUserId: '42',
  username: 'octocat',
  name: 'Mona',
  avatarUrl: 'https://img',
  baseUrl: 'https://github.com'
});

assert.deepEqual(
  normalizeGitLabIdentity(
    { id: 9, username: 'fox', name: 'Fox', avatar_url: null },
    'https://git.company.com'
  ),
  {
    provider: 'gitlab',
    providerUserId: '9',
    username: 'fox',
    name: 'Fox',
    avatarUrl: null,
    baseUrl: 'https://git.company.com'
  }
);

const githubProvider = createGitHubProvider((async (input, init) => {
  assert.equal(input, 'https://api.github.com/user');
  assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-token');
  return Response.json({ id: 42, login: 'octocat', name: null, avatar_url: null });
}) as typeof fetch);
assert.equal((await githubProvider.getIdentity('test-token')).username, 'octocat');
await assert.rejects(
  createGitHubProvider((async () => new Response(null, { status: 401 })) as typeof fetch).getIdentity(
    'bad-token'
  ),
  ProviderAuthenticationError
);

const gitlabProvider = createGitLabProvider(
  'https://git.company.com/gitlab',
  (async (input, init) => {
    assert.equal(input, 'https://git.company.com/gitlab/api/v4/user');
    assert.equal(new Headers(init?.headers).get('private-token'), 'gitlab-token');
    return Response.json({ id: 9, username: 'fox', name: 'Fox', avatar_url: null });
  }) as typeof fetch
);
assert.equal((await gitlabProvider.getIdentity('gitlab-token')).providerUserId, '9');

assert.equal(toProjectSlug('  Bantay Benta API  '), 'bantay-benta-api');
assert.equal(toProjectSlug('Déjà Vu'), 'deja-vu');
assert.equal(toProjectSlug('***'), 'project');
assert.equal(withSlugSuffix('bantay-benta', 1), 'bantay-benta');
assert.equal(withSlugSuffix('bantay-benta', 2), 'bantay-benta-2');

assert.equal(projectSchema.parse({ name: '  DevOne  ', description: '' }).name, 'DevOne');
assert.equal(projectSchema.parse({ name: 'DevOne', description: '' }).description, undefined);
assert.throws(() => projectSchema.parse({ name: 'x', description: '' }));

const rateLimitStart = new Date('2026-09-18T00:00:00.000Z');
assert.equal(nextAuthRateLimitState(null, rateLimitStart).allowed, true);
assert.equal(
  nextAuthRateLimitState(
    { attempts: 10, windowStartedAt: rateLimitStart, blockedUntil: null },
    new Date('2026-09-18T00:01:00.000Z')
  ).allowed,
  false
);
assert.deepEqual(
  nextAuthRateLimitState(
    { attempts: 10, windowStartedAt: rateLimitStart, blockedUntil: null },
    new Date('2026-09-18T00:16:00.000Z')
  ).next.attempts,
  1
);

process.env.DEVONE_TRUST_PROXY = 'false';
assert.notEqual(
  authRateLimitKey('github', '198.51.100.1', 'token-one'),
  authRateLimitKey('github', '198.51.100.1', 'token-two')
);
process.env.DEVONE_TRUST_PROXY = 'true';
assert.notEqual(
  authRateLimitKey('github', '198.51.100.1', 'same-token'),
  authRateLimitKey('github', '198.51.100.2', 'same-token')
);
delete process.env.DEVONE_TRUST_PROXY;

assert.equal(decideRegistration(true, 1, false, false), 'existing');
assert.equal(decideRegistration(false, 0, false, false), 'bootstrap-disabled');
assert.equal(decideRegistration(false, 0, true, false), 'admin');
assert.equal(decideRegistration(false, 1, false, false), 'registration-disabled');
assert.equal(decideRegistration(false, 1, false, true), 'member');

assert.equal(isMembershipAllowed([], []), true);
assert.equal(isMembershipAllowed([], ['acme']), false);
assert.equal(isMembershipAllowed(['acme'], ['acme']), true);
assert.equal(isMembershipAllowed(['other'], ['acme']), false);
assert.equal(isMembershipAllowed(['acme/backend'], ['acme']), true);
assert.equal(isMembershipAllowed(['acme-evil'], ['acme']), false);

process.env.DEVONE_GITHUB_ALLOWED_ORGS = ' Acme , ,Widgets ';
assert.deepEqual(getAllowedOrganizations('github'), ['acme', 'widgets']);
delete process.env.DEVONE_GITHUB_ALLOWED_ORGS;
assert.deepEqual(getAllowedOrganizations('github'), []);

assert.equal(assertSafeRepositoryPath('/src/index.ts'), 'src/index.ts');
assert.throws(() => assertSafeRepositoryPath('src/../../etc/passwd'));
assert.throws(() => assertSafeRepositoryPath('../secrets'));
assert.equal(assertSafeRepositoryPath('a..b/c'), 'a..b/c');

assert.equal(decodeBase64File('a.txt', Buffer.from('hello').toString('base64')).text, 'hello');
assert.equal(
  decodeBase64File('big.bin', Buffer.alloc(600 * 1024).toString('base64')).truncated,
  true
);

assert.deepEqual(
  normalizeGitHubRepository({
    full_name: 'acme/api',
    name: 'api',
    default_branch: null,
    private: true,
    html_url: 'https://github.com/acme/api'
  }),
  {
    providerRepositoryId: 'acme/api',
    name: 'api',
    fullName: 'acme/api',
    defaultBranch: 'main',
    visibility: 'private',
    webUrl: 'https://github.com/acme/api'
  }
);

assert.equal(
  normalizeGitLabRepository({
    id: 42,
    name: 'api',
    path_with_namespace: 'acme/api',
    default_branch: 'trunk',
    visibility: 'internal',
    web_url: 'https://gitlab.com/acme/api'
  }).providerRepositoryId,
  '42'
);

// A merged GitHub pull reports state "closed"; DevOne distinguishes merged from closed.
assert.equal(
  normalizeGitHubMergeRequests([
    {
      number: 7,
      title: 'Add bidding',
      state: 'closed',
      merged_at: '2026-09-18T10:00:00Z',
      head: { ref: 'feature' },
      base: { ref: 'main' },
      user: { login: 'dev' },
      html_url: 'https://github.com/acme/api/pull/7',
      created_at: '2026-09-17T10:00:00Z'
    }
  ])[0].state,
  'merged'
);

assert.deepEqual(
  normalizeGitLabTree([
    { name: 'README.md', path: 'README.md', type: 'blob' },
    { name: 'src', path: 'src', type: 'tree' }
  ]).map((entry) => entry.type),
  ['dir', 'file']
);

assert.deepEqual(
  sortTree([
    { name: 'b', path: 'b', type: 'file' },
    { name: 'a', path: 'a', type: 'file' },
    { name: 'z', path: 'z', type: 'dir' }
  ]).map((entry) => entry.name),
  ['z', 'a', 'b']
);

function table(name: string, columns: string[], foreignKeys: DatabaseSchema['tables'][number]['foreignKeys'] = []) {
  return {
    schema: 'public',
    name,
    columns: columns.map((column) => ({
      name: column,
      dataType: 'text',
      nullable: false,
      defaultValue: null,
      isPrimaryKey: false
    })),
    primaryKeys: ['id'],
    foreignKeys,
    indexes: []
  };
}

const fk = (name: string, columns: string[], refTable: string, refColumns: string[]) => ({
  name,
  columns,
  referencedSchema: 'public',
  referencedTable: refTable,
  referencedColumns: refColumns
});

assert.equal(qualifiedName({ schema: 'public', name: 'users' }), 'public.users');

// finalize marks primary keys and orders tables predictably.
const finalized = finalize([table('orders', ['id', 'total']), table('users', ['id', 'email'])]);
assert.deepEqual(finalized.tables.map((t) => t.name), ['orders', 'users']);
assert.equal(finalized.tables[0].columns[0].isPrimaryKey, true);
assert.equal(finalized.tables[0].columns[1].isPrimaryKey, false);

// The hash ignores scan order so an unchanged database deduplicates its snapshot.
const schemaA: DatabaseSchema = { tables: [table('users', ['id']), table('orders', ['id'])] };
const schemaB: DatabaseSchema = { tables: [table('orders', ['id']), table('users', ['id'])] };
assert.equal(hashSchema(schemaA), hashSchema(schemaB));
assert.notEqual(
  hashSchema(schemaA),
  hashSchema({ tables: [table('users', ['id', 'added']), table('orders', ['id'])] })
);

// Referenced tables sit left of the tables referencing them.
const related: DatabaseSchema = {
  tables: [
    table('users', ['id']),
    table('orders', ['id', 'user_id'], [fk('orders_user', ['user_id'], 'users', ['id'])]),
    table('items', ['id', 'order_id'], [fk('items_order', ['order_id'], 'orders', ['id'])])
  ]
};
const depths = tableDepths(related);
assert.equal(depths.get('public.users'), 0);
assert.equal(depths.get('public.orders'), 1);
assert.equal(depths.get('public.items'), 2);

const layout = layoutErd(related);
assert.equal(layout.nodes.length, 3);
assert.equal(layout.edges.length, 2);
assert.ok(
  layout.nodes.find((n) => n.id === 'public.users')!.x <
    layout.nodes.find((n) => n.id === 'public.orders')!.x
);

// A foreign-key cycle must terminate rather than recurse forever.
const cyclic: DatabaseSchema = {
  tables: [
    table('a', ['id', 'b_id'], [fk('a_b', ['b_id'], 'b', ['id'])]),
    table('b', ['id', 'a_id'], [fk('b_a', ['a_id'], 'a', ['id'])])
  ]
};
assert.equal(layoutErd(cyclic).nodes.length, 2);

// An edge to a table outside the schema is dropped, not rendered as a dangling arrow.
const dangling: DatabaseSchema = {
  tables: [table('orders', ['id', 'user_id'], [fk('o_u', ['user_id'], 'missing', ['id'])])]
};
assert.equal(layoutErd(dangling).edges.length, 0);

// The client-safe copies must stay in step with the Prisma enums.
assert.deepEqual([...DATABASE_PROVIDERS].toSorted(), Object.values(DatabaseProvider).toSorted());
assert.deepEqual(
  [...DATABASE_ENVIRONMENTS].toSorted(),
  Object.values(DatabaseEnvironment).toSorted()
);
assert.deepEqual([...RESOURCE_KINDS].toSorted(), Object.values(ResourceKind).toSorted());

assert.equal(formatIssueKey('DEV', 142), 'DEV-142');

// Keys are found in branches, commit messages and titles alike.
assert.deepEqual(parseIssueKeys('feature/DEV-142-add-bidding'), ['DEV-142']);
assert.deepEqual(parseIssueKeys('DEV-142 Add bidding validation'), ['DEV-142']);
assert.deepEqual(parseIssueKeys('fix(dev-7): thing').sort(), ['DEV-7']);
assert.deepEqual(parseIssueKeys('DEV-1 and DEV-1 again'), ['DEV-1']);
assert.deepEqual(parseIssueKeys('no keys here').length, 0);
// Leading zeros normalise so DEV-007 and DEV-7 are the same issue.
assert.deepEqual(parseIssueKeys('DEV-007'), ['DEV-7']);

// One project must not claim another project's keys.
assert.deepEqual(issueKeysForPrefix('DEV-1 OPS-2', 'DEV'), ['DEV-1']);
assert.deepEqual(issueKeysForPrefix('DEV-1 OPS-2', 'OPS'), ['OPS-2']);
assert.deepEqual(issueKeysForPrefix('DEV-1', 'DEVOPS'), []);

assert.equal(toIssuePrefix('Bantay Benta'), 'BB');
assert.equal(toIssuePrefix('DevOne'), 'DEVON');
assert.equal(toIssuePrefix(''), 'PRJ');
assert.equal(withPrefixSuffix('DEV', 1), 'DEV');
assert.equal(withPrefixSuffix('DEV', 2), 'DEV2');
assert.notEqual(withPrefixSuffix('DEVOP', 2), 'DEVOP');

const markdownTasks = '- [ ] Duplicate\n- [ ] Duplicate\n1. [X] Numbered';
assert.equal(
  toggleMarkdownTask(markdownTasks, 1, true),
  '- [ ] Duplicate\n- [x] Duplicate\n1. [X] Numbered'
);
assert.equal(
  toggleMarkdownTask(markdownTasks, 2, false),
  '- [ ] Duplicate\n- [ ] Duplicate\n1. [ ] Numbered'
);
assert.throws(() => toggleMarkdownTask(markdownTasks, 3, true));

// Statuses, types, and priorities are dynamic per-project/board lists now
// (IssueFieldOption / BoardColumn), not fixed enums, so there is no more
// standalone advanceStatus()/enum-parity check here. The forward-only
// "git activity advances a status" comparison itself is a one-line
// `targetPosition > currentPosition` inlined in syncIssueLinks
// (src/features/issues/service.ts) — check-database.ts exercises that
// function's access control and linking, though not a live provider sync.

// Schema diff -------------------------------------------------------------
const base: DatabaseSchema = { tables: [table('users', ['id', 'email'])] };
assert.equal(isEmptyDiff(diffSchemas(base, base)), true);

const withOrders: DatabaseSchema = {
  tables: [table('users', ['id', 'email']), table('orders', ['id', 'total'])]
};
const added = diffSchemas(base, withOrders);
assert.deepEqual(added.addedTables.map((t) => t.name), ['orders']);
assert.equal(added.removedTables.length, 0);

// Reversing the comparison turns an addition into a removal.
const removed = diffSchemas(withOrders, base);
assert.deepEqual(removed.removedTables.map((t) => t.name), ['orders']);

const withColumn: DatabaseSchema = { tables: [table('users', ['id', 'email', 'phone'])] };
const columnDiff = diffSchemas(base, withColumn);
assert.deepEqual(columnDiff.changedTables[0].addedColumns.map((c) => c.name), ['phone']);
assert.deepEqual(summarizeDiff(columnDiff), ['+ public.users.phone']);

// A changed data type is reported as a modification, not an add plus a remove.
const retyped: DatabaseSchema = {
  tables: [
    {
      ...table('users', ['id', 'email']),
      columns: [
        { name: 'id', dataType: 'text', nullable: false, defaultValue: null, isPrimaryKey: false },
        { name: 'email', dataType: 'varchar(320)', nullable: false, defaultValue: null, isPrimaryKey: false }
      ]
    }
  ]
};
const typeDiff = diffSchemas(base, retyped);
assert.equal(typeDiff.changedTables[0].changedColumns.length, 1);
assert.equal(typeDiff.changedTables[0].addedColumns.length, 0);
assert.ok(summarizeDiff(typeDiff)[0].includes('→'));

// Migration SQL -----------------------------------------------------------
assert.equal(quoteIdentifier('users', 'POSTGRES'), '"users"');
assert.equal(quoteIdentifier('users', 'MYSQL'), '`users`');
// An embedded quote must not be able to terminate the identifier.
assert.equal(quoteIdentifier('we"ird', 'POSTGRES'), '"we""ird"');
assert.equal(quoteIdentifier('we`ird', 'MYSQL'), '`we``ird`');

assert.equal(generateMigrationSql(diffSchemas(base, base), 'POSTGRES'), '-- No schema changes.');

const addSql = generateMigrationSql(columnDiff, 'POSTGRES');
assert.ok(addSql.includes('ALTER TABLE "public"."users" ADD COLUMN "phone"'), addSql);

const createSql = generateMigrationSql(added, 'POSTGRES');
assert.ok(createSql.includes('CREATE TABLE "public"."orders"'), createSql);
assert.ok(createSql.includes('PRIMARY KEY ("id")'), createSql);

// Destructive statements must never be emitted ready to run.
const dropSql = generateMigrationSql(removed, 'POSTGRES');
assert.ok(dropSql.includes('-- DROP TABLE'), dropSql);
assert.ok(!/^\s*DROP TABLE/m.test(dropSql), 'DROP TABLE must stay commented out');

const dropColumnSql = generateMigrationSql(diffSchemas(withColumn, base), 'POSTGRES');
assert.ok(!/^\s*ALTER TABLE .* DROP COLUMN/m.test(dropColumnSql), dropColumnSql);

assert.ok(generateMigrationSql(typeDiff, 'MYSQL').includes('MODIFY COLUMN'));
assert.ok(generateMigrationSql(typeDiff, 'POSTGRES').includes('ALTER COLUMN'));

// Migration detection in a pull request -----------------------------------
assert.equal(looksLikeMigration('prisma/migrations/20260918_init/migration.sql'), true);
assert.equal(looksLikeMigration('db/migrate/001_create_users.rb'), true);
assert.equal(looksLikeMigration('src/Migrations/AddOrders.cs'), true);
assert.equal(looksLikeMigration('alembic/versions/abc123_add.py'), true);
assert.equal(looksLikeMigration('src/app/page.tsx'), false);
assert.deepEqual(
  detectMigrations(['README.md', 'prisma/migrations/x/migration.sql', 'src/index.ts']),
  ['prisma/migrations/x/migration.sql']
);

// API client SSRF guard ---------------------------------------------------
// Loopback, private ranges, and the cloud metadata address must all be refused.
for (const blocked of [
  '127.0.0.1',
  '127.9.9.9',
  '0.0.0.0',
  '10.1.2.3',
  '172.16.0.1',
  '172.31.255.255',
  '192.168.1.1',
  '169.254.169.254',
  '100.64.0.1',
  '::1',
  '::',
  'fd00::1',
  'fe80::1',
  '::ffff:127.0.0.1'
]) {
  assert.equal(isBlockedAddress(blocked), true, `${blocked} must be blocked`);
}

// Public addresses must still work, including ones adjacent to private ranges.
for (const allowed of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.255.255', '2606:4700::1111']) {
  assert.equal(isBlockedAddress(allowed), false, `${allowed} must be allowed`);
}

// Anything that is not an IP at all is refused rather than assumed safe.
assert.equal(isBlockedAddress('not-an-ip'), true);
assert.equal(isBlockedAddress('999.1.1.1'), true);

assert.throws(() => parseRequestUrl('file:///etc/passwd'), BlockedRequestError);
assert.throws(() => parseRequestUrl('gopher://example.com'), BlockedRequestError);
assert.throws(() => parseRequestUrl('not a url'), BlockedRequestError);
assert.equal(parseRequestUrl('https://example.com/x').hostname, 'example.com');

// A public hostname that resolves to a private address must still be refused:
// checking the name alone would miss it.
await assert.rejects(
  () => assertSafeRequestUrl('https://evil.example.com', async () => ['127.0.0.1']),
  BlockedRequestError
);
// Refused even when only one of several answers is private.
await assert.rejects(
  () => assertSafeRequestUrl('https://evil.example.com', async () => ['93.184.216.34', '10.0.0.1']),
  BlockedRequestError
);
await assert.rejects(
  () => assertSafeRequestUrl('https://nowhere.example.com', async () => []),
  BlockedRequestError
);
assert.equal(
  (await assertSafeRequestUrl('https://ok.example.com', async () => ['93.184.216.34'])).hostname,
  'ok.example.com'
);
// A literal private IP needs no DNS to be refused.
await assert.rejects(
  () => assertSafeRequestUrl('http://169.254.169.254/latest/meta-data/', async () => []),
  BlockedRequestError
);

assert.equal(applyVariables('Bearer {{TOKEN}}', { TOKEN: 'abc' }), 'Bearer abc');
assert.equal(applyVariables('{{ TOKEN }}', { TOKEN: 'abc' }), 'abc');
// An unknown placeholder is left alone rather than replaced with nothing.
assert.equal(applyVariables('{{MISSING}}', {}), '{{MISSING}}');
assert.equal(applyVariables('no placeholders', { A: 'b' }), 'no placeholders');

// API client: outgoing request -------------------------------------------------

const baseDraft: ApiRequestDraft = {
  method: 'POST',
  url: 'https://api.example.com/users?page=1',
  headers: { Accept: 'application/json' },
  body: '{"name":"{{NAME}}"}',
  bodyType: 'JSON',
  auth: NO_AUTH,
  pathParams: {}
};
const resolveTest = (text: string) =>
  applyVariables(text, { NAME: 'Ada', TOKEN: 't0k', USER: 'u', PASS: 'p' });

{
  const outgoing = buildOutgoingRequest(
    { ...baseDraft, auth: { type: 'bearer', token: '{{TOKEN}}' } },
    resolveTest
  );
  assert.equal(outgoing.headers.Authorization, 'Bearer t0k');
  assert.equal(outgoing.headers['Content-Type'], 'application/json');
  assert.equal(outgoing.body, '{"name":"Ada"}');
}
assert.equal(
  buildOutgoingRequest(
    { ...baseDraft, auth: { type: 'basic', username: '{{USER}}', password: '{{PASS}}' } },
    resolveTest
  ).headers.Authorization,
  `Basic ${btoa('u:p')}`
);
assert.equal(
  buildOutgoingRequest({
    ...baseDraft,
    auth: { type: 'apiKey', name: 'key', value: 'abc', in: 'query' }
  }).url,
  'https://api.example.com/users?page=1&key=abc'
);
// A hand-set header wins over auth and the body type's default.
{
  const outgoing = buildOutgoingRequest({
    ...baseDraft,
    headers: { authorization: 'Custom x', 'content-type': 'text/csv' },
    auth: { type: 'bearer', token: 'ignored' }
  });
  assert.equal(outgoing.headers.authorization, 'Custom x');
  assert.equal(outgoing.headers.Authorization, undefined);
  assert.equal(outgoing.headers['Content-Type'], undefined);
}
// GET and HEAD never send a body; neither does the NONE body type.
assert.equal(buildOutgoingRequest({ ...baseDraft, method: 'GET' }).body, undefined);
assert.equal(buildOutgoingRequest({ ...baseDraft, bodyType: 'NONE' }).body, undefined);
assert.equal(
  buildOutgoingRequest({ ...baseDraft, bodyType: 'NONE' }).headers['Content-Type'],
  undefined
);

assert.deepEqual(parseStoredAuth(null), NO_AUTH);
assert.deepEqual(parseStoredAuth({ type: 'bearer' }), NO_AUTH);
assert.deepEqual(parseStoredAuth({ type: 'bearer', token: 'x' }), { type: 'bearer', token: 'x' });

// API client: URL <-> params ---------------------------------------------------

assert.deepEqual(splitQuery('https://a.com/x?q=hello%20world&id={{id}}&flag'), {
  base: 'https://a.com/x',
  params: [
    { key: 'q', value: 'hello world' },
    { key: 'id', value: '{{id}}' },
    { key: 'flag', value: '' }
  ]
});
assert.equal(
  joinQuery('https://a.com/x', [
    { key: 'q', value: 'a b&c' },
    { key: '', value: 'ignored' },
    { key: 'id', value: '{{id}}' }
  ]),
  'https://a.com/x?q=a%20b%26c&id={{id}}'
);
assert.equal(joinQuery('https://a.com/x', []), 'https://a.com/x');

// API client: curl import ------------------------------------------------------

assert.deepEqual(tokenizeShell(`curl 'a b' "c \\"d\\"" e\\ f $'g\\nh'`), [
  'curl',
  'a b',
  'c "d"',
  'e f',
  'g\nh'
]);
assert.deepEqual(tokenizeShell('curl \\\n  -X POST'), ['curl', '-X', 'POST']);

{
  const draft = parseCurl(`curl 'https://api.example.com/users' \\
    -H 'Content-Type: application/json' \\
    -H "Authorization: Bearer abc" \\
    --data-raw '{"name":"Ada"}' \\
    --compressed`);
  assert.equal(draft.method, 'POST');
  assert.equal(draft.url, 'https://api.example.com/users');
  assert.equal(draft.headers['Content-Type'], 'application/json');
  assert.equal(draft.headers.Authorization, 'Bearer abc');
  assert.equal(draft.body, '{"name":"Ada"}');
  assert.equal(draft.bodyType, 'JSON');
}
{
  const draft = parseCurl('curl -XDELETE -u admin:secret api.example.com/users/1');
  assert.equal(draft.method, 'DELETE');
  assert.equal(draft.url, 'https://api.example.com/users/1');
  assert.deepEqual(draft.auth, { type: 'basic', username: 'admin', password: 'secret' });
  assert.equal(draft.bodyType, 'NONE');
}
{
  const draft = parseCurl('curl -d a=1 -d b=2 https://x.com/form');
  assert.equal(draft.method, 'POST');
  assert.equal(draft.body, 'a=1&b=2');
  assert.equal(draft.bodyType, 'FORM');
}
assert.equal(parseCurl('curl -G -d q=1 https://x.com/s').url, 'https://x.com/s?q=1');
assert.equal(parseCurl('curl -G -d q=1 https://x.com/s').method, 'GET');
assert.equal(parseCurl('curl -sSL -I https://x.com').method, 'HEAD');
assert.equal(parseCurl('curl -o out.json https://x.com/file').url, 'https://x.com/file');
assert.throws(() => parseCurl('wget https://x.com'), CurlParseError);
assert.throws(() => parseCurl('curl -X POST'), CurlParseError);
assert.throws(() => parseCurl("curl 'unclosed"), CurlParseError);

// API client: snippets round-trip through the curl parser ------------------------

{
  const draft: ApiRequestDraft = {
    method: 'PATCH',
    url: 'https://api.example.com/users/{{id}}',
    headers: { 'X-Trace': "it's" },
    body: '{"name":"Ada"}',
    bodyType: 'JSON',
    auth: { type: 'bearer', token: '{{TOKEN}}' },
    pathParams: {}
  };
  const curl = toCurl(draft);
  assert.match(curl, /--header 'Authorization: Bearer \{\{TOKEN\}\}'/);
  const parsed = parseCurl(curl);
  assert.equal(parsed.method, 'PATCH');
  assert.equal(parsed.url, draft.url);
  assert.equal(parsed.headers['X-Trace'], "it's");
  assert.equal(parsed.body, draft.body);

  const fetchSnippet = toFetch(draft);
  assert.match(fetchSnippet, /method: "PATCH"/);
  assert.match(fetchSnippet, /body: JSON\.stringify\(\{/);
  assert.match(fetchSnippet, /response\.json\(\)/);
}
assert.equal(
  toCurl({ ...baseDraft, method: 'GET', headers: {}, auth: NO_AUTH }),
  "curl 'https://api.example.com/users?page=1'"
);
assert.match(
  toCurl({ ...baseDraft, auth: { type: 'basic', username: 'u', password: 'p' } }),
  /--user 'u:p'/
);

// API client: OpenAPI import ---------------------------------------------------

{
  const collection = openApiToCollection(
    parseOpenApiText(`
openapi: 3.0.0
info: { title: Pets }
servers: [{ url: 'https://{env}.pets.dev/v1', variables: { env: { default: api } } }]
security: [{ bearer: [] }]
components:
  securitySchemes: { bearer: { type: http, scheme: bearer } }
  schemas:
    Pet:
      type: object
      properties:
        name: { type: string, example: Rex }
        age: { type: integer }
        tags: { type: array, items: { type: string } }
paths:
  /pets:
    get:
      summary: List pets
      parameters: [{ name: limit, in: query, required: true, schema: { type: integer, default: 10 } }]
    post:
      operationId: createPet
      requestBody:
        content:
          application/json: { schema: { $ref: '#/components/schemas/Pet' } }
  /pets/{petId}:
    delete: { security: [] }
`)
  );
  assert.equal(collection.title, 'Pets');
  assert.equal(collection.requests.length, 3);

  const [list, create, remove] = collection.requests;
  assert.equal(list.name, 'List pets');
  assert.equal(list.url, 'https://api.pets.dev/v1/pets?limit=10');
  assert.deepEqual(list.auth, { type: 'bearer', token: '{{TOKEN}}' });

  assert.equal(create.name, 'createPet');
  assert.equal(create.bodyType, 'JSON');
  assert.deepEqual(JSON.parse(create.body), { name: 'Rex', age: 0, tags: ['string'] });

  // No summary: the path is the name (no shared prefix here, since `/pets` is itself a path).
  assert.equal(remove.name, '/pets/{petId}');
  assert.equal(list.folder, null);
  assert.equal(remove.url, 'https://api.pets.dev/v1/pets/{{petId}}');
  assert.deepEqual(remove.auth, NO_AUTH);
}
{
  const swagger = openApiToCollection(
    parseOpenApiText(
      JSON.stringify({
        swagger: '2.0',
        info: { title: 'Legacy' },
        host: 'legacy.dev',
        basePath: '/api',
        schemes: ['https'],
        paths: {
          '/items': {
            post: { parameters: [{ in: 'body', name: 'b', schema: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } }] }
          }
        }
      })
    )
  );
  assert.equal(swagger.requests[0].url, 'https://legacy.dev/api/items');
  assert.deepEqual(JSON.parse(swagger.requests[0].body), {
    id: '00000000-0000-0000-0000-000000000000'
  });
}
// A relative server resolves against the URL the document came from.
assert.equal(
  openApiToCollection(
    parseOpenApiText('{"openapi":"3.1.0","servers":[{"url":"/v2"}],"paths":{"/a":{"get":{}}}}'),
    'https://docs.example.com/openapi.json'
  ).requests[0].url,
  'https://docs.example.com/v2/a'
);
assert.equal(
  openApiToCollection(parseOpenApiText('{"openapi":"3.1.0","paths":{"/a":{"get":{}}}}')).requests[0]
    .url,
  '{{baseUrl}}/a'
);
// Swashbuckle-style: tags become folders, the shared `/api/v1` is dropped from
// names, the download host stands in for the missing `servers`, and each
// request carries its parameters, body and responses as docs.
{
  const collection = openApiToCollection(
    parseOpenApiText(
      JSON.stringify({
        openapi: '3.0.4',
        info: { title: 'Shop.Api' },
        paths: {
          '/api/v1/auth/login': {
            post: {
              tags: ['Auth'],
              requestBody: {
                required: true,
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } }
                }
              },
              responses: {
                '401': { description: 'Unauthorized' },
                '200': {
                  description: 'OK',
                  content: {
                    'text/plain': { schema: { $ref: '#/components/schemas/LoginResult' } },
                    'application/json': { schema: { $ref: '#/components/schemas/LoginResult' } }
                  }
                }
              }
            }
          },
          '/api/v1/stores/{storeId}/products': {
            get: {
              tags: [' Store / Products '],
              parameters: [
                { name: 'storeId', in: 'path', schema: { type: 'string', format: 'uuid' } },
                { name: 'Page', in: 'query', description: 'Starts at 1', schema: { type: 'integer', format: 'int32' } }
              ],
              responses: { '200': { description: 'OK' } }
            }
          }
        },
        components: {
          schemas: {
            LoginRequest: {
              type: 'object',
              required: ['email'],
              properties: {
                email: { type: 'string', format: 'email' },
                password: { type: 'string', nullable: true }
              }
            },
            LoginResult: {
              type: 'object',
              properties: {
                token: { type: 'string' },
                user: { $ref: '#/components/schemas/User' }
              }
            },
            User: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['ADMIN', 'MEMBER'] },
                manager: { $ref: '#/components/schemas/User' }
              }
            }
          }
        }
      })
    ),
    'https://staging-api.shop.dev/swagger/v1/swagger.json'
  );

  const [login, products] = collection.requests;
  assert.equal(login.name, '/auth/login');
  assert.equal(login.folder, 'Auth');
  assert.equal(login.url, 'https://staging-api.shop.dev/api/v1/auth/login');
  assert.equal(products.folder, 'Store/Products');
  assert.equal(products.url, 'https://staging-api.shop.dev/api/v1/stores/{{storeId}}/products');

  const body = login.docs.requestBody;
  assert.equal(body?.contentType, 'application/json');
  assert.equal(body?.required, true);
  assert.equal(body?.type, 'LoginRequest');
  assert.deepEqual(body?.fields, [
    { name: 'email', type: 'string (email)', required: true },
    { name: 'password', type: 'string', nullable: true }
  ]);
  assert.deepEqual(JSON.parse(body?.example ?? ''), {
    email: 'user@example.com',
    password: 'string'
  });

  // Responses are sorted, JSON wins over text/plain, and a self-reference stops.
  assert.deepEqual(
    login.docs.responses.map((response) => response.status),
    ['200', '401']
  );
  const ok = login.docs.responses[0];
  assert.equal(ok.contentType, 'application/json');
  assert.equal(ok.type, 'LoginResult');
  const user = ok.fields?.find((field) => field.name === 'user');
  assert.equal(user?.type, 'User');
  assert.deepEqual(user?.children?.[0], { name: 'role', type: 'string', enum: ['ADMIN', 'MEMBER'] });
  assert.equal(user?.children?.[1].name, 'manager');
  assert.equal(user?.children?.[1].children, undefined);
  assert.equal(login.docs.responses[1].fields, undefined);

  assert.deepEqual(products.docs.parameters, [
    { name: 'storeId', in: 'path', required: true, type: 'string (uuid)' },
    { name: 'Page', in: 'query', required: false, type: 'integer (int32)', description: 'Starts at 1' }
  ]);
  assert.equal(products.docs.requestBody, undefined);
}

assert.equal(normalizeFolder(' Store / /Products/ '), 'Store/Products');
assert.equal(normalizeFolder('  '), null);
assert.equal(normalizeFolder(null), null);
assert.equal(isInFolder('Store/Products', 'Store'), true);
assert.equal(isInFolder('Store', 'Store'), true);
assert.equal(isInFolder('Stores', 'Store'), false);
assert.equal(isInFolder(null, 'Store'), false);

assert.throws(() => parseOpenApiText('{"hello":"world"}'), /not an OpenAPI/);
assert.throws(() => parseOpenApiText('{ nope'), /not valid JSON or YAML/);

// MySQL read-only DDL guard -----------------------------------------------
// MySQL DDL implicitly commits and escapes a read-only transaction, so the
// leading keyword has to carry that case. Reads must still be allowed.
for (const sql of [
  'SELECT 1',
  'select * from users',
  '  SELECT 1',
  '(SELECT 1) UNION (SELECT 2)',
  'WITH cte AS (SELECT 1) SELECT * FROM cte',
  'SHOW TABLES',
  'DESCRIBE users',
  'EXPLAIN SELECT 1',
  'TABLE users',
  '/* comment */ SELECT 1',
  '-- note\nSELECT 1'
]) {
  assert.equal(isReadStatement(sql), true, `should allow: ${sql}`);
}

for (const sql of [
  'CREATE TABLE t (id INT)',
  'DROP TABLE users',
  'TRUNCATE TABLE users',
  'ALTER TABLE users ADD COLUMN x INT',
  'RENAME TABLE a TO b',
  'GRANT ALL ON *.* TO x',
  'INSERT INTO users VALUES (1)',
  'UPDATE users SET id = 1',
  'DELETE FROM users',
  'REPLACE INTO users VALUES (1)',
  'CALL some_procedure()',
  'SET GLOBAL x = 1'
]) {
  assert.equal(isReadStatement(sql), false, `should refuse: ${sql}`);
}

// A comment must not be able to hide the real leading keyword.
assert.equal(isReadStatement('/* SELECT */ DROP TABLE users'), false);
assert.equal(isReadStatement('-- SELECT\nDROP TABLE users'), false);
assert.equal(isReadStatement('# SELECT\nDROP TABLE users'), false);
assert.equal(isReadStatement('/* a */ /* b */ DROP TABLE users'), false);
assert.equal(isReadStatement('   \n\t /* x */ TRUNCATE TABLE users'), false);
assert.equal(isReadStatement(''), false);
assert.equal(isReadStatement('/* unterminated'), false);

assert.equal(leadingKeyword('drop table x'), 'DROP');
assert.equal(leadingKeyword('/* c */ select 1'), 'SELECT');
assert.equal(leadingKeyword(''), '');

// OAuth sign-in: configuration, authorize URL, and token responses.
assert.equal(getOAuthConfig('github', {}), null);
assert.equal(getOAuthConfig('gitlab', { DEVONE_GITLAB_CLIENT_ID: 'id' }), null);
const githubOAuth = getOAuthConfig('github', {
  DEVONE_GITHUB_CLIENT_ID: 'gh-id',
  DEVONE_GITHUB_CLIENT_SECRET: 'gh-secret'
});
assert.ok(githubOAuth);
assert.equal(githubOAuth.scope, 'repo read:org read:user');
const gitlabOAuth = getOAuthConfig('gitlab', {
  DEVONE_GITLAB_CLIENT_ID: 'gl-id',
  DEVONE_GITLAB_CLIENT_SECRET: 'gl-secret',
  DEVONE_GITLAB_OAUTH_URL: 'https://gitlab.example.com/'
});
assert.equal(gitlabOAuth?.tokenUrl, 'https://gitlab.example.com/oauth/token');
assert.equal(gitlabOAuth?.baseUrl, 'https://gitlab.example.com');

assert.equal(getAppUrl({}), null);
assert.equal(getAppUrl({ DEVONE_APP_URL: 'https://devone.example.com/' }), 'https://devone.example.com');
assert.equal(getAppUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'dev-one.vercel.app' }), 'https://dev-one.vercel.app');
assert.equal(
  oauthCallbackUrl('https://devone.example.com', 'gitlab'),
  'https://devone.example.com/api/auth/gitlab/callback'
);

const authorize = new URL(buildAuthorizeUrl(githubOAuth, 'https://app/cb', 'state-123'));
assert.equal(authorize.origin + authorize.pathname, 'https://github.com/login/oauth/authorize');
assert.equal(authorize.searchParams.get('client_id'), 'gh-id');
assert.equal(authorize.searchParams.get('redirect_uri'), 'https://app/cb');
assert.equal(authorize.searchParams.get('state'), 'state-123');
assert.equal(authorize.searchParams.get('client_secret'), null);
assert.equal(
  new URL(buildAuthorizeUrl(gitlabOAuth!, 'https://app/cb', 's')).searchParams.get('response_type'),
  'code'
);

const issuedAt = new Date('2026-01-01T00:00:00Z');
assert.deepEqual(parseTokenResponse({ access_token: 'gho_x', token_type: 'bearer' }, issuedAt), {
  accessToken: 'gho_x',
  refreshToken: null,
  expiresAt: null
});
assert.deepEqual(
  parseTokenResponse({ access_token: 'a', refresh_token: 'r', expires_in: 7200 }, issuedAt),
  { accessToken: 'a', refreshToken: 'r', expiresAt: new Date('2026-01-01T02:00:00Z') }
);
assert.throws(
  () => parseTokenResponse({ error: 'bad_verification_code', error_description: 'The code is incorrect.' }),
  (error: unknown) => error instanceof OAuthExchangeError && error.message === 'The code is incorrect.'
);

const exchanged = await exchangeOAuthCode(githubOAuth, 'code-1', 'https://app/cb', async (url, init) => {
  assert.equal(String(url), 'https://github.com/login/oauth/access_token');
  const body = new URLSearchParams(String(init?.body));
  assert.equal(body.get('code'), 'code-1');
  assert.equal(body.get('client_secret'), 'gh-secret');
  assert.equal(body.get('grant_type'), 'authorization_code');
  return Response.json({ access_token: 'gho_token' });
});
assert.equal(exchanged.accessToken, 'gho_token');

// Staged table edits: what the adapters run, and what the review dialog shows.
assert.deepEqual(
  buildRowStatement('POSTGRES', 'public', 'users', {
    kind: 'update',
    values: { first_name: 'Sean', middle_name: null },
    where: { id: 'u1' }
  }),
  {
    sql: 'UPDATE "public"."users" SET "first_name" = $1, "middle_name" = $2 WHERE "id" = $3',
    params: ['Sean', null, 'u1']
  }
);
assert.deepEqual(
  buildRowStatement('MYSQL', 'shop', 'orders', { kind: 'delete', where: { id: 7, tenant: 'a' } }),
  { sql: 'DELETE FROM `shop`.`orders` WHERE `id` = ? AND `tenant` = ?', params: [7, 'a'] }
);
assert.equal(
  buildRowStatement('POSTGRES', 'public', 'logs', { kind: 'insert', values: {} }).sql,
  'INSERT INTO "public"."logs" DEFAULT VALUES'
);
assert.equal(
  renderRowStatement('POSTGRES', 'public', 'users', {
    kind: 'insert',
    values: { name: "O'Brien", active: true, age: 30 }
  }),
  `INSERT INTO "public"."users" ("name", "active", "age") VALUES ('O''Brien', TRUE, 30);`
);
// A column named like a placeholder must not be mistaken for one.
assert.equal(
  renderRowStatement('MYSQL', 'db', 't', { kind: 'update', values: { 'why?': 'x' }, where: { id: 1 } }),
  "UPDATE `db`.`t` SET `why?` = 'x' WHERE `id` = 1;"
);
assert.equal(sqlLiteral('a\\b', 'MYSQL'), "'a\\\\b'");
assert.equal(sqlLiteral('a\\b', 'POSTGRES'), "'a\\b'");
assert.equal(sqlLiteral({ tags: ['x'] }, 'POSTGRES'), `'{"tags":["x"]}'`);

// Column filters: every value is bound, never inlined.
{
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  assert.deepEqual(
    columnFilterConditions(
      'POSTGRES',
      [
        { column: 'created_at', operator: 'between', value: '2026-01-01', valueTo: '2026-02-01' },
        { column: 'name', operator: 'contains', value: "50%_off'" },
        { column: 'deleted_at', operator: 'isNull' }
      ],
      bind
    ),
    [
      '"created_at" BETWEEN $1 AND $2',
      '"name"::text ILIKE $3',
      '"deleted_at" IS NULL'
    ]
  );
  assert.deepEqual(params, ['2026-01-01', '2026-02-01', "%50\\%\\_off'%"]);
  assert.deepEqual(
    columnFilterConditions('MYSQL', [{ column: 'price', operator: 'gte', value: '10' }], () => '?'),
    ['`price` >= ?']
  );
}
assert.equal(valueKindOf('timestamp with time zone'), 'datetime');
assert.equal(valueKindOf('datetime(3)'), 'datetime');
assert.equal(valueKindOf('date'), 'date');
assert.equal(valueKindOf('boolean'), 'boolean');
assert.equal(valueKindOf('text'), 'text');

// Renaming a folder carries nested folders along, and leaves look-alikes alone.
assert.equal(renamedFolder('Design', 'Design', 'UX'), 'UX');
assert.equal(renamedFolder('Design/Flows/Checkout', 'Design', 'UX'), 'UX/Flows/Checkout');
assert.equal(renamedFolder('Designs', 'Design', 'UX'), 'Designs');
assert.equal(renamedFolder(null, 'Design', 'UX'), null);

// Dragging a folder into another nests it; into itself, a child or its own parent is a no-op.
assert.equal(droppedFolderPath('Flows', 'Design'), 'Design/Flows');
assert.equal(droppedFolderPath('Design/Flows', null), 'Flows');
assert.equal(droppedFolderPath('Design/Flows', 'Archive/2025'), 'Archive/2025/Flows');
assert.equal(droppedFolderPath('Design', 'Design'), null);
assert.equal(droppedFolderPath('Design', 'Design/Flows'), null);
assert.equal(droppedFolderPath('Design/Flows', 'Design'), null);
assert.equal(droppedFolderPath('Flows', null), null);
assert.equal(droppedFolderPath('Design', 'Designs'), 'Designs/Design');

// Optimistic folder changes mirror what the server does.
{
  const state = {
    items: [
      { id: 'a', folder: 'Design' },
      { id: 'b', folder: 'Design/Flows' },
      { id: 'c', folder: null }
    ],
    folders: ['Design', 'Design/Flows', 'Empty']
  };
  assert.deepEqual(applyFolderChange(state, { type: 'move', id: 'c', folder: 'New' }), {
    items: [state.items[0], state.items[1], { id: 'c', folder: 'New' }],
    folders: ['Design', 'Design/Flows', 'Empty', 'New']
  });
  assert.deepEqual(applyFolderChange(state, { type: 'renameFolder', from: 'Design', to: 'Empty/UX' }), {
    items: [
      { id: 'a', folder: 'Empty/UX' },
      { id: 'b', folder: 'Empty/UX/Flows' },
      { id: 'c', folder: null }
    ],
    folders: ['Empty/UX', 'Empty/UX/Flows', 'Empty']
  });
  assert.deepEqual(applyFolderChange(state, { type: 'deleteFolder', path: 'Design' }), {
    items: [{ id: 'c', folder: null }],
    folders: ['Empty']
  });
  assert.deepEqual(applyFolderChange(state, { type: 'delete', id: 'a' }).items.map((i) => i.id), ['b', 'c']);
  assert.deepEqual(applyFolderChange(state, { type: 'createFolder', path: 'Empty' }).folders, state.folders);
}

// Excalidraw links: parsing, and reading data framed/encrypted the way Excalidraw writes it.
{
  const key = 'LCU1WMIavPsGD924cvTKnQ';
  assert.deepEqual(parseExcalidrawLink(`https://excalidraw.com/#room=98c1112c9900085d81cf,${key}`), {
    kind: 'room',
    id: '98c1112c9900085d81cf',
    key
  });
  assert.deepEqual(parseExcalidrawLink(`https://excalidraw.com/#json=aBcD_12-x,${key}`), {
    kind: 'json',
    id: 'aBcD_12-x',
    key
  });
  assert.equal(parseExcalidrawLink('https://excalidraw.com/'), null);
  assert.equal(parseExcalidrawLink('#room=../../etc,short'), null);

  const scene = { elements: [{ id: 'a', type: 'rectangle' }], appState: { viewBackgroundColor: '#fff' } };
  const packed = await compressData(new TextEncoder().encode(JSON.stringify(scene)), key, { v: 1 });
  const { metadata, data } = await decompressData(packed, key);
  assert.deepEqual(metadata, { v: 1 });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(data)), scene);
  await assert.rejects(
    decompressData(packed, 'AAAAAAAAAAAAAAAAAAAAAA'),
    (error: unknown) => error instanceof ExcalidrawImportError
  );

  // End to end with Excalidraw's servers faked: a shareable link and a live room.
  const realFetch = globalThis.fetch;
  const roomElements = [
    { id: 'r1', type: 'ellipse' },
    { id: 'gone', type: 'line', isDeleted: true }
  ];
  const roomKey = await crypto.subtle.importKey(
    'jwk',
    { alg: 'A128GCM', ext: true, k: key, key_ops: ['encrypt', 'decrypt'], kty: 'oct' },
    { name: 'AES-GCM', length: 128 },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      roomKey,
      new TextEncoder().encode(JSON.stringify(roomElements))
    )
  );
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url === 'https://json.excalidraw.com/api/v2/share1') return new Response(packed);
    if (url.includes('/documents/scenes/98c1112c9900085d81cf')) {
      return Response.json({
        fields: {
          iv: { bytesValue: Buffer.from(iv).toString('base64') },
          ciphertext: { bytesValue: Buffer.from(ciphertext).toString('base64') }
        }
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  try {
    const shared = await importExcalidrawLink({ kind: 'json', id: 'share1', key });
    assert.deepEqual(shared.elements, scene.elements);
    assert.equal(shared.appState.viewBackgroundColor, '#fff');
    const room = await importExcalidrawLink({ kind: 'room', id: '98c1112c9900085d81cf', key });
    assert.deepEqual(room.elements, [{ id: 'r1', type: 'ellipse' }]);
    await assert.rejects(
      importExcalidrawLink({ kind: 'room', id: 'emptyroom', key }),
      (error: unknown) => error instanceof ExcalidrawImportError && /Nothing is saved/.test(error.message)
    );
    assert.ok(requested.every((url) => /^https:\/\/(json\.excalidraw\.com|firestore\.googleapis\.com)\//.test(url)));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// Live sync merges the way Excalidraw does: higher version wins, then lower versionNonce.
{
  assert.equal(isNewer({ version: 3, versionNonce: 9 }, { version: 2, versionNonce: 1 }), true);
  assert.equal(isNewer({ version: 2, versionNonce: 1 }, { version: 3, versionNonce: 9 }), false);
  assert.equal(isNewer({ version: 3, versionNonce: 1 }, { version: 3, versionNonce: 9 }), true);
  assert.equal(isNewer({ version: 3, versionNonce: 9 }, { version: 3, versionNonce: 1 }), false);
  assert.equal(isNewer({ version: 1, versionNonce: 1 }, undefined), true);
  const stored = new Map([['a', { version: 5, versionNonce: 10 }]]);
  const shape = (id: string, version: number, versionNonce: number) => ({
    id,
    type: 'rectangle',
    version,
    versionNonce
  });
  assert.deepEqual(
    pickNewer(stored, [shape('a', 4, 1), shape('b', 1, 1)]).map((e) => e.id),
    ['b']
  );
  assert.deepEqual(pickNewer(stored, [shape('a', 6, 1), shape('a', 7, 1)]), [shape('a', 7, 1)]);
  assert.equal(isSyncedElement(shape('x', 1, 1)), true);
  assert.equal(isSyncedElement({ id: 'x', type: 'rectangle', version: 1.5, versionNonce: 1 }), false);
  assert.equal(isSyncedElement({ id: '', type: 'rectangle', version: 1, versionNonce: 1 }), false);
  assert.equal(isSyncedElement(null), false);
}

// Postman collections (v2.1 arrays and v2.0 objects) become DevOne requests.
{
  const collection = {
    info: {
      name: 'Shop API',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{TOKEN}}' }] },
    variable: [
      { key: 'baseUrl', value: 'https://api.shop.test' },
      { key: 'TOKEN', value: 'abc' },
      { key: 'bad key!', value: 'x' }
    ],
    item: [
      {
        name: 'Products',
        item: [
          {
            name: 'Get product',
            request: {
              method: 'GET',
              header: [
                { key: 'Accept', value: 'application/json' },
                { key: 'X-Off', value: '1', disabled: true }
              ],
              url: {
                raw: '{{baseUrl}}/products/:id?expand=tags',
                host: ['{{baseUrl}}'],
                path: ['products', ':id'],
                query: [
                  { key: 'expand', value: 'tags' },
                  { key: 'debug', value: '1', disabled: true }
                ],
                variable: [{ key: 'id', value: '42' }]
              }
            }
          },
          {
            name: 'Create product',
            request: {
              method: 'POST',
              auth: { type: 'noauth' },
              body: { mode: 'raw', raw: '{"name":"Mug"}', options: { raw: { language: 'json' } } },
              url: '{{baseUrl}}/products'
            }
          }
        ]
      },
      {
        name: 'Login',
        request: {
          method: 'POST',
          auth: { type: 'basic', basic: { username: 'me', password: 'pw' } },
          body: {
            mode: 'urlencoded',
            urlencoded: [
              { key: 'grant_type', value: 'password' },
              { key: 'skip', value: 'x', disabled: true }
            ]
          },
          url: 'https://auth.shop.test/token'
        }
      }
    ]
  };
  assert.equal(isPostmanCollection(collection), true);
  assert.equal(isPostmanCollection({ openapi: '3.1.0', paths: {} }), false);
  const imported = postmanToCollection(collection);
  assert.equal(imported.title, 'Shop API');
  assert.deepEqual(imported.variables, [
    { key: 'baseUrl', value: 'https://api.shop.test' },
    { key: 'TOKEN', value: 'abc' }
  ]);
  const [get, create, login] = imported.requests;
  assert.equal(get.folder, 'Products');
  assert.equal(get.url, '{{baseUrl}}/products/{{id}}?expand=tags');
  assert.deepEqual(get.pathParams, { id: '42' });
  assert.deepEqual(get.headers, { Accept: 'application/json' });
  assert.deepEqual(get.auth, { type: 'bearer', token: '{{TOKEN}}' });
  assert.equal(create.bodyType, 'JSON');
  assert.equal(create.body, '{"name":"Mug"}');
  assert.deepEqual(create.auth, { type: 'none' });
  assert.equal(login.folder, null);
  assert.equal(login.bodyType, 'FORM');
  assert.equal(login.body, 'grant_type=password');
  assert.deepEqual(login.auth, { type: 'basic', username: 'me', password: 'pw' });
  assert.throws(
    () => postmanToCollection({ info: { name: 'Empty', schema: 'https://schema.getpostman.com/x' }, item: [] }),
    /no requests/
  );
}

// CI pipelines of a merge request, their jobs, and job logs.
{
  const { tailJobLog, JOB_LOG_LIMIT } = await import('../src/lib/git/provider');
  const short = tailJobLog('line 1\nline 2');
  assert.deepEqual(short, { text: 'line 1\nline 2', truncated: false, available: true });
  const long = tailJobLog(`${'x'.repeat(JOB_LOG_LIMIT)}\nlast line`);
  assert.equal(long.truncated, true);
  assert.equal(long.text, 'last line');

  const calls: string[] = [];
  const github = createGitHubProvider((async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://api.github.com/repos/acme/app/pulls/7') {
      return Response.json({ head: { sha: 'abc123' } });
    }
    if (url === 'https://api.github.com/repos/acme/app/actions/runs?head_sha=abc123&per_page=20') {
      return Response.json({
        workflow_runs: [
          {
            id: 99,
            name: 'CI',
            status: 'completed',
            conclusion: 'failure',
            head_branch: 'feature',
            html_url: 'https://github.com/acme/app/actions/runs/99',
            created_at: '2026-10-01T00:00:00Z'
          }
        ]
      });
    }
    if (url === 'https://api.github.com/repos/acme/app/actions/runs/99/jobs?per_page=100') {
      return Response.json({
        jobs: [
          {
            id: 5,
            name: 'test',
            status: 'completed',
            conclusion: 'failure',
            html_url: 'https://github.com/acme/app/actions/runs/99/job/5',
            started_at: '2026-10-01T00:00:00Z',
            completed_at: '2026-10-01T00:01:30Z'
          }
        ]
      });
    }
    if (url === 'https://api.github.com/repos/acme/app/actions/jobs/5/logs') {
      assert.equal(init?.redirect, 'manual');
      return new Response(null, {
        status: 302,
        headers: { location: 'https://logs.example.net/5?sig=1' }
      });
    }
    if (url === 'https://logs.example.net/5?sig=1') {
      // The GitHub token must not travel to the storage host.
      assert.equal(new Headers(init?.headers).get('authorization'), null);
      return new Response('\u001b[31mFAIL\u001b[0m test.ts');
    }
    if (url === 'https://api.github.com/repos/acme/app/actions/jobs/6/logs') {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch);

  const [run] = await github.getMergeRequestPipelines('t', 'acme/app', 7);
  assert.deepEqual([run.id, run.status, run.ref], ['99', 'failure', 'feature']);
  const [job] = await github.getPipelineJobs('t', 'acme/app', '99');
  assert.deepEqual([job.id, job.name, job.status, job.stage], ['5', 'test', 'failure', null]);
  assert.equal(job.finishedAt!.getTime() - job.startedAt!.getTime(), 90_000);
  assert.equal((await github.getJobLog('t', 'acme/app', '5')).text, '\u001b[31mFAIL\u001b[0m test.ts');
  assert.equal((await github.getJobLog('t', 'acme/app', '6')).available, false);

  const gitlab = createGitLabProvider('https://gitlab.example.com', (async (input) => {
    const url = String(input);
    if (url.endsWith('/projects/group%2Fapp/merge_requests/3/pipelines?per_page=20')) {
      return Response.json([
        {
          id: 41,
          status: 'running',
          ref: 'refs/merge-requests/3/head',
          web_url: 'https://gitlab.example.com/group/app/-/pipelines/41',
          created_at: '2026-10-01T00:00:00Z'
        }
      ]);
    }
    if (url.endsWith('/projects/group%2Fapp/pipelines/41/jobs?per_page=100')) {
      // Newest first, as GitLab lists them.
      return Response.json(
        ['deploy', 'test', 'build'].map((name, index) => ({
          id: 10 - index,
          name,
          stage: name,
          status: 'success',
          web_url: `https://gitlab.example.com/group/app/-/jobs/${10 - index}`,
          started_at: null,
          finished_at: null
        }))
      );
    }
    if (url.endsWith('/projects/group%2Fapp/jobs/8/trace')) return new Response('$ make build\nok');
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch);

  const [pipeline] = await gitlab.getMergeRequestPipelines('t', 'group/app', 3);
  assert.deepEqual([pipeline.id, pipeline.name, pipeline.status], ['41', 'Pipeline', 'running']);
  const jobs = await gitlab.getPipelineJobs('t', 'group/app', '41');
  assert.deepEqual(
    jobs.map((entry) => entry.name),
    ['build', 'test', 'deploy']
  );
  assert.equal((await gitlab.getJobLog('t', 'group/app', '8')).text, '$ make build\nok');

  const { isRunning } = await import('../src/features/devops/status');
  assert.equal(isRunning('in_progress'), true);
  assert.equal(isRunning('running'), true);
  assert.equal(isRunning('success'), false);
}

// SSH terminal: validation, host key pinning, and a real shell round trip.
{
  const { newSshConnectionSchema, sessionMessageSchema } = await import(
    '../src/features/devops/schema'
  );
  const base = {
    host: ' [2001:db8::1] ',
    port: 22,
    username: 'deploy',
    authMethod: 'password' as const,
    password: 'pw',
    privateKey: '',
    passphrase: '',
    save: false,
    name: ''
  };
  assert.equal(newSshConnectionSchema.parse(base).host, '2001:db8::1');
  assert.equal(newSshConnectionSchema.safeParse({ ...base, password: '' }).success, false);
  assert.equal(newSshConnectionSchema.safeParse({ ...base, host: 'a b' }).success, false);
  assert.equal(
    newSshConnectionSchema.safeParse({ ...base, authMethod: 'privateKey', privateKey: 'nope' })
      .success,
    false
  );
  assert.equal(sessionMessageSchema.safeParse({ type: 'resize', cols: 2, rows: 2 }).success, false);

  const { Server, utils } = await import('ssh2');
  const { openShell, SshConnectError } = await import('../src/lib/ssh/connection');
  const { hostKeyFingerprint } = await import('../src/lib/ssh/fingerprint');
  const store = await import('../src/lib/ssh/session-store');

  const hostKey = utils.generateKeyPairSync('ed25519');
  const server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    client.on('authentication', (context) => {
      if (context.method === 'password' && context.username === 'deploy' && context.password === 'pw') {
        context.accept();
      } else {
        context.reject(['password']);
      }
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (acceptPty) => acceptPty?.());
        session.on('window-change', (acceptChange, _reject, info) => {
          acceptChange?.();
          shellChannel?.write(`size ${info.cols}x${info.rows}\r\n`);
        });
        let shellChannel: import('ssh2').ServerChannel | undefined;
        session.on('shell', (acceptShell) => {
          shellChannel = acceptShell();
          shellChannel.write('welcome\r\n');
          // Echo, like a remote shell would.
          shellChannel.on('data', (data: Buffer) => shellChannel?.write(data));
        });
      });
    });
    client.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  const size = { cols: 80, rows: 24 };
  const target = {
    host: '127.0.0.1',
    port,
    username: 'deploy',
    credentials: { method: 'password' as const, password: 'pw' }
  };

  await assert.rejects(
    openShell({ ...target, credentials: { method: 'password', password: 'wrong' } }, size),
    (error: unknown) => error instanceof SshConnectError && error.code === 'auth'
  );
  await assert.rejects(
    openShell({ ...target, expectedFingerprint: 'SHA256:not-the-key' }, size),
    (error: unknown) => error instanceof SshConnectError && error.code === 'host-key'
  );

  const shell = await openShell(target, size);
  assert.match(shell.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  const parsedKey = utils.parseKey(hostKey.public);
  assert.ok(!(parsedKey instanceof Error));
  assert.equal(
    hostKeyFingerprint((Array.isArray(parsedKey) ? parsedKey[0] : parsedKey).getPublicSSH()),
    shell.fingerprint
  );
  // A pinned key that matches connects fine.
  (await openShell({ ...target, expectedFingerprint: shell.fingerprint }, size)).client.end();

  const session = store.createSshSession({
    userId: 'user-1',
    projectId: 'project-1',
    label: 'deploy@127.0.0.1',
    shell
  });
  assert.equal(store.getSshSession(session.id, 'someone-else'), undefined);
  assert.equal(store.countSshSessions('user-1'), 1);

  let output = '';
  const exits: string[] = [];
  const waitFor = async (text: string) => {
    for (let attempt = 0; attempt < 100 && !output.includes(text); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(output.includes(text), `expected ${JSON.stringify(text)} in ${JSON.stringify(output)}`);
  };

  // Output before anything attaches is kept and replayed on attach.
  await new Promise((resolve) => setTimeout(resolve, 100));
  const detach = store.attachSshSession(session, (event) => {
    if (event.type === 'data') output += event.data.toString();
    else exits.push(event.reason);
  });
  await waitFor('welcome');
  store.writeSshSession(session, 'uptime\r');
  await waitFor('uptime');
  store.resizeSshSession(session, 132, 40);
  await waitFor('size 132x40');

  detach();
  // A re-attach (a reloaded page) gets the screen so far, then new output.
  let replay = '';
  const detachAgain = store.attachSshSession(session, (event) => {
    if (event.type === 'data') replay += event.data.toString();
  });
  assert.ok(replay.startsWith('welcome') && replay.includes('size 132x40'));
  detachAgain();
  store.closeSshSession(session.id, 'Disconnected');
  assert.equal(store.getSshSession(session.id, 'user-1'), undefined);
  assert.deepEqual(exits, []);
  server.close();
}

// Settings helpers, languages and dictionaries.
{
  const { matchesGlob, matchesAnyGlob, parsePatternList } = await import('../src/lib/glob');
  assert.equal(matchesGlob('db.eu.internal', '*.internal'), true);
  assert.equal(matchesGlob('internal', '*.internal'), false);
  assert.equal(matchesGlob('10.0.3.4', '10.0.*'), true);
  assert.equal(matchesGlob('110.0.3.4', '10.0.*'), false);
  assert.equal(matchesGlob('Dependabot/npm/react', 'dependabot/*'), true);
  // Pattern characters other than * are literal.
  assert.equal(matchesGlob('dbXinternal', 'db.internal'), false);
  assert.equal(matchesAnyGlob('main', []), false);
  assert.deepEqual(parsePatternList(' *.internal \n\n10.0.*, *.internal'), ['*.internal', '10.0.*']);

  const { localeFromAcceptLanguage, isLocale } = await import('../src/i18n/config');
  assert.equal(localeFromAcceptLanguage('fil-PH,en;q=0.8'), 'fil');
  assert.equal(localeFromAcceptLanguage('de;q=0.9,tl;q=0.8,en;q=0.5'), 'fil');
  assert.equal(localeFromAcceptLanguage('en-US,fil;q=0.9'), 'en');
  assert.equal(localeFromAcceptLanguage('de,fr'), null);
  assert.equal(isLocale('fil'), true);
  assert.equal(isLocale('xx'), false);

  const { translate, auditKey, lookup } = await import('../src/i18n/translate');
  const { en } = await import('../src/i18n/messages/en');
  const { fil } = await import('../src/i18n/messages/fil');
  assert.equal(translate(fil, en, 'userMenu.signedInAs', { username: 'sean' }), 'Naka-sign in bilang @sean');
  assert.equal(translate({}, en, 'common.save'), 'Save');
  assert.equal(translate({}, {}, 'missing.key'), 'missing.key');
  assert.equal(auditKey('terminal.host.reset-key'), 'audit.terminal_host_reset_key');

  // Every English string exists in Filipino, isn't empty, and keeps the same placeholders.
  const leaves = (node: unknown, prefix = ''): string[] =>
    Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      typeof value === 'string' ? [`${prefix}${key}`] : leaves(value, `${prefix}${key}.`)
    );
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).toSorted();
  for (const key of leaves(en)) {
    const english = lookup(en, key)!;
    const filipino = lookup(fil, key);
    assert.ok(filipino, `fil is missing ${key}`);
    assert.deepEqual(placeholders(filipino), placeholders(english), `placeholders differ in ${key}`);
  }
  // Every audited action has a label.
  for (const action of [
    'project.update',
    'project.devops.update',
    'project.member.add',
    'terminal.connect',
    'terminal.host.reset-key',
    'account.connection.add',
    'admin.user.disable'
  ]) {
    assert.ok(lookup(en, auditKey(action)), `no label for ${action}`);
  }

  const { readPreferences, startPath, DEFAULT_PREFERENCES } = await import(
    '../src/features/account/preferences'
  );
  assert.deepEqual(readPreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(readPreferences({ locale: 'fil', terminalFontSize: 999, startPage: 'nope' }), {
    ...DEFAULT_PREFERENCES,
    locale: 'fil'
  });
  assert.equal(startPath({ ...DEFAULT_PREFERENCES, startPage: 'dashboard' }, 'p1'), '/projects/p1');
  assert.equal(startPath({ ...DEFAULT_PREFERENCES, startPage: 'dashboard' }, null), '/projects');
  assert.equal(startPath(DEFAULT_PREFERENCES, 'p1'), '/projects');

  const { describeUserAgent } = await import('../src/lib/user-agent');
  assert.deepEqual(
    describeUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
    ),
    { browser: 'Chrome', os: 'macOS' }
  );
  assert.deepEqual(describeUserAgent(null), { browser: 'Unknown browser', os: 'Unknown OS' });
}

// Public demo mode: everything that connects to other machines is refused.
{
  const { isDemoMode, DEMO_DISABLED_MESSAGE } = await import('../src/lib/demo');
  assert.equal(isDemoMode({ DEVONE_DEMO_MODE: 'true' }), true);
  assert.equal(isDemoMode({ DEVONE_DEMO_MODE: '1' }), true);
  assert.equal(isDemoMode({ DEVONE_DEMO_MODE: ' True ' }), true);
  assert.equal(isDemoMode({ DEVONE_DEMO_MODE: 'false' }), false);
  assert.equal(isDemoMode({}), false);

  const { providerIsEnabled } = await import('../src/features/auth/service');
  const { createAdapter } = await import('../src/lib/database/adapter');
  const { openShell } = await import('../src/lib/ssh/connection');
  assert.equal(providerIsEnabled('github'), true);

  process.env.DEVONE_DEMO_MODE = 'true';
  try {
    const refused = new RegExp(DEMO_DISABLED_MESSAGE.slice(0, 20));
    await assert.rejects(
      () => assertSafeRequestUrl('https://example.com', async () => ['93.184.216.34']),
      refused
    );
    assert.equal(providerIsEnabled('github'), false);
    assert.equal(providerIsEnabled('gitlab'), false);
    // Databases open the built-in sample data instead of connecting anywhere.
    const sample = createAdapter(DatabaseProvider.POSTGRES, {} as never);
    assert.equal((await sample.getSchema()).tables.length, 4);
    const shipped = await sample.execute("SELECT id, status FROM orders WHERE status = 'shipped' ORDER BY id DESC LIMIT 2", true);
    assert.deepEqual(shipped.columns, ['id', 'status']);
    assert.equal(shipped.rows.length, 2);
    assert.ok((shipped.rows[0][0] as number) > (shipped.rows[1][0] as number));
    assert.deepEqual((await sample.execute('select count(*) from customers', true)).rows, [[12]]);
    await assert.rejects(() => sample.execute('DELETE FROM orders', false), /read-only/);
    await assert.rejects(() => sample.insertRow('public', 'orders', {}), /read-only/);
    await assert.rejects(() => openShell({} as never, { cols: 80, rows: 24 }), refused);
  } finally {
    delete process.env.DEVONE_DEMO_MODE;
  }
}

// The landing page is opt-in: self-hosted installs go straight to sign-in.
{
  const { showLandingPage } = await import('../src/lib/site');
  assert.equal(showLandingPage({}), false);
  assert.equal(showLandingPage({ DEVONE_LANDING_PAGE: 'true' }), true);
  assert.equal(showLandingPage({ DEVONE_DEMO_MODE: 'true' }), true);
  assert.equal(showLandingPage({ DEVONE_LANDING_PAGE: 'false' }), false);
  assert.equal(showLandingPage({ DEVONE_LANDING_PAGE: 'TRUE' }), true);
}

// Demo Git edits are kept per visitor (per connection token).
{
  const { createDemoGitProvider, DEMO_REPOSITORY_ID } = await import('../src/lib/git/demo');
  const git = createDemoGitProvider();
  const edit = { path: 'README.md', branch: 'main', content: '# Changed by A', message: 'edit', revision: 'demo' };
  await git.updateFile('demo:visitor-a', DEMO_REPOSITORY_ID, edit);
  assert.equal((await git.getFile('demo:visitor-a', DEMO_REPOSITORY_ID, 'README.md', 'main')).text, '# Changed by A');
  assert.notEqual((await git.getFile('demo:visitor-b', DEMO_REPOSITORY_ID, 'README.md', 'main')).text, '# Changed by A');
  await git.createBranch('demo:visitor-a', DEMO_REPOSITORY_ID, 'a-only', 'sha');
  assert.ok((await git.getBranches('demo:visitor-a', DEMO_REPOSITORY_ID)).some((branch) => branch.name === 'a-only'));
  assert.ok(!(await git.getBranches('demo:visitor-b', DEMO_REPOSITORY_ID)).some((branch) => branch.name === 'a-only'));
}

// Desktop downloads: each platform's installer from the latest release, else the release page.
{
  const release = desktopDownloads({
    tag_name: 'v1.1.0',
    assets: [
      { name: 'DevOne-1.1.0-mac-arm64.dmg', browser_download_url: 'https://x/mac.dmg' },
      { name: 'DevOne-1.1.0-linux-amd64.deb', browser_download_url: 'https://x/linux.deb' }
    ]
  });
  assert.equal(release.version, '1.1.0');
  assert.equal(release.downloads.mac, 'https://x/mac.dmg');
  assert.equal(release.downloads.debian, 'https://x/linux.deb');
  assert.equal(release.downloads.windows, `${RELEASES_URL}/latest`);
  assert.deepEqual(desktopDownloads(null), {
    version: null,
    downloads: {
      mac: `${RELEASES_URL}/latest`,
      windows: `${RELEASES_URL}/latest`,
      debian: `${RELEASES_URL}/latest`,
      redhat: `${RELEASES_URL}/latest`
    }
  });
}

// AI router: which providers a model goes to, in what order, and when to move on.
{
  const {
    AUTO_MODEL,
    cooldownMs,
    listModelIds,
    normalizeBaseUrl,
    parseModelList,
    providerUrl,
    resolveTargets,
    shouldFallBack,
    usageFromJson,
    usageFromSse
  } = await import('../src/lib/ai-router/routing');
  const now = new Date('2026-10-03T12:00:00Z');
  const provider = (id: string, priority: number, models: string[], extra = {}) => ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    baseUrl: `https://${id}.example/v1`,
    models,
    priority,
    enabled: true,
    cooldownUntil: null,
    ...extra
  });
  const zen = provider('zen', 10, ['big-pickle', 'shared']);
  const groq = provider('groq', 20, ['llama', 'shared']);
  const off = provider('off', 0, ['shared'], { enabled: false });
  const resting = provider('resting', 5, ['shared'], {
    cooldownUntil: new Date(now.getTime() + 60_000)
  });
  const providers = [groq, off, resting, zen];
  const combos = [
    {
      name: 'free-stack',
      steps: [
        { providerId: 'groq', model: 'llama' },
        { providerId: 'off', model: 'shared' },
        { providerId: 'zen', model: 'big-pickle' }
      ]
    }
  ];
  const route = (model: string) =>
    resolveTargets(model, providers, combos, now).map((t) => `${t.provider.id}:${t.model}`);

  // A combo keeps its order and skips disabled providers.
  assert.deepEqual(route('free-stack'), ['groq:llama', 'zen:big-pickle']);
  // A shared model goes by priority; a resting provider is tried last, a disabled one never.
  assert.deepEqual(route('shared'), ['zen:shared', 'groq:shared', 'resting:shared']);
  // "Provider/model" pins the provider, in any case; an unknown model has nowhere to go.
  assert.deepEqual(route('groq/some-new-model'), ['groq:some-new-model']);
  assert.deepEqual(route('GROQ/llama'), ['groq:llama']);
  assert.deepEqual(route('nobody-serves-this'), []);
  assert.deepEqual(route('off/shared'), []);
  // "auto" is each provider's first model, by priority.
  assert.deepEqual(route(AUTO_MODEL), ['zen:big-pickle', 'groq:llama', 'resting:shared']);
  // A cooldown in the past no longer counts.
  assert.deepEqual(
    resolveTargets('shared', providers, combos, new Date(now.getTime() + 120_000)).map(
      (t) => t.provider.id
    ),
    ['resting', 'zen', 'groq']
  );

  const ids = listModelIds(providers, combos);
  assert.equal(ids[0], 'auto');
  assert.ok(ids.includes('free-stack'));
  assert.ok(ids.includes('Zen/big-pickle'));
  assert.ok(!ids.some((id) => id.startsWith('Off/')));
  assert.deepEqual(listModelIds([], []), []);

  for (const status of [401, 402, 403, 404, 408, 429, 500, 502, 503]) {
    assert.equal(shouldFallBack(status), true, `falls back on ${status}`);
  }
  for (const status of [400, 413, 422]) {
    assert.equal(shouldFallBack(status), false, `returns ${status} as is`);
  }

  const at = now.getTime();
  assert.equal(cooldownMs(429, '30', at), 30_000);
  assert.equal(cooldownMs(429, new Date(at + 90_000).toUTCString(), at), 90_000);
  assert.equal(cooldownMs(429, '999999', at), 60 * 60_000);
  assert.equal(cooldownMs(429, null, at), 60_000);
  assert.equal(cooldownMs(401, null, at), 10 * 60_000);
  assert.equal(cooldownMs(503, null, at), 30_000);
  assert.equal(cooldownMs(0, null, at), 30_000);
  assert.equal(cooldownMs(404, null, at), 0);

  assert.deepEqual(usageFromJson('{"usage":{"prompt_tokens":3,"completion_tokens":5}}'), {
    promptTokens: 3,
    completionTokens: 5
  });
  assert.deepEqual(usageFromJson('not json'), { promptTokens: null, completionTokens: null });
  assert.deepEqual(
    usageFromSse(
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n' +
        'data: [DONE]\n\n'
    ),
    { promptTokens: 7, completionTokens: 2 }
  );

  assert.equal(providerUrl('https://x.example/v1/', '/models'), 'https://x.example/v1/models');
  assert.equal(normalizeBaseUrl(' https://openrouter.ai/api/v1/ '), 'https://openrouter.ai/api/v1');
  assert.equal(normalizeBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.equal(normalizeBaseUrl('ftp://x.example'), null);
  assert.equal(normalizeBaseUrl('https://x.example/v1?key=1'), null);
  assert.equal(normalizeBaseUrl('https://user:pw@x.example/v1'), null);
  assert.deepEqual(parseModelList({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }, {}] }), [
    'a',
    'b'
  ]);
  assert.deepEqual(parseModelList(null), []);
}

// AI router: fallback across providers, streaming relay and what gets reported.
{
  const { forwardChatCompletion } = await import('../src/lib/ai-router/forward');
  const target = (id: string, model = 'm') => ({
    provider: {
      id,
      name: id,
      baseUrl: `https://${id}.example/v1`,
      models: [model],
      priority: 0,
      enabled: true,
      cooldownUntil: null
    },
    model
  });
  type Call = { url: string; auth: string | null; body: Record<string, unknown> };
  const fakeFetch = (answers: Record<string, () => Response | Promise<Response>>, calls: Call[]) =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, auth: headers.get('authorization'), body: JSON.parse(String(init?.body)) });
      const answer = answers[new URL(url).hostname.split('.')[0]];
      return answer();
    }) as typeof fetch;

  // A rate-limited provider hands over to the next, which answers.
  {
    const calls: Call[] = [];
    const failures: { id: string; status: number; retryAfter: string | null }[] = [];
    let outcome: import('../src/lib/ai-router/forward').ForwardOutcome | undefined;
    const response = await forwardChatCompletion({
      body: { model: 'free-stack', messages: [{ role: 'user', content: 'hi' }] },
      targets: [target('a', 'big-pickle'), target('b', 'llama')],
      apiKeyFor: (id) => (id === 'a' ? 'key-a' : null),
      fetchImpl: fakeFetch(
        {
          a: () =>
            Response.json(
              { error: { message: 'Rate limit reached' } },
              { status: 429, headers: { 'retry-after': '12' } }
            ),
          b: () => Response.json({ choices: [], usage: { prompt_tokens: 4, completion_tokens: 6 } })
        },
        calls
      ),
      onFailure: (failure) => {
        failures.push({
          id: failure.target.provider.id,
          status: failure.status,
          retryAfter: failure.retryAfter
        });
      },
      onFinish: (result) => {
        outcome = result;
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-devone-provider'), 'b');
    assert.equal(response.headers.get('x-devone-attempts'), '2');
    assert.deepEqual(
      calls.map((call) => [call.url, call.auth, call.body.model]),
      [
        ['https://a.example/v1/chat/completions', 'Bearer key-a', 'big-pickle'],
        ['https://b.example/v1/chat/completions', null, 'llama']
      ]
    );
    assert.deepEqual(failures, [{ id: 'a', status: 429, retryAfter: '12' }]);
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(outcome?.target?.provider.id, 'b');
    assert.equal(outcome?.attempts, 2);
    assert.deepEqual(outcome?.usage, { promptTokens: 4, completionTokens: 6 });
  }

  // A malformed request is the client's to fix: no fallback.
  {
    const calls: Call[] = [];
    const response = await forwardChatCompletion({
      body: { model: 'x', messages: [] },
      targets: [target('a'), target('b')],
      apiKeyFor: () => null,
      fetchImpl: fakeFetch(
        {
          a: () => Response.json({ error: { message: 'messages is empty' } }, { status: 400 }),
          b: () => Response.json({})
        },
        calls
      )
    });
    assert.equal(response.status, 400);
    assert.equal(calls.length, 1);
    assert.equal(((await response.json()) as { error: { message: string } }).error.message, 'messages is empty');
  }

  // Unreachable providers and outages: every one fails, the last error is reported.
  {
    const response = await forwardChatCompletion({
      body: { model: 'x', messages: [] },
      targets: [target('a'), target('b')],
      apiKeyFor: () => null,
      fetchImpl: fakeFetch(
        {
          a: () => {
            throw new TypeError('fetch failed');
          },
          b: () => new Response('Bad gateway', { status: 503 })
        },
        []
      )
    });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { message: string; code: string } };
    assert.equal(body.error.code, 'all_providers_failed');
    assert.match(body.error.message, /Bad gateway/);
  }

  // A provider that does not start answering in time is skipped.
  {
    const response = await forwardChatCompletion({
      body: { model: 'x', messages: [] },
      targets: [target('slow'), target('b')],
      apiKeyFor: () => null,
      timeoutMs: 20,
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).includes('slow')) {
          return new Promise<Response>((_, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          );
        }
        return Response.json({ ok: true });
      }) as typeof fetch
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-devone-provider'), 'b');
  }

  // No provider for the model.
  {
    const response = await forwardChatCompletion({
      body: { model: 'nothing', messages: [] },
      targets: [],
      apiKeyFor: () => null
    });
    assert.equal(response.status, 404);
  }

  // A stream is relayed as it is, asks for usage, and reports its token counts at the end.
  {
    const calls: Call[] = [];
    let outcome: import('../src/lib/ai-router/forward').ForwardOutcome | undefined;
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2}}\n\ndata: [DONE]\n\n'
    ];
    const response = await forwardChatCompletion({
      body: { model: 'x', messages: [], stream: true },
      targets: [target('a')],
      apiKeyFor: () => null,
      fetchImpl: fakeFetch(
        {
          a: () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
                  controller.close();
                }
              }),
              { headers: { 'content-type': 'text/event-stream' } }
            )
        },
        calls
      ),
      onFinish: (result) => {
        outcome = result;
      }
    });
    assert.deepEqual(calls[0].body.stream_options, { include_usage: true });
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    assert.equal(await response.text(), chunks.join(''));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(outcome?.usage, { promptTokens: 9, completionTokens: 2 });
    assert.equal(outcome?.error, null);
  }
}

// AI router: personal keys and the per-person rate limit.
{
  const { createAiApiKey, hashAiApiKey, readAiApiKey } = await import('../src/lib/ai-router/keys');
  const { aiRateLimit, createRateLimiter } = await import('../src/lib/ai-router/rate-limit');
  const { key, hash, prefix } = createAiApiKey();
  assert.match(key, /^dvo_[\w-]{32}$/);
  assert.equal(hash, hashAiApiKey(key));
  assert.ok(key.startsWith(prefix));
  assert.equal(readAiApiKey(new Headers({ authorization: `Bearer ${key}` })), key);
  assert.equal(readAiApiKey(new Headers({ 'x-api-key': key })), key);
  assert.equal(readAiApiKey(new Headers({ authorization: 'Bearer sk-someone-else' })), null);
  assert.equal(readAiApiKey(new Headers()), null);

  assert.equal(aiRateLimit({}), 60);
  assert.equal(aiRateLimit({ DEVONE_AI_RATE_LIMIT: '0' }), 0);
  assert.equal(aiRateLimit({ DEVONE_AI_RATE_LIMIT: 'lots' }), 60);
  const limiter = createRateLimiter(2);
  assert.equal(limiter.take('u', 0), true);
  assert.equal(limiter.take('u', 1), true);
  assert.equal(limiter.take('u', 2), false);
  assert.equal(limiter.take('other', 2), true);
  assert.equal(limiter.take('u', 60_001), true);
  assert.equal(createRateLimiter(0).take('u'), true);
}
