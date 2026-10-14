import { BSON, MongoClient, type Document, type Filter } from 'mongodb';

const { EJSON } = BSON;
import {
  DocumentInputError,
  parseJsonObject,
  type CollectionSummary,
  type DocumentAdapter,
  type EntryPage
} from '@/lib/database/document/types';
import type { ConnectionConfig } from '@/lib/database/types';

const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);

/** Mongo values (ObjectId, Date, Long...) round-trip as Extended JSON, e.g. {"$oid": "…"}. */
const toJson = (value: unknown) => EJSON.serialize(value as Document, { relaxed: true });
const fromJson = (text: string) => EJSON.parse(text, { relaxed: true });

/** Decodes a client-supplied cursor: the last `_id` seen, as Extended JSON. */
function afterId(cursor: string | undefined): unknown {
  if (!cursor) return undefined;
  return EJSON.parse(cursor, { relaxed: true })._id;
}

export function createMongoAdapter(config: ConnectionConfig): DocumentAdapter {
  const client = new MongoClient(
    `mongodb://${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/`,
    {
      appName: 'DevOne',
      tls: config.ssl,
      // Same trade-off as the SQL adapters: managed clusters (DocumentDB, Atlas
      // private endpoints) often present a CA that isn't in the system store.
      tlsAllowInvalidCertificates: config.ssl,
      // Amazon DocumentDB doesn't support retryable writes.
      retryWrites: false,
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: config.statementTimeoutMs,
      directConnection: true,
      // Empty username means an unauthenticated local server.
      ...(config.username ? { authSource: 'admin' } : {})
    }
  );

  const collectionOf = (database: string, name: string) => client.db(database).collection(name);

  return {
    vocabulary: {
      collection: 'collection',
      entry: 'document',
      filterHint: '{ "status": "active" }'
    },

    async testConnection() {
      await client.connect();
      await client.db('admin').command({ ping: 1 });
    },

    async listDatabases() {
      await client.connect();
      const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true });
      return databases
        .map((entry) => entry.name)
        .filter((name) => !SYSTEM_DATABASES.has(name))
        .toSorted();
    },

    async listCollections(database) {
      await client.connect();
      const names = await client.db(database).listCollections({}, { nameOnly: true }).toArray();
      const summaries: CollectionSummary[] = [];
      for (const { name } of names.toSorted((a, b) => a.name.localeCompare(b.name))) {
        if (name.startsWith('system.')) continue;
        summaries.push({
          name,
          count: await collectionOf(database, name)
            .estimatedDocumentCount()
            .catch(() => null)
        });
      }
      return summaries;
    },

    async listEntries(database, collection, { limit, cursor, filter }) {
      await client.connect();
      const base: Filter<Document> = filter?.trim()
        ? (fromJson(JSON.stringify(parseJsonObject(filter, 'The filter'))) as Filter<Document>)
        : {};
      // Keyset paging on _id: stable under inserts, and cheap at any depth.
      const last = afterId(cursor);
      const query = last === undefined ? base : { $and: [base, { _id: { $gt: last } }] };

      let docs: Document[];
      try {
        docs = await collectionOf(database, collection)
          .find(query as Filter<Document>)
          .sort({ _id: 1 })
          .limit(limit + 1)
          .toArray();
      } catch (error) {
        throw new DocumentInputError(error instanceof Error ? error.message : 'Query failed');
      }
      const page = docs.slice(0, limit);
      return {
        entries: page.map((doc) => ({
          id: EJSON.stringify(doc._id, { relaxed: false }),
          value: toJson(doc)
        })),
        nextCursor:
          docs.length > limit
            ? EJSON.stringify({ _id: page.at(-1)?._id }, { relaxed: false })
            : null
      } satisfies EntryPage;
    },

    async saveEntry(database, collection, id, value) {
      await client.connect();
      const doc = fromJson(JSON.stringify(value)) as Document;
      const target = collectionOf(database, collection);
      if (id === null) {
        await target.insertOne(doc);
        return;
      }
      const key = EJSON.parse(id, { relaxed: true });
      // `_id` is immutable; keep whatever the editor shows only if it still matches.
      delete doc._id;
      const result = await target.replaceOne({ _id: key }, doc);
      if (result.matchedCount === 0) throw new DocumentInputError('That document no longer exists');
    },

    async deleteEntry(database, collection, id) {
      await client.connect();
      await collectionOf(database, collection).deleteOne({
        _id: EJSON.parse(id, { relaxed: true })
      });
    },

    async disconnect() {
      await client.close().catch(() => undefined);
    }
  };
}
