import type { DatabaseConnection } from '@/generated/prisma/client';
import {
  configFor,
  DatabaseAccessError,
  ReadOnlyConnectionError,
  requireConnection
} from '@/features/database/service';
import { withDocumentAdapter } from '@/lib/database/adapter';
import type {
  CollectionSummary,
  DocumentVocabulary,
  EntryPage,
  EntryQuery
} from '@/lib/database/document/types';
import { isSqlProvider } from '@/lib/database/types';

async function requireDocumentConnection(userId: string, connectionId: string) {
  const connection = await requireConnection(userId, connectionId);
  if (isSqlProvider(connection.provider)) {
    throw new DatabaseAccessError('This connection is a SQL database');
  }
  return connection;
}

/** Every write goes straight to the engine, so a read-only connection is always refused. */
async function requireWritableDocumentConnection(userId: string, connectionId: string) {
  const connection = await requireDocumentConnection(userId, connectionId);
  if (connection.readOnly) throw new ReadOnlyConnectionError();
  return connection;
}

const run = <T>(
  connection: DatabaseConnection,
  database: string,
  body: Parameters<typeof withDocumentAdapter<T>>[2]
) => withDocumentAdapter(connection.provider, configFor(connection, database), body);

export async function listCollections(
  userId: string,
  connectionId: string,
  database: string
): Promise<{ collections: CollectionSummary[]; vocabulary: DocumentVocabulary }> {
  const connection = await requireDocumentConnection(userId, connectionId);
  return run(connection, database, async (adapter) => ({
    collections: await adapter.listCollections(database),
    vocabulary: adapter.vocabulary
  }));
}

export async function listEntries(
  userId: string,
  connectionId: string,
  database: string,
  collection: string,
  query: EntryQuery
): Promise<EntryPage> {
  const connection = await requireDocumentConnection(userId, connectionId);
  return run(connection, database, (adapter) => adapter.listEntries(database, collection, query));
}

export async function saveEntry(
  userId: string,
  connectionId: string,
  database: string,
  collection: string,
  id: string | null,
  value: unknown
): Promise<void> {
  const connection = await requireWritableDocumentConnection(userId, connectionId);
  await run(connection, database, (adapter) => adapter.saveEntry(database, collection, id, value));
}

export async function deleteEntry(
  userId: string,
  connectionId: string,
  database: string,
  collection: string,
  id: string
): Promise<void> {
  const connection = await requireWritableDocumentConnection(userId, connectionId);
  await run(connection, database, (adapter) => adapter.deleteEntry(database, collection, id));
}
