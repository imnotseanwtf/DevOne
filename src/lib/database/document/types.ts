import type { ConnectionConfig } from '@/lib/database/types';

/** What a collection is called in each engine's own words. */
export interface DocumentVocabulary {
  /** A group of entries: collection, table, or the Redis keyspace. */
  collection: string;
  /** One entry: document, item, or key. */
  entry: string;
  /** Placeholder for the filter box. */
  filterHint: string;
}

export interface CollectionSummary {
  name: string;
  /** Null when counting is too expensive or unavailable. */
  count: number | null;
  /** Extra context shown under the name, e.g. DynamoDB's key schema. */
  description?: string;
}

/**
 * One document / item / key. `id` identifies it for save and delete (a Mongo
 * `_id` as Extended JSON, a DynamoDB key as JSON, a Redis key name). `value` is
 * always plain JSON, so the browser can show and edit it as text.
 */
export interface DocumentEntry {
  id: string;
  value: unknown;
}

export interface EntryQuery {
  limit: number;
  /** Opaque, from the previous page's `nextCursor`; absent for the first page. */
  cursor?: string;
  /** Engine-specific: Mongo JSON filter, DynamoDB JSON equality map, Redis glob. */
  filter?: string;
}

export interface EntryPage {
  entries: DocumentEntry[];
  nextCursor: string | null;
}

export interface DocumentAdapter {
  vocabulary: DocumentVocabulary;
  testConnection(): Promise<void>;
  /** MongoDB databases, Redis logical databases, or the one DynamoDB region. */
  listDatabases(): Promise<string[]>;
  listCollections(database: string): Promise<CollectionSummary[]>;
  listEntries(database: string, collection: string, query: EntryQuery): Promise<EntryPage>;
  /** Replaces the entry `id`, or creates one when `id` is null. */
  saveEntry(database: string, collection: string, id: string | null, value: unknown): Promise<void>;
  deleteEntry(database: string, collection: string, id: string): Promise<void>;
  disconnect(): Promise<void>;
}

export type DocumentAdapterFactory = (config: ConnectionConfig) => DocumentAdapter;

/** Raised for input the person can fix, e.g. malformed filter JSON. */
export class DocumentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentInputError';
  }
}

export function parseJsonObject(text: string, what: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DocumentInputError(`${what} is not valid JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DocumentInputError(`${what} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export const MAX_ENTRIES_PER_PAGE = 100;
