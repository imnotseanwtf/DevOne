import type { RowChange } from '@/lib/database/row-changes';
import { DatabaseEnvironment, type DatabaseConnection } from '@/generated/prisma/client';
import { getPrisma } from '@/lib/db/prisma';
import { decryptSecret, encryptSecret, getEncryptionKey } from '@/lib/encryption/secrets';
import { createAdapter, withAdapter } from '@/lib/database/adapter';
import { buildSchemaStatements } from '@/lib/database/ddl';
import { hashSchema } from '@/lib/database/hash';
import {
  createSession,
  getSession,
  removeSession,
  touchSession
} from '@/lib/database/session-store';
import {
  DEFAULT_STATEMENT_TIMEOUT_MS,
  type ConnectionConfig,
  type DatabaseSchema,
  type QueryResult,
  type RowPage,
  type RowPageOptions,
  type RowValues,
  type SchemaChange,
  StatementFailedError
} from '@/lib/database/types';
import type {
  ParsedConnectionInput,
  ParsedServerConnectionInput,
  ParsedUpdateConnectionInput
} from '@/features/database/schema';

export class DatabaseAccessError extends Error {
  constructor(message = 'Database connection not found') {
    super(message);
    this.name = 'DatabaseAccessError';
  }
}

/** `appliedChanges` stayed applied (MySQL only; Postgres rolls everything back). */
export class SchemaChangeError extends Error {
  constructor(
    message: string,
    readonly appliedChanges: number
  ) {
    super(message);
    this.name = 'SchemaChangeError';
  }
}

export class ReadOnlyConnectionError extends Error {
  constructor() {
    super('This connection is read-only');
    this.name = 'ReadOnlyConnectionError';
  }
}

async function requireProjectMembership(userId: string, projectId: string) {
  const membership = await getPrisma().projectMember.findFirst({
    where: { projectId, userId },
    select: { id: true }
  });
  if (!membership) throw new DatabaseAccessError();
}

/** Resolves a connection the caller may use, or throws. Never returns the password. */
async function requireConnection(userId: string, connectionId: string) {
  const connection = await getPrisma().databaseConnection.findFirst({
    where: { id: connectionId, project: { members: { some: { userId } } } }
  });
  if (!connection) throw new DatabaseAccessError();
  return connection;
}

/** `database` lets a saved connection be browsed against a database other
 * than its saved default (or, before one is ever set, against none at all -
 * each adapter falls back to a database-less/maintenance connection). */
function configFor(connection: DatabaseConnection, database?: string): ConnectionConfig {
  return {
    host: connection.host,
    port: connection.port,
    database: database ?? connection.databaseName ?? undefined,
    username: connection.username,
    password: decryptSecret(connection.encryptedPassword, getEncryptionKey()),
    ssl: connection.sslEnabled,
    statementTimeoutMs: DEFAULT_STATEMENT_TIMEOUT_MS
  };
}

function configFromServerInput(input: ParsedServerConnectionInput): ConnectionConfig {
  return {
    host: input.host,
    port: input.port,
    username: input.username,
    password: input.password,
    ssl: input.sslEnabled,
    statementTimeoutMs: DEFAULT_STATEMENT_TIMEOUT_MS
  };
}

/** Pings a server with raw credentials, before the connection is saved. When
 * editing a saved connection, a blank password means "use the stored one". */
export async function pingServer(
  userId: string,
  input: ParsedServerConnectionInput
): Promise<void> {
  let password = input.password;
  if (input.connectionId && !password) {
    const connection = await requireConnection(userId, input.connectionId);
    password = decryptSecret(connection.encryptedPassword, getEncryptionKey());
  }
  await withAdapter(input.provider, configFromServerInput({ ...input, password }), (adapter) =>
    adapter.testConnection()
  );
}

/** The shape safe to hand the browser: no password, encrypted or otherwise. */
export function toPublicConnection(connection: DatabaseConnection) {
  return {
    id: connection.id,
    projectId: connection.projectId,
    name: connection.name,
    provider: connection.provider,
    host: connection.host,
    port: connection.port,
    databaseName: connection.databaseName,
    username: connection.username,
    sslEnabled: connection.sslEnabled,
    environment: connection.environment,
    resourceId: connection.resourceId,
    readOnly: connection.readOnly,
    lastScannedAt: connection.lastScannedAt
  };
}

export async function listConnectionsForProject(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);
  const connections = await getPrisma().databaseConnection.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' }
  });
  return connections.map(toPublicConnection);
}

export function countConnectionsForUser(userId: string): Promise<number> {
  return getPrisma().databaseConnection.count({
    where: { project: { members: { some: { userId } } } }
  });
}

/**
 * A connection linked to a resource takes that resource's environment, so the
 * production safeguards follow the environment it actually belongs to.
 */
async function resolveEnvironment(
  userId: string,
  projectId: string,
  input: { resourceId?: string | null; environment: DatabaseEnvironment }
) {
  if (!input.resourceId) return { resourceId: null, environment: input.environment };
  const resource = await getPrisma().projectResource.findFirst({
    // Someone else's personal resource is out of reach, like everywhere else.
    where: { id: input.resourceId, projectId, OR: [{ ownerId: null }, { ownerId: userId }] },
    select: { id: true, environment: true }
  });
  if (!resource) throw new DatabaseAccessError('That resource is not in this project');
  return { resourceId: resource.id, environment: resource.environment };
}

export async function createConnection(
  userId: string,
  projectId: string,
  input: ParsedConnectionInput
) {
  await requireProjectMembership(userId, projectId);
  const { resourceId, environment } = await resolveEnvironment(userId, projectId, input);

  const connection = await getPrisma().databaseConnection.create({
    data: {
      projectId,
      name: input.name,
      provider: input.provider,
      host: input.host,
      port: input.port,
      username: input.username,
      encryptedPassword: encryptSecret(input.password, getEncryptionKey()),
      sslEnabled: input.sslEnabled,
      environment,
      resourceId,
      // Production is read-only unless someone deliberately says otherwise.
      readOnly: environment === DatabaseEnvironment.PRODUCTION ? true : input.readOnly
    }
  });

  return toPublicConnection(connection);
}

export async function updateConnection(userId: string, input: ParsedUpdateConnectionInput) {
  const existing = await requireConnection(userId, input.connectionId);
  const { resourceId, environment } = await resolveEnvironment(userId, existing.projectId, input);
  // A different server (or engine) almost certainly doesn't have the old
  // default database, so drop it rather than point at something missing.
  const serverChanged =
    input.provider !== existing.provider ||
    input.host !== existing.host ||
    input.port !== existing.port;

  const connection = await getPrisma().databaseConnection.update({
    where: { id: existing.id },
    data: {
      name: input.name,
      provider: input.provider,
      host: input.host,
      port: input.port,
      username: input.username,
      ...(input.password && {
        encryptedPassword: encryptSecret(input.password, getEncryptionKey())
      }),
      sslEnabled: input.sslEnabled,
      environment,
      resourceId,
      readOnly: environment === DatabaseEnvironment.PRODUCTION ? true : input.readOnly,
      ...(serverChanged && { databaseName: null })
    }
  });

  return toPublicConnection(connection);
}

export type PublicConnection = ReturnType<typeof toPublicConnection>;

export async function deleteConnection(userId: string, connectionId: string) {
  const connection = await requireConnection(userId, connectionId);
  await getPrisma().databaseConnection.delete({ where: { id: connection.id } });
  return connection.projectId;
}

export async function testConnection(userId: string, connectionId: string) {
  const connection = await requireConnection(userId, connectionId);
  await withAdapter(connection.provider, configFor(connection), (adapter) =>
    adapter.testConnection()
  );
}

/** Every database on the server this saved connection points to. */
export async function listDatabasesForConnection(
  userId: string,
  connectionId: string
): Promise<string[]> {
  const connection = await requireConnection(userId, connectionId);
  return withAdapter(connection.provider, configFor(connection), (adapter) =>
    adapter.listDatabases()
  );
}

/**
 * Reads a database's schema live, without writing a snapshot. Used to browse
 * a database other than the connection's saved default: snapshot history is
 * only ever kept for that one default, so a snapshot here would either be
 * discarded (wasted work) or mixed in with an unrelated database's history.
 */
export async function getLiveSchema(
  userId: string,
  connectionId: string,
  database: string
): Promise<DatabaseSchema> {
  const connection = await requireConnection(userId, connectionId);
  return withAdapter(connection.provider, configFor(connection, database), (adapter) =>
    adapter.getSchema()
  );
}

/** Repoints the connection's saved default at a different database on the same server. */
export async function setDefaultDatabase(userId: string, connectionId: string, database: string) {
  const connection = await requireConnection(userId, connectionId);
  if (database === connection.databaseName) return connection.projectId;

  await getPrisma().databaseConnection.update({
    where: { id: connection.id },
    data: { databaseName: database }
  });
  // Old snapshots belong to the previous default; keeping them would mix two
  // unrelated databases' schemas into one history. The new default starts fresh.
  await getPrisma().schemaSnapshot.deleteMany({ where: { databaseConnectionId: connection.id } });
  await scanSchema(userId, connection.id).catch(() => undefined);
  return connection.projectId;
}

/**
 * Opens a connection and keeps it alive for reuse across several `runQuery`
 * calls, instead of the usual one-shot connect-then-disconnect. Callers must
 * `closeSession` when done; idle sessions are swept after 10 minutes.
 */
export async function openSession(
  userId: string,
  connectionId: string,
  database?: string
): Promise<string> {
  const connection = await requireConnection(userId, connectionId);
  const resolvedDatabase = database ?? connection.databaseName;
  if (!resolvedDatabase) throw new DatabaseAccessError('Pick a database before connecting');

  const adapter = createAdapter(connection.provider, configFor(connection, resolvedDatabase));
  try {
    await adapter.testConnection();
  } catch (error) {
    await adapter.disconnect().catch(() => undefined);
    throw error;
  }
  return createSession({
    adapter,
    userId,
    connectionId,
    database: resolvedDatabase,
    provider: connection.provider
  });
}

export async function closeSession(userId: string, sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session || session.userId !== userId) return;
  removeSession(sessionId);
  await session.adapter.disconnect().catch(() => undefined);
}

/**
 * Reads live metadata and stores it only when the schema actually changed, so
 * repeated scans do not grow the snapshot table without bound.
 */
export async function scanSchema(userId: string, connectionId: string) {
  const connection = await requireConnection(userId, connectionId);
  if (!connection.databaseName) {
    throw new DatabaseAccessError('Set a default database before scanning its schema');
  }
  const schema = await withAdapter(connection.provider, configFor(connection), (adapter) =>
    adapter.getSchema()
  );

  const contentHash = hashSchema(schema);
  await getPrisma().schemaSnapshot.upsert({
    where: {
      databaseConnectionId_contentHash: { databaseConnectionId: connection.id, contentHash }
    },
    create: {
      databaseConnectionId: connection.id,
      contentHash,
      schemaJson: schema as never
    },
    update: { lastSeenAt: new Date() }
  });

  await getPrisma().databaseConnection.update({
    where: { id: connection.id },
    data: { lastScannedAt: new Date() }
  });

  return { schema, projectId: connection.projectId };
}

/** Latest stored schema, without touching the remote database. */
export async function getLatestSchema(
  userId: string,
  connectionId: string
): Promise<DatabaseSchema | null> {
  await requireConnection(userId, connectionId);
  const snapshot = await getPrisma().schemaSnapshot.findFirst({
    where: { databaseConnectionId: connectionId },
    orderBy: { lastSeenAt: 'desc' }
  });
  return snapshot ? (snapshot.schemaJson as unknown as DatabaseSchema) : null;
}

export async function listSchemaHistory(userId: string, connectionId: string) {
  await requireConnection(userId, connectionId);
  return getPrisma().schemaSnapshot.findMany({
    where: { databaseConnectionId: connectionId },
    select: { id: true, contentHash: true, createdAt: true, lastSeenAt: true },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
}

export async function runQuery(
  userId: string,
  connectionId: string,
  sql: string,
  requestWrite: boolean,
  sessionId?: string,
  database?: string
): Promise<QueryResult> {
  const connection = await requireConnection(userId, connectionId);

  // A read-only connection can never be talked into a writable transaction.
  if (requestWrite && connection.readOnly) throw new ReadOnlyConnectionError();
  const readOnly = connection.readOnly || !requestWrite;

  if (sessionId) {
    const session = getSession(sessionId);
    if (!session || session.userId !== userId || session.connectionId !== connectionId) {
      throw new DatabaseAccessError('Session not found or expired, reconnect and try again');
    }
    if (database && session.database !== database) {
      throw new DatabaseAccessError(
        'That session is connected to a different database, reconnect and try again'
      );
    }
    touchSession(sessionId);
    return session.adapter.execute(sql, readOnly);
  }

  return withAdapter(connection.provider, configFor(connection, database), (adapter) =>
    adapter.execute(sql, readOnly)
  );
}

export async function fetchTableRows(
  userId: string,
  connectionId: string,
  schema: string,
  table: string,
  options: RowPageOptions,
  database?: string
): Promise<RowPage> {
  const connection = await requireConnection(userId, connectionId);
  return withAdapter(connection.provider, configFor(connection, database), (adapter) =>
    adapter.fetchRows(schema, table, options)
  );
}

/** Every row mutation always writes for real, so a read-only connection is always refused. */
async function requireWritableConnection(userId: string, connectionId: string) {
  const connection = await requireConnection(userId, connectionId);
  if (connection.readOnly) throw new ReadOnlyConnectionError();
  return connection;
}

export async function insertTableRow(
  userId: string,
  connectionId: string,
  schema: string,
  table: string,
  values: RowValues,
  database?: string
): Promise<void> {
  const connection = await requireWritableConnection(userId, connectionId);
  await withAdapter(connection.provider, configFor(connection, database), (adapter) =>
    adapter.insertRow(schema, table, values)
  );
}

export async function updateTableRow(
  userId: string,
  connectionId: string,
  schema: string,
  table: string,
  values: RowValues,
  where: RowValues,
  database?: string
): Promise<void> {
  const connection = await requireWritableConnection(userId, connectionId);
  await withAdapter(connection.provider, configFor(connection, database), (adapter) =>
    adapter.updateRow(schema, table, values, where)
  );
}

export async function deleteTableRow(
  userId: string,
  connectionId: string,
  schema: string,
  table: string,
  where: RowValues,
  database?: string
): Promise<void> {
  const connection = await requireWritableConnection(userId, connectionId);
  await withAdapter(connection.provider, configFor(connection, database), (adapter) =>
    adapter.deleteRow(schema, table, where)
  );
}

/** Runs staged row edits for one table in a single transaction. */
export async function applyTableRowChanges(
  userId: string,
  connectionId: string,
  schema: string,
  table: string,
  changes: RowChange[],
  database?: string
): Promise<void> {
  const connection = await requireWritableConnection(userId, connectionId);
  await withAdapter(connection.provider, configFor(connection, database), (adapter) =>
    adapter.applyRowChanges(schema, table, changes)
  );
}

export async function listSavedQueries(userId: string, connectionId: string) {
  await requireConnection(userId, connectionId);
  return getPrisma().savedQuery.findMany({
    where: { databaseConnectionId: connectionId },
    orderBy: { updatedAt: 'desc' }
  });
}

export async function saveQuery(userId: string, connectionId: string, name: string, sql: string) {
  const connection = await requireConnection(userId, connectionId);
  const saved = await getPrisma().savedQuery.upsert({
    where: { databaseConnectionId_name: { databaseConnectionId: connectionId, name } },
    create: { databaseConnectionId: connectionId, name, sql, createdById: userId },
    update: { sql }
  });
  return { ...saved, projectId: connection.projectId };
}

/** Two snapshots of one connection, oldest-to-newest, for the diff view. */
export async function getSnapshotPair(
  userId: string,
  connectionId: string,
  fromId: string,
  toId: string
) {
  await requireConnection(userId, connectionId);
  const snapshots = await getPrisma().schemaSnapshot.findMany({
    where: { databaseConnectionId: connectionId, id: { in: [fromId, toId] } }
  });

  const from = snapshots.find((snapshot) => snapshot.id === fromId);
  const to = snapshots.find((snapshot) => snapshot.id === toId);
  if (!from || !to) throw new DatabaseAccessError('Snapshot not found');

  return {
    from: {
      id: from.id,
      createdAt: from.createdAt,
      schema: from.schemaJson as unknown as DatabaseSchema
    },
    to: { id: to.id, createdAt: to.createdAt, schema: to.schemaJson as unknown as DatabaseSchema }
  };
}

export async function getConnectionProvider(userId: string, connectionId: string) {
  const connection = await requireConnection(userId, connectionId);
  return connection.provider;
}

/** The DDL `applySchemaChanges` would run, built against the live schema. */
export async function previewSchemaChanges(
  userId: string,
  connectionId: string,
  changes: SchemaChange[],
  database?: string
): Promise<string[]> {
  const connection = await requireConnection(userId, connectionId);
  return withAdapter(connection.provider, configFor(connection, database), async (adapter) =>
    buildSchemaStatements(connection.provider, changes, await adapter.getSchema()).flat()
  );
}

/**
 * Applies staged changes in order: in one transaction on Postgres, one by one
 * on MySQL. The default database's snapshot is rescanned afterward either way,
 * so the tracked schema reflects whatever did land.
 */
export async function applySchemaChanges(
  userId: string,
  connectionId: string,
  changes: SchemaChange[],
  database?: string
) {
  const connection = await requireWritableConnection(userId, connectionId);
  const tracked = !database && !!connection.databaseName;

  try {
    await withAdapter(connection.provider, configFor(connection, database), async (adapter) => {
      const groups = buildSchemaStatements(connection.provider, changes, await adapter.getSchema());
      try {
        await adapter.applyStatements(groups.flat());
      } catch (error) {
        if (!(error instanceof StatementFailedError)) throw error;
        let appliedChanges = 0;
        if (connection.provider === 'MYSQL') {
          // Count the changes whose every statement ran before the failing one.
          let seen = 0;
          for (const group of groups) {
            seen += group.length;
            if (seen > error.index) break;
            appliedChanges += 1;
          }
        }
        throw new SchemaChangeError(error.message, appliedChanges);
      }
    });
  } finally {
    if (tracked) await scanSchema(userId, connectionId).catch(() => undefined);
  }

  return connection.projectId;
}
