'use server';

import {
  deleteEntry,
  listCollections,
  listEntries,
  saveEntry
} from '@/features/database/document-service';
import { DatabaseAccessError, ReadOnlyConnectionError } from '@/features/database/service';
import { requireUser } from '@/lib/auth/session';
import {
  DocumentInputError,
  MAX_ENTRIES_PER_PAGE,
  type CollectionSummary,
  type DocumentEntry,
  type DocumentVocabulary
} from '@/lib/database/document/types';
import { z } from 'zod';

interface Result {
  ok: boolean;
  error?: string;
}

function describe(error: unknown, fallback: string): string {
  if (
    error instanceof DatabaseAccessError ||
    error instanceof ReadOnlyConnectionError ||
    error instanceof DocumentInputError
  ) {
    return error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

const scope = {
  connectionId: z.string().min(1),
  database: z.string().min(1).max(128)
};

const collectionName = z.string().min(1).max(512);

export interface ListCollectionsResult extends Result {
  collections?: CollectionSummary[];
  vocabulary?: DocumentVocabulary;
}

export async function listCollectionsAction(input: unknown): Promise<ListCollectionsResult> {
  const user = await requireUser();
  const parsed = z.object(scope).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request' };
  try {
    const { collections, vocabulary } = await listCollections(
      user.id,
      parsed.data.connectionId,
      parsed.data.database
    );
    return { ok: true, collections, vocabulary };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not list collections') };
  }
}

const entriesSchema = z.object({
  ...scope,
  collection: collectionName,
  cursor: z.string().max(4096).optional(),
  filter: z.string().max(10_000).optional(),
  limit: z.number().int().min(1).max(MAX_ENTRIES_PER_PAGE).default(50)
});

export interface ListEntriesResult extends Result {
  entries?: DocumentEntry[];
  nextCursor?: string | null;
}

export async function listEntriesAction(input: unknown): Promise<ListEntriesResult> {
  const user = await requireUser();
  const parsed = entriesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request' };
  const { connectionId, database, collection, ...query } = parsed.data;
  try {
    const page = await listEntries(user.id, connectionId, database, collection, query);
    return { ok: true, entries: page.entries, nextCursor: page.nextCursor };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not load entries') };
  }
}

const saveSchema = z.object({
  ...scope,
  collection: collectionName,
  /** Null creates a new entry. */
  id: z.string().min(1).max(4096).nullable(),
  /** The editor's text; parsed here so the server never trusts client-parsed JSON. */
  json: z.string().min(1).max(1_000_000)
});

export async function saveEntryAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request' };

  let value: unknown;
  try {
    value = JSON.parse(parsed.data.json);
  } catch {
    return { ok: false, error: 'The value is not valid JSON' };
  }

  try {
    await saveEntry(
      user.id,
      parsed.data.connectionId,
      parsed.data.database,
      parsed.data.collection,
      parsed.data.id,
      value
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not save') };
  }
}

const deleteSchema = z.object({
  ...scope,
  collection: collectionName,
  id: z.string().min(1).max(4096)
});

export async function deleteEntryAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request' };
  try {
    await deleteEntry(
      user.id,
      parsed.data.connectionId,
      parsed.data.database,
      parsed.data.collection,
      parsed.data.id
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not delete') };
  }
}
