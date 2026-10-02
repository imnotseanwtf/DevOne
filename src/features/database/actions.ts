'use server';

import {
  connectionSchema,
  deleteRowSchema,
  insertRowSchema,
  querySchema,
  rowChangesSchema,
  schemaChangesSchema,
  serverConnectionSchema,
  setDefaultDatabaseSchema,
  tableRowsQuerySchema,
  updateRowSchema,
  type ConnectionInput,
  type DatabaseActionResult,
  type SchemaChangesInput,
  type ServerConnectionInput,
  type TableRowsQueryInput,
  type UpdateConnectionInput,
  updateConnectionSchema
} from '@/features/database/schema';
import {
  closeSession,
  createConnection,
  DatabaseAccessError,
  deleteConnection,
  deleteTableRow,
  fetchTableRows,
  getLiveSchema,
  insertTableRow,
  listDatabasesForConnection,
  applySchemaChanges,
  applyTableRowChanges,
  openSession,
  previewSchemaChanges,
  pingServer,
  ReadOnlyConnectionError,
  SchemaChangeError,
  runQuery,
  saveQuery,
  scanSchema,
  setDefaultDatabase,
  testConnection,
  updateConnection,
  updateTableRow
} from '@/features/database/service';
import { requireUser } from '@/lib/auth/session';
import type { DatabaseSchema, QueryResult, RowPage } from '@/lib/database/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/** Provider errors can quote the failing statement; they are shown, never swallowed. */
function describe(error: unknown, fallback: string): string {
  if (error instanceof DatabaseAccessError || error instanceof ReadOnlyConnectionError) {
    return error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function createConnectionAction(
  input: ConnectionInput
): Promise<DatabaseActionResult> {
  const user = await requireUser();
  const parsed = connectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid connection' };
  }

  try {
    await createConnection(user.id, parsed.data.projectId, parsed.data);
    revalidatePath(`/projects/${parsed.data.projectId}/database`);
    revalidatePath(`/projects/${parsed.data.projectId}/erd`);
    revalidatePath(`/projects/${parsed.data.projectId}/resources`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not save the connection') };
  }
}

export async function updateConnectionAction(
  input: UpdateConnectionInput
): Promise<DatabaseActionResult> {
  const user = await requireUser();
  const parsed = updateConnectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid connection' };
  }

  try {
    const { projectId } = await updateConnection(user.id, parsed.data);
    revalidatePath(`/projects/${projectId}/database`);
    revalidatePath(`/projects/${projectId}/erd`);
    revalidatePath(`/projects/${projectId}/resources`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not save the connection') };
  }
}

export async function pingServerAction(
  input: ServerConnectionInput
): Promise<DatabaseActionResult> {
  const user = await requireUser();
  const parsed = serverConnectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid connection details' };
  }

  try {
    await pingServer(user.id, parsed.data);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not reach the database') };
  }
}

export interface ListDatabasesResult extends DatabaseActionResult {
  databases?: string[];
}

const connectionIdSchema = z.object({ connectionId: z.string().min(1) });

export async function testConnectionAction(input: unknown): Promise<DatabaseActionResult> {
  const user = await requireUser();
  const parsed = connectionIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a connection' };

  try {
    await testConnection(user.id, parsed.data.connectionId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not reach the database') };
  }
}

export async function scanSchemaAction(input: unknown): Promise<DatabaseActionResult> {
  const user = await requireUser();
  const parsed = connectionIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a connection' };

  try {
    const { projectId } = await scanSchema(user.id, parsed.data.connectionId);
    revalidatePath(`/projects/${projectId}/database`);
    revalidatePath(`/projects/${projectId}/erd`);
    revalidatePath(`/projects/${projectId}/resources`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not read the schema') };
  }
}

export async function deleteConnectionAction(input: unknown): Promise<DatabaseActionResult> {
  const user = await requireUser();
  const parsed = connectionIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a connection' };

  try {
    const deletedProjectId = await deleteConnection(user.id, parsed.data.connectionId);
    revalidatePath(`/projects/${deletedProjectId}/database`);
    revalidatePath(`/projects/${deletedProjectId}/erd`);
    revalidatePath(`/projects/${deletedProjectId}/resources`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not remove the connection') };
  }
}

export interface RunQueryResult extends DatabaseActionResult {
  result?: QueryResult;
}

export async function runQueryAction(input: unknown): Promise<RunQueryResult> {
  const user = await requireUser();
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid query' };
  }

  try {
    const result = await runQuery(
      user.id,
      parsed.data.connectionId,
      parsed.data.sql,
      parsed.data.allowWrite,
      parsed.data.sessionId,
      parsed.data.database
    );
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: describe(error, 'The query failed') };
  }
}

export interface ConnectSessionResult extends DatabaseActionResult {
  sessionId?: string;
}

const connectSessionSchema = z.object({
  connectionId: z.string().min(1),
  database: z.string().min(1).max(128).optional()
});

export async function connectSessionAction(input: unknown): Promise<ConnectSessionResult> {
  const user = await requireUser();
  const parsed = connectSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a connection' };

  try {
    const sessionId = await openSession(user.id, parsed.data.connectionId, parsed.data.database);
    return { ok: true, sessionId };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not connect') };
  }
}

const sessionIdSchema = z.object({ sessionId: z.string().min(1) });

export async function disconnectSessionAction(input: unknown): Promise<DatabaseActionResult> {
  const user = await requireUser();
  const parsed = sessionIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid session' };

  await closeSession(user.id, parsed.data.sessionId);
  return { ok: true };
}

export interface FetchTableRowsResult extends DatabaseActionResult {
  page?: RowPage;
}

export async function fetchTableRowsAction(
  input: TableRowsQueryInput
): Promise<FetchTableRowsResult> {
  const user = await requireUser();
  const parsed = tableRowsQuerySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' };
  }

  try {
    const page = await fetchTableRows(
      user.id,
      parsed.data.connectionId,
      parsed.data.schema,
      parsed.data.table,
      {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        filter: parsed.data.filter,
        search: parsed.data.search,
        searchColumns: parsed.data.searchColumns,
        columnFilters: parsed.data.columnFilters
      },
      parsed.data.database
    );
    return { ok: true, page };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not load rows') };
  }
}

export async function insertTableRowAction(input: unknown): Promise<DatabaseActionResult> {
  const user = await requireUser();
  const parsed = insertRowSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid row' };
  }

  try {
    await insertTableRow(
      user.id,
      parsed.data.connectionId,
      parsed.data.schema,
      parsed.data.table,
      parsed.data.values,
      parsed.data.database
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not add the row') };
  }
}

export async function updateTableRowAction(input: unknown): Promise<DatabaseActionResult> {
  const user = await requireUser();
  const parsed = updateRowSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid row' };
  }

  try {
    await updateTableRow(
      user.id,
      parsed.data.connectionId,
      parsed.data.schema,
      parsed.data.table,
      parsed.data.values,
      parsed.data.where,
      parsed.data.database
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not save the change') };
  }
}

export async function deleteTableRowAction(input: unknown): Promise<DatabaseActionResult> {
  const user = await requireUser();
  const parsed = deleteRowSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid row' };
  }

  try {
    await deleteTableRow(
      user.id,
      parsed.data.connectionId,
      parsed.data.schema,
      parsed.data.table,
      parsed.data.where,
      parsed.data.database
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not delete the row') };
  }
}

export async function applyTableRowChangesAction(input: unknown): Promise<DatabaseActionResult> {
  const user = await requireUser();
  const parsed = rowChangesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid changes' };
  }

  try {
    await applyTableRowChanges(
      user.id,
      parsed.data.connectionId,
      parsed.data.schema,
      parsed.data.table,
      parsed.data.changes,
      parsed.data.database
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not apply the changes') };
  }
}

export async function listDatabasesForConnectionAction(
  input: unknown
): Promise<ListDatabasesResult> {
  const user = await requireUser();
  const parsed = connectionIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a connection' };

  try {
    const databases = await listDatabasesForConnection(user.id, parsed.data.connectionId);
    return { ok: true, databases };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not list databases') };
  }
}

export interface GetLiveSchemaResult extends DatabaseActionResult {
  schema?: DatabaseSchema;
}

const liveSchemaSchema = z.object({
  connectionId: z.string().min(1),
  database: z.string().min(1).max(128)
});

export async function getLiveSchemaAction(input: unknown): Promise<GetLiveSchemaResult> {
  const user = await requireUser();
  const parsed = liveSchemaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Pick a database' };

  try {
    const schema = await getLiveSchema(user.id, parsed.data.connectionId, parsed.data.database);
    return { ok: true, schema };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not read the schema') };
  }
}

export async function setDefaultDatabaseAction(input: unknown): Promise<DatabaseActionResult> {
  const user = await requireUser();
  const parsed = setDefaultDatabaseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' };
  }

  try {
    const projectId = await setDefaultDatabase(
      user.id,
      parsed.data.connectionId,
      parsed.data.database
    );
    revalidatePath(`/projects/${projectId}/database`);
    revalidatePath(`/projects/${projectId}/erd`);
    revalidatePath(`/projects/${projectId}/resources`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not switch the database') };
  }
}

const saveQuerySchema = z.object({
  connectionId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  sql: z.string().trim().min(1).max(50_000)
});

export async function saveQueryAction(input: unknown): Promise<DatabaseActionResult> {
  const user = await requireUser();
  const parsed = saveQuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Name the query before saving it' };

  try {
    const saved = await saveQuery(
      user.id,
      parsed.data.connectionId,
      parsed.data.name,
      parsed.data.sql
    );
    revalidatePath(`/projects/${saved.projectId}/database`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not save the query') };
  }
}

export interface PreviewSchemaChangesResult extends DatabaseActionResult {
  statements?: string[];
}

export async function previewSchemaChangesAction(
  input: SchemaChangesInput
): Promise<PreviewSchemaChangesResult> {
  const user = await requireUser();
  const parsed = schemaChangesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid changes' };
  }

  try {
    const statements = await previewSchemaChanges(
      user.id,
      parsed.data.connectionId,
      parsed.data.changes,
      parsed.data.database
    );
    return { ok: true, statements };
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not build the SQL') };
  }
}

export interface ApplySchemaChangesResult extends DatabaseActionResult {
  /** How many leading changes stayed applied after a failure (MySQL only). */
  appliedChanges?: number;
}

export async function applySchemaChangesAction(
  input: SchemaChangesInput
): Promise<ApplySchemaChangesResult> {
  const user = await requireUser();
  const parsed = schemaChangesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid changes' };
  }

  try {
    const projectId = await applySchemaChanges(
      user.id,
      parsed.data.connectionId,
      parsed.data.changes,
      parsed.data.database
    );
    revalidatePath(`/projects/${projectId}/database`);
    revalidatePath(`/projects/${projectId}/erd`);
    revalidatePath(`/projects/${projectId}/resources`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: describe(error, 'Could not apply the changes'),
      appliedChanges: error instanceof SchemaChangeError ? error.appliedChanges : 0
    };
  }
}
