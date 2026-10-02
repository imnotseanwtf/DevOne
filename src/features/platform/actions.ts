'use server';

import {
  clearHistory,
  createApiRequest,
  createCollection,
  createEnvironment,
  deleteApiRequest,
  deleteCollection,
  createDocFolder,
  deleteDoc,
  deleteDocFolder,
  duplicateApiRequest,
  fetchOpenApiSpec,
  getApiRequestDocs,
  importCollection,
  importEnvironment,
  linkDocToIssue,
  PlatformAccessError,
  renameCollection,
  deleteFolder,
  renameFolder,
  moveDoc,
  renameDocFolder,
  saveDoc,
  sendRequest,
  setApiRequestFolder,
  unlinkDocFromIssue,
  updateApiRequest,
  type HttpResponseSummary
} from '@/features/platform/service';
import { ResourceAccessError } from '@/features/resources/service';
import { requireUser } from '@/lib/auth/session';
import { BlockedRequestError } from '@/lib/api-client/guard';
import {
  assertOpenApi,
  OpenApiImportError,
  type OperationDocs,
  openApiToCollection,
  parseDocumentText
} from '@/lib/api-client/openapi';
import { isPostmanCollection, postmanToCollection } from '@/lib/api-client/postman';
import { authSchema, BODY_TYPES, HTTP_METHODS, NO_AUTH } from '@/lib/api-client/types';
import { toProjectSlug } from '@/lib/projects/slug';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

export interface PlatformActionResult {
  ok: boolean;
  error?: string;
}

export interface SaveDocActionResult extends PlatformActionResult {
  docId?: string;
  slug?: string;
}

function fail(error: unknown, fallback: string): PlatformActionResult {
  if (
    error instanceof BlockedRequestError ||
    error instanceof PlatformAccessError ||
    error instanceof ResourceAccessError
  ) {
    return { ok: false, error: error.message };
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return { ok: false, error: 'The request timed out' };
  }
  return { ok: false, error: fallback };
}

const draftSchema = z.object({
  method: z.enum(HTTP_METHODS),
  url: z.string().trim().min(1, 'Enter a URL').max(8_000),
  headers: z.record(z.string(), z.string().max(10_000)).default({}),
  body: z.string().max(1_000_000).default(''),
  bodyType: z.enum(BODY_TYPES).default('JSON'),
  auth: authSchema.default(NO_AUTH),
  pathParams: z.record(z.string().max(200), z.string().max(2_000)).default({})
});

const nameSchema = z.string().trim().min(1, 'Give it a name').max(80);

const apiPath = (projectId: string) => `/projects/${projectId}/api`;

function invalid(error: z.ZodError, fallback: string): PlatformActionResult {
  return { ok: false, error: error.issues[0]?.message ?? fallback };
}

const sendSchema = z.object({
  projectId: z.string().min(1),
  draft: draftSchema,
  environmentId: z.string().min(1).nullish()
});

export interface SendRequestResult extends PlatformActionResult {
  response?: HttpResponseSummary;
}

export async function sendRequestAction(input: unknown): Promise<SendRequestResult> {
  const user = await requireUser();
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error, 'Invalid request');

  try {
    const response = await sendRequest(
      user.id,
      parsed.data.projectId,
      parsed.data.draft,
      parsed.data.environmentId
    );
    return { ok: true, response };
  } catch (error) {
    if (error instanceof TypeError) {
      // fetch() reports DNS, TLS and connection failures as a TypeError.
      return { ok: false, error: 'Could not connect to the server' };
    }
    return fail(error, 'The request failed');
  } finally {
    // Every attempt lands in history, so the sidebar list needs refreshing.
    revalidatePath(apiPath(parsed.data.projectId));
  }
}

// Collections ------------------------------------------------------------------

export interface CollectionActionResult extends PlatformActionResult {
  collectionId?: string;
  /** Import: what was created, for the confirmation toast. */
  imported?: { format: 'openapi' | 'postman'; requests: number; environment?: string };
}

const createCollectionSchema = z.object({ projectId: z.string().min(1), name: nameSchema });

export async function createCollectionAction(input: unknown): Promise<CollectionActionResult> {
  const user = await requireUser();
  const parsed = createCollectionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error, 'Invalid collection');

  try {
    const collection = await createCollection(user.id, parsed.data.projectId, parsed.data.name);
    revalidatePath(apiPath(collection.projectId));
    return { ok: true, collectionId: collection.id };
  } catch (error) {
    return fail(error, 'Could not create the collection');
  }
}

const renameCollectionSchema = z.object({ collectionId: z.string().min(1), name: nameSchema });

export async function renameCollectionAction(input: unknown): Promise<PlatformActionResult> {
  const user = await requireUser();
  const parsed = renameCollectionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error, 'Invalid collection');

  try {
    const collection = await renameCollection(user.id, parsed.data.collectionId, parsed.data.name);
    revalidatePath(apiPath(collection.projectId));
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not rename the collection');
  }
}

const collectionIdSchema = z.object({ collectionId: z.string().min(1) });

export async function deleteCollectionAction(input: unknown): Promise<PlatformActionResult> {
  const user = await requireUser();
  const parsed = collectionIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid collection' };

  try {
    const collection = await deleteCollection(user.id, parsed.data.collectionId);
    revalidatePath(apiPath(collection.projectId));
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not delete the collection');
  }
}

// Requests ---------------------------------------------------------------------

export interface ApiRequestActionResult extends PlatformActionResult {
  requestId?: string;
}

const folderSchema = z.string().trim().max(200);

const createApiRequestSchema = z.object({
  collectionId: z.string().min(1),
  name: nameSchema,
  draft: draftSchema,
  folder: folderSchema.nullish()
});

export async function createApiRequestAction(input: unknown): Promise<ApiRequestActionResult> {
  const user = await requireUser();
  const parsed = createApiRequestSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error, 'Invalid request');

  try {
    const request = await createApiRequest(
      user.id,
      parsed.data.collectionId,
      parsed.data.name,
      parsed.data.draft,
      parsed.data.folder
    );
    revalidatePath(apiPath(request.projectId));
    return { ok: true, requestId: request.id };
  } catch (error) {
    return fail(error, 'Could not save the request');
  }
}

const updateApiRequestSchema = createApiRequestSchema.extend({ requestId: z.string().min(1) });

export async function updateApiRequestAction(input: unknown): Promise<ApiRequestActionResult> {
  const user = await requireUser();
  const parsed = updateApiRequestSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error, 'Invalid request');

  try {
    const request = await updateApiRequest(
      user.id,
      parsed.data.requestId,
      parsed.data.name,
      parsed.data.draft,
      parsed.data.collectionId,
      parsed.data.folder
    );
    revalidatePath(apiPath(request.projectId));
    return { ok: true, requestId: request.id };
  } catch (error) {
    return fail(error, 'Could not save the request');
  }
}

const requestIdSchema = z.object({ requestId: z.string().min(1) });

const requestFolderSchema = requestIdSchema.extend({ folder: folderSchema });

export async function setApiRequestFolderAction(input: unknown): Promise<PlatformActionResult> {
  const user = await requireUser();
  const parsed = requestFolderSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error, 'Invalid folder');

  try {
    const { projectId } = await setApiRequestFolder(
      user.id,
      parsed.data.requestId,
      parsed.data.folder
    );
    revalidatePath(apiPath(projectId));
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not move the request');
  }
}

export async function duplicateApiRequestAction(input: unknown): Promise<ApiRequestActionResult> {
  const user = await requireUser();
  const parsed = requestIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request' };

  try {
    const copy = await duplicateApiRequest(user.id, parsed.data.requestId);
    revalidatePath(apiPath(copy.projectId));
    return { ok: true, requestId: copy.id };
  } catch (error) {
    return fail(error, 'Could not duplicate the request');
  }
}

export interface ApiRequestDocsResult extends PlatformActionResult {
  docs?: OperationDocs | null;
}

export async function getApiRequestDocsAction(input: unknown): Promise<ApiRequestDocsResult> {
  const user = await requireUser();
  const parsed = requestIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request' };

  try {
    const docs = await getApiRequestDocs(user.id, parsed.data.requestId);
    return { ok: true, docs: (docs ?? null) as OperationDocs | null };
  } catch (error) {
    return fail(error, 'Could not load the docs');
  }
}

export async function deleteApiRequestAction(input: unknown): Promise<PlatformActionResult> {
  const user = await requireUser();
  const parsed = requestIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request' };

  try {
    const { projectId } = await deleteApiRequest(user.id, parsed.data.requestId);
    revalidatePath(apiPath(projectId));
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not delete the request');
  }
}

// Folders ----------------------------------------------------------------------

const renameFolderSchema = z.object({
  collectionId: z.string().min(1),
  from: folderSchema.min(1),
  to: folderSchema.min(1, 'Give the folder a name')
});

export async function renameFolderAction(input: unknown): Promise<PlatformActionResult> {
  const user = await requireUser();
  const parsed = renameFolderSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error, 'Invalid folder');

  try {
    const collection = await renameFolder(
      user.id,
      parsed.data.collectionId,
      parsed.data.from,
      parsed.data.to
    );
    revalidatePath(apiPath(collection.projectId));
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not rename the folder');
  }
}

const deleteFolderSchema = z.object({
  collectionId: z.string().min(1),
  path: folderSchema.min(1)
});

export interface DeleteFolderActionResult extends PlatformActionResult {
  requestIds?: string[];
}

export async function deleteFolderAction(input: unknown): Promise<DeleteFolderActionResult> {
  const user = await requireUser();
  const parsed = deleteFolderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid folder' };

  try {
    const result = await deleteFolder(user.id, parsed.data.collectionId, parsed.data.path);
    revalidatePath(apiPath(result.projectId));
    return { ok: true, requestIds: result.requestIds };
  } catch (error) {
    return fail(error, 'Could not delete the folder');
  }
}

// Import -------------------------------------------------------------------------

const importOpenApiSchema = z.object({
  projectId: z.string().min(1),
  /** Either a URL to download, or the document itself. */
  source: z.string().trim().min(1, 'Paste a URL or a document').max(5_000_000)
});

export async function importOpenApiAction(input: unknown): Promise<CollectionActionResult> {
  const user = await requireUser();
  const parsed = importOpenApiSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error, 'Invalid document');

  const { projectId, source } = parsed.data;
  try {
    const isUrl = /^https?:\/\/\S+$/i.test(source);
    const text = isUrl ? await fetchOpenApiSpec(user.id, projectId, source) : source;
    const doc = parseDocumentText(text);

    // A Postman collection export: requests, folders and auth, plus its variables.
    if (isPostmanCollection(doc)) {
      const imported = postmanToCollection(doc);
      const collection = await importCollection(user.id, projectId, imported);
      const environment =
        imported.variables.length > 0
          ? await importEnvironment(user.id, projectId, imported.title, imported.variables)
          : null;
      revalidatePath(apiPath(projectId));
      if (environment) revalidatePath(`/projects/${projectId}/resources`);
      return {
        ok: true,
        collectionId: collection.id,
        imported: {
          format: 'postman',
          requests: imported.requests.length,
          environment: environment?.name
        }
      };
    }

    const imported = openApiToCollection(assertOpenApi(doc), isUrl ? source : undefined);
    if (imported.requests.length === 0) {
      return { ok: false, error: 'The document has no operations to import' };
    }

    const collection = await importCollection(user.id, projectId, imported);
    revalidatePath(apiPath(projectId));
    return {
      ok: true,
      collectionId: collection.id,
      imported: { format: 'openapi', requests: imported.requests.length }
    };
  } catch (error) {
    if (error instanceof OpenApiImportError) return { ok: false, error: error.message };
    return fail(error, 'Could not import the document');
  }
}

// History ------------------------------------------------------------------------

const projectIdSchema = z.object({ projectId: z.string().min(1) });

export async function clearHistoryAction(input: unknown): Promise<PlatformActionResult> {
  const user = await requireUser();
  const parsed = projectIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid project' };

  try {
    await clearHistory(user.id, parsed.data.projectId);
    revalidatePath(apiPath(parsed.data.projectId));
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not clear the history');
  }
}

// Environments -------------------------------------------------------------------

const environmentSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(60)
});

export async function createEnvironmentAction(input: unknown): Promise<PlatformActionResult> {
  const user = await requireUser();
  const parsed = environmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Name the environment' };

  try {
    await createEnvironment(user.id, parsed.data.projectId, parsed.data.name);
    revalidatePath(apiPath(parsed.data.projectId));
    revalidatePath(`/projects/${parsed.data.projectId}/resources`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not create the environment');
  }
}

const docSchema = z.object({
  docId: z.string().min(1).optional(),
  projectId: z.string().min(1),
  title: z.string().trim().min(2, 'Give the page a title').max(200),
  body: z.string().max(200_000).default(''),
  folder: z.string().max(200).nullish()
});

export async function saveDocAction(input: unknown): Promise<SaveDocActionResult> {
  const user = await requireUser();
  const parsed = docSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid page'
    };
  }

  try {
    const doc = await saveDoc(
      user.id,
      parsed.data.projectId,
      toProjectSlug(parsed.data.title),
      parsed.data.title,
      parsed.data.body,
      parsed.data.docId,
      parsed.data.folder
    );
    revalidatePath(`/projects/${parsed.data.projectId}/docs`);
    return { ok: true, docId: doc.id, slug: doc.slug };
  } catch (error) {
    return fail(error, 'Could not save the page');
  }
}

const moveDocSchema = z.object({
  projectId: z.string().min(1),
  docId: z.string().min(1),
  folder: z.string().max(200).nullable()
});

export async function moveDocAction(input: unknown): Promise<PlatformActionResult> {
  const user = await requireUser();
  const parsed = moveDocSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid folder' };
  try {
    await moveDoc(user.id, parsed.data.projectId, parsed.data.docId, parsed.data.folder);
    revalidatePath(`/projects/${parsed.data.projectId}/docs`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not move the page');
  }
}

const renameDocFolderSchema = z.object({
  projectId: z.string().min(1),
  from: z.string().min(1).max(200),
  to: z.string().trim().min(1, 'Name the folder').max(200)
});

export async function renameDocFolderAction(input: unknown): Promise<PlatformActionResult> {
  const user = await requireUser();
  const parsed = renameDocFolderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  try {
    await renameDocFolder(user.id, parsed.data.projectId, parsed.data.from, parsed.data.to);
    revalidatePath(`/projects/${parsed.data.projectId}/docs`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not rename the folder');
  }
}

const docFolderSchema = z.object({
  projectId: z.string().min(1),
  path: z.string().trim().min(1, 'Name the folder').max(200)
});

export async function createDocFolderAction(input: unknown): Promise<PlatformActionResult> {
  const user = await requireUser();
  const parsed = docFolderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  try {
    await createDocFolder(user.id, parsed.data.projectId, parsed.data.path);
    revalidatePath(`/projects/${parsed.data.projectId}/docs`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not create the folder');
  }
}

export async function deleteDocFolderAction(input: unknown): Promise<PlatformActionResult> {
  const user = await requireUser();
  const parsed = docFolderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid folder' };
  try {
    await deleteDocFolder(user.id, parsed.data.projectId, parsed.data.path);
    revalidatePath(`/projects/${parsed.data.projectId}/docs`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not delete the folder');
  }
}

const deleteDocSchema = z.object({
  projectId: z.string().min(1),
  docId: z.string().min(1)
});

export async function deleteDocAction(input: unknown): Promise<PlatformActionResult> {
  const user = await requireUser();
  const parsed = deleteDocSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid page' };

  try {
    await deleteDoc(user.id, parsed.data.projectId, parsed.data.docId);
    revalidatePath(`/projects/${parsed.data.projectId}/docs`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not delete the page');
  }
}

const docIssueLinkSchema = z.object({
  projectId: z.string().min(1),
  docId: z.string().min(1),
  issueId: z.string().min(1)
});

export async function linkDocToIssueAction(input: unknown): Promise<PlatformActionResult> {
  const user = await requireUser();
  const parsed = docIssueLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid link' };

  try {
    await linkDocToIssue(user.id, parsed.data.projectId, parsed.data.docId, parsed.data.issueId);
    revalidatePath(`/projects/${parsed.data.projectId}/docs`);
    revalidatePath(`/projects/${parsed.data.projectId}/issues`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not link the task');
  }
}

export async function unlinkDocFromIssueAction(input: unknown): Promise<PlatformActionResult> {
  const user = await requireUser();
  const parsed = docIssueLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid link' };

  try {
    await unlinkDocFromIssue(
      user.id,
      parsed.data.projectId,
      parsed.data.docId,
      parsed.data.issueId
    );
    revalidatePath(`/projects/${parsed.data.projectId}/docs`);
    revalidatePath(`/projects/${parsed.data.projectId}/issues`);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not remove the link');
  }
}
