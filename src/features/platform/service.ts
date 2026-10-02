import { Prisma } from '@/generated/prisma/client';
import { getPrisma } from '@/lib/db/prisma';
import {
  createNamedResource,
  listResources,
  resolveResourceAuth,
  resolveResourceHeaders,
  resolveResourceVariables
} from '@/features/resources/service';
import { applyVariables, assertSafeRequestUrl, BlockedRequestError } from '@/lib/api-client/guard';
import type { ImportedCollection } from '@/lib/api-client/openapi';
import {
  buildOutgoingRequest,
  authVariables,
  NO_AUTH,
  withEnvironmentAuth,
  withEnvironmentHeaders,
  isInFolder,
  normalizeFolder,
  type ApiRequestDraft
} from '@/lib/api-client/types';
import {
  deleteFolderRows,
  ensureFolder,
  listFolderPaths,
  renameFolderRows
} from '@/lib/db/content-folders';
import { renamedFolder } from '@/lib/folders';
import { randomUUID } from 'node:crypto';

export class PlatformAccessError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'PlatformAccessError';
  }
}

async function requireProjectMembership(userId: string, projectId: string) {
  const membership = await getPrisma().projectMember.findFirst({
    where: { projectId, userId },
    select: { id: true }
  });
  if (!membership) throw new PlatformAccessError();
}

// Environments ---------------------------------------------------------------
// The API client's environments are the project's resources (Resources page):
// the resource URL fills `{{baseUrl}}` and its keys fill the other placeholders.

/** Secret values are replaced with null; only the server ever sees them. */
export async function listEnvironments(userId: string, projectId: string) {
  const resources = await listResources(userId, projectId);
  // Only API endpoints are environments; app links, tags and images aren't called.
  return resources
    .filter((resource) => resource.kind === 'API')
    .map((resource) => ({
      id: resource.id,
      name: resource.name,
      personal: resource.personal,
      environment: resource.environment,
      auth: resource.auth,
      url: resource.url,
      variables: resource.variables,
      headers: resource.headers
    }));
}

export async function createEnvironment(userId: string, projectId: string, name: string) {
  return createNamedResource(userId, projectId, name);
}

/** A new environment holding an imported collection's variables, e.g. from Postman. */
export async function importEnvironment(
  userId: string,
  projectId: string,
  name: string,
  variables: { key: string; value: string }[]
) {
  return createNamedResource(userId, projectId, name, variables);
}

// API client -----------------------------------------------------------------

/** Loads a collection the user can reach through project membership. */
async function requireCollection(userId: string, collectionId: string) {
  const collection = await getPrisma().apiCollection.findFirst({
    where: { id: collectionId, project: { members: { some: { userId } } } }
  });
  if (!collection) throw new PlatformAccessError();
  return collection;
}

async function requireApiRequest(userId: string, requestId: string) {
  const request = await getPrisma().apiRequest.findFirst({
    where: { id: requestId, collection: { project: { members: { some: { userId } } } } },
    include: { collection: { select: { projectId: true } } }
  });
  if (!request) throw new PlatformAccessError();
  return request;
}

/** Collection names are unique per project, so clashes get a " (2)" style suffix. */
async function availableCollectionName(projectId: string, name: string, exceptId?: string) {
  const taken = new Set(
    (
      await getPrisma().apiCollection.findMany({
        where: {
          projectId,
          name: { startsWith: name },
          NOT: exceptId ? { id: exceptId } : undefined
        },
        select: { name: true }
      })
    ).map((collection) => collection.name)
  );
  if (!taken.has(name)) return name;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${name} (${suffix})`;
    if (!taken.has(candidate)) return candidate;
  }
}

function requestData(draft: ApiRequestDraft) {
  return {
    method: draft.method,
    url: draft.url,
    headersJson: draft.headers,
    body: draft.body || null,
    bodyType: draft.bodyType,
    authJson: draft.auth.type === 'none' ? Prisma.DbNull : draft.auth,
    pathParamsJson: Object.keys(draft.pathParams).length > 0 ? draft.pathParams : Prisma.DbNull
  };
}

export async function listCollections(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().apiCollection.findMany({
    where: { projectId },
    // Docs can run to hundreds of KB per import; they're fetched per request instead.
    include: {
      requests: { omit: { docsJson: true }, orderBy: [{ createdAt: 'asc' }, { name: 'asc' }] }
    },
    orderBy: { name: 'asc' }
  });
}

export async function createCollection(userId: string, projectId: string, name: string) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().apiCollection.create({
    data: { projectId, name: await availableCollectionName(projectId, name) }
  });
}

export async function renameCollection(userId: string, collectionId: string, name: string) {
  const collection = await requireCollection(userId, collectionId);
  return getPrisma().apiCollection.update({
    where: { id: collectionId },
    data: { name: await availableCollectionName(collection.projectId, name, collectionId) }
  });
}

export async function deleteCollection(userId: string, collectionId: string) {
  const collection = await requireCollection(userId, collectionId);
  await getPrisma().apiCollection.delete({ where: { id: collectionId } });
  return collection;
}

export async function createApiRequest(
  userId: string,
  collectionId: string,
  name: string,
  draft: ApiRequestDraft,
  folder?: string | null
) {
  const collection = await requireCollection(userId, collectionId);
  const request = await getPrisma().apiRequest.create({
    data: { collectionId, name, folder: normalizeFolder(folder), ...requestData(draft) }
  });
  return { ...request, projectId: collection.projectId };
}

/**
 * Saves the editor's state; passing another `collectionId` moves the request.
 * `folder` is left alone when undefined, since the editor doesn't carry it.
 */
export async function updateApiRequest(
  userId: string,
  requestId: string,
  name: string,
  draft: ApiRequestDraft,
  collectionId?: string,
  folder?: string | null
) {
  const existing = await requireApiRequest(userId, requestId);
  if (collectionId && collectionId !== existing.collectionId) {
    const target = await requireCollection(userId, collectionId);
    if (target.projectId !== existing.collection.projectId) throw new PlatformAccessError();
  }

  const request = await getPrisma().apiRequest.update({
    where: { id: requestId },
    data: {
      name,
      collectionId: collectionId ?? existing.collectionId,
      ...(folder === undefined ? {} : { folder: normalizeFolder(folder) }),
      ...requestData(draft)
    }
  });
  return { ...request, projectId: existing.collection.projectId };
}

/** Moves a request into a folder of its collection; an empty name takes it out of any folder. */
export async function setApiRequestFolder(userId: string, requestId: string, folder: string) {
  const request = await requireApiRequest(userId, requestId);
  await getPrisma().apiRequest.update({
    where: { id: requestId },
    data: { folder: normalizeFolder(folder) }
  });
  return { projectId: request.collection.projectId };
}

/** Requests in `path` or any folder beneath it. */
async function requestsInFolder(collectionId: string, path: string) {
  const requests = await getPrisma().apiRequest.findMany({
    where: { collectionId, OR: [{ folder: path }, { folder: { startsWith: `${path}/` } }] },
    select: { id: true, folder: true }
  });
  return requests.filter((request) => isInFolder(request.folder, path));
}

/** Renames or moves a folder with everything nested in it, e.g. `Stock` to `Store/Stock`. */
export async function renameFolder(userId: string, collectionId: string, from: string, to: string) {
  const collection = await requireCollection(userId, collectionId);
  const source = normalizeFolder(from);
  const target = normalizeFolder(to);
  if (!source || !target) throw new PlatformAccessError('Give the folder a name');
  if (isInFolder(target, source) && target !== source) {
    throw new PlatformAccessError('A folder cannot be moved inside itself');
  }

  const requests = await requestsInFolder(collectionId, source);
  await getPrisma().$transaction(
    requests.map((request) =>
      getPrisma().apiRequest.update({
        where: { id: request.id },
        data: { folder: target + (request.folder ?? '').slice(source.length) }
      })
    )
  );
  return collection;
}

/** Deletes a folder, its subfolders and every request in them. */
export async function deleteFolder(userId: string, collectionId: string, path: string) {
  const collection = await requireCollection(userId, collectionId);
  const folder = normalizeFolder(path);
  if (!folder) throw new PlatformAccessError();

  const requests = await requestsInFolder(collectionId, folder);
  await getPrisma().apiRequest.deleteMany({
    where: { id: { in: requests.map((request) => request.id) } }
  });
  return { projectId: collection.projectId, requestIds: requests.map((request) => request.id) };
}

export async function duplicateApiRequest(userId: string, requestId: string) {
  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    collection,
    ...rest
  } = await requireApiRequest(userId, requestId);
  const copy = await getPrisma().apiRequest.create({
    data: {
      ...rest,
      name: `${rest.name} copy`.slice(0, 80),
      headersJson: rest.headersJson ?? Prisma.DbNull,
      authJson: rest.authJson ?? Prisma.DbNull,
      docsJson: rest.docsJson ?? Prisma.DbNull,
      pathParamsJson: rest.pathParamsJson ?? Prisma.DbNull
    }
  });
  return { ...copy, projectId: collection.projectId };
}

export async function getApiRequestDocs(userId: string, requestId: string) {
  const request = await requireApiRequest(userId, requestId);
  return request.docsJson;
}

export async function deleteApiRequest(userId: string, requestId: string) {
  const request = await requireApiRequest(userId, requestId);
  await getPrisma().apiRequest.delete({ where: { id: requestId } });
  return { projectId: request.collection.projectId };
}

/** Creates a collection holding every imported request, in one transaction. */
export async function importCollection(
  userId: string,
  projectId: string,
  imported: ImportedCollection
) {
  await requireProjectMembership(userId, projectId);
  const name = await availableCollectionName(projectId, imported.title);

  // Requests are listed by `createdAt`, so each one gets its own millisecond
  // to keep the document's order (Auth before Products, GET before POST…).
  const startedAt = Date.now();

  return getPrisma().$transaction(async (tx) => {
    const collection = await tx.apiCollection.create({ data: { projectId, name } });
    await tx.apiRequest.createMany({
      data: imported.requests.map(({ name: requestName, folder, docs, ...draft }, index) => ({
        collectionId: collection.id,
        name: requestName,
        folder,
        docsJson: docs as unknown as Prisma.InputJsonValue,
        createdAt: new Date(startedAt + index),
        ...requestData(draft)
      }))
    });
    return { ...collection, count: imported.requests.length };
  });
}

const MAX_SPEC_BYTES = 5 * 1024 * 1024;

/** Downloads an OpenAPI document through the same private-network guard as requests. */
export async function fetchOpenApiSpec(userId: string, projectId: string, url: string) {
  await requireProjectMembership(userId, projectId);
  const safeUrl = await assertSafeRequestUrl(url);

  const response = await fetch(safeUrl, {
    headers: { Accept: 'application/json, application/yaml, text/yaml, */*' },
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    throw new BlockedRequestError(`The document could not be downloaded (HTTP ${response.status})`);
  }

  const raw = await response.arrayBuffer();
  if (raw.byteLength > MAX_SPEC_BYTES) throw new BlockedRequestError('The document is over 5 MB');
  return new TextDecoder().decode(raw);
}

export interface HttpResponseSummary {
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  headers: [string, string][];
  cookies: string[];
  body: string;
  truncated: boolean;
  /** The address fetched, without its query, so an HTML preview can load relative assets. */
  baseUrl: string;
}

const MAX_RESPONSE_BYTES = 512 * 1024;
const HISTORY_LIMIT = 50;

/**
 * Runs a request from the server so the browser is not blocked by CORS. The
 * destination is validated first, and redirects are not followed, because a
 * redirect could otherwise land on an address the guard just rejected.
 *
 * Every attempt is written to history as composed, before substitution, so
 * resolved secrets never reach the history table.
 */
export async function sendRequest(
  userId: string,
  projectId: string,
  draft: ApiRequestDraft,
  environmentId?: string | null
): Promise<HttpResponseSummary> {
  await requireProjectMembership(userId, projectId);

  const variables: Record<string, string> = environmentId
    ? await resolveResourceVariables(userId, environmentId)
    : {};
  const environmentHeaders = environmentId
    ? await resolveResourceHeaders(userId, environmentId)
    : [];
  const environmentAuth = environmentId
    ? await resolveResourceAuth(userId, environmentId)
    : NO_AUTH;
  // The environment's auth stands in for a request with no auth of its own,
  // and fills {{TOKEN}}-style placeholders (over a key of the same name).
  const values = { ...variables, ...authVariables(environmentAuth) };
  const outgoing = buildOutgoingRequest(withEnvironmentAuth(draft, environmentAuth), (text) =>
    applyVariables(text, values)
  );

  let status: number | null = null;
  let durationMs: number | null = null;

  try {
    const missing = outgoing.url.match(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/)?.[1];
    if (missing) {
      throw new BlockedRequestError(
        environmentId
          ? `{{${missing}}} has no value in the selected resource`
          : `Select a resource that sets {{${missing}}}`
      );
    }
    const safeUrl = await assertSafeRequestUrl(outgoing.url);

    const started = performance.now();
    const response = await fetch(safeUrl, {
      method: draft.method,
      headers: withEnvironmentHeaders(
        outgoing.headers,
        // Header values may use `{{KEYS}}` from the same environment.
        environmentHeaders.map(({ name, value }) => ({
          name,
          value: applyVariables(value, values)
        }))
      ),
      body: outgoing.body,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000)
    });

    const raw = await response.arrayBuffer();
    durationMs = Math.round(performance.now() - started);
    status = response.status;

    return {
      status: response.status,
      statusText: response.statusText,
      durationMs,
      sizeBytes: raw.byteLength,
      headers: [...response.headers.entries()].filter(([name]) => name !== 'set-cookie'),
      cookies: response.headers.getSetCookie(),
      body: new TextDecoder().decode(raw.slice(0, MAX_RESPONSE_BYTES)),
      truncated: raw.byteLength > MAX_RESPONSE_BYTES,
      // The query is left out: it may carry substituted keys.
      baseUrl: `${safeUrl.origin}${safeUrl.pathname}`
    };
  } finally {
    await recordHistory(userId, projectId, draft, status, durationMs);
  }
}

async function recordHistory(
  userId: string,
  projectId: string,
  draft: ApiRequestDraft,
  status: number | null,
  durationMs: number | null
) {
  const prisma = getPrisma();
  await prisma.apiHistoryEntry.create({
    data: {
      projectId,
      userId,
      status,
      durationMs,
      ...requestData(draft),
      body: draft.body ? draft.body.slice(0, 100_000) : null
    }
  });

  const stale = await prisma.apiHistoryEntry.findMany({
    where: { projectId, userId },
    orderBy: { createdAt: 'desc' },
    skip: HISTORY_LIMIT,
    select: { id: true }
  });
  if (stale.length > 0) {
    await prisma.apiHistoryEntry.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
  }
}

export async function listHistory(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().apiHistoryEntry.findMany({
    where: { projectId, userId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT
  });
}

export async function clearHistory(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);
  await getPrisma().apiHistoryEntry.deleteMany({ where: { projectId, userId } });
}

// Docs -----------------------------------------------------------------------

export async function listDocs(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().docPage.findMany({
    where: { projectId },
    select: { id: true, slug: true, title: true, folder: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' }
  });
}

/** Every docs folder, including empty ones. */
export async function listDocFolders(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);
  return listFolderPaths(projectId, 'DOC');
}

export async function createDocFolder(userId: string, projectId: string, path: string) {
  await requireProjectMembership(userId, projectId);
  const folder = await ensureFolder(projectId, 'DOC', path);
  if (!folder) throw new PlatformAccessError('Name the folder');
  return folder;
}

/** Deletes a folder, its subfolders and every page in them; returns the deleted ids. */
export async function deleteDocFolder(userId: string, projectId: string, path: string) {
  await requireProjectMembership(userId, projectId);
  const folder = normalizeFolder(path);
  if (!folder) throw new PlatformAccessError('Folder not found');
  const docs = await getPrisma().docPage.findMany({
    where: { projectId, OR: [{ folder }, { folder: { startsWith: `${folder}/` } }] },
    select: { id: true }
  });
  const ids = docs.map((doc) => doc.id);
  await getPrisma().$transaction(async (tx) => {
    await tx.docPage.deleteMany({ where: { projectId, id: { in: ids } } });
    await deleteFolderRows(tx, projectId, 'DOC', folder);
  });
  return ids;
}

export async function getDoc(userId: string, projectId: string, slug: string) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().docPage.findUnique({
    where: { projectId_slug: { projectId, slug } }
  });
}

export async function saveDoc(
  userId: string,
  projectId: string,
  slug: string,
  title: string,
  body: string,
  docId?: string,
  /** Only used when creating; moving goes through moveDoc. */
  folder?: string | null
) {
  await requireProjectMembership(userId, projectId);
  if (docId) {
    return getPrisma().docPage.update({
      where: { id: docId, projectId },
      data: { title, body }
    });
  }
  return getPrisma().docPage.create({
    data: {
      projectId,
      slug: `${slug}-${randomUUID()}`,
      title,
      body,
      folder: await ensureFolder(projectId, 'DOC', folder),
      createdById: userId
    }
  });
}

export async function moveDoc(
  userId: string,
  projectId: string,
  docId: string,
  folder: string | null
) {
  await requireProjectMembership(userId, projectId);
  await getPrisma().docPage.update({
    where: { id: docId, projectId },
    data: { folder: await ensureFolder(projectId, 'DOC', folder) }
  });
}

/** Renames a folder and everything nested in it. */
export async function renameDocFolder(userId: string, projectId: string, from: string, to: string) {
  await requireProjectMembership(userId, projectId);
  const source = normalizeFolder(from);
  const target = normalizeFolder(to);
  if (!source || !target || source === target) return;
  const docs = await getPrisma().docPage.findMany({
    where: { projectId, OR: [{ folder: source }, { folder: { startsWith: `${source}/` } }] },
    select: { id: true, folder: true }
  });
  await getPrisma().$transaction(async (tx) => {
    for (const doc of docs) {
      await tx.docPage.update({
        where: { id: doc.id },
        data: { folder: renamedFolder(doc.folder, source, target) }
      });
    }
    await renameFolderRows(tx, projectId, 'DOC', source, target);
  });
}

export async function deleteDoc(userId: string, projectId: string, docId: string) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().docPage.delete({ where: { id: docId, projectId } });
}

// Doc <-> Issue links ---------------------------------------------------------

export async function listLinkedIssues(userId: string, projectId: string, docId: string) {
  await requireProjectMembership(userId, projectId);
  const links = await getPrisma().docIssueLink.findMany({
    where: { docId, doc: { projectId }, issue: { archivedAt: null } },
    include: { issue: { select: { id: true, issueKey: true, title: true } } },
    orderBy: { createdAt: 'desc' }
  });
  return links.map((link) => link.issue);
}

/** Lightweight issue list for the "link a task" picker. */
export async function listIssuesForLinking(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().issue.findMany({
    where: { projectId, archivedAt: null },
    select: { id: true, issueKey: true, title: true },
    orderBy: { number: 'desc' },
    take: 200
  });
}

export async function linkDocToIssue(
  userId: string,
  projectId: string,
  docId: string,
  issueId: string
) {
  await requireProjectMembership(userId, projectId);
  const [doc, issue] = await Promise.all([
    getPrisma().docPage.findFirst({
      where: { id: docId, projectId },
      select: { id: true }
    }),
    getPrisma().issue.findFirst({
      where: { id: issueId, projectId, archivedAt: null },
      select: { id: true }
    })
  ]);
  if (!doc || !issue) throw new PlatformAccessError();

  return getPrisma().docIssueLink.upsert({
    where: { docId_issueId: { docId, issueId } },
    create: { docId, issueId },
    update: {}
  });
}

export async function unlinkDocFromIssue(
  userId: string,
  projectId: string,
  docId: string,
  issueId: string
) {
  await requireProjectMembership(userId, projectId);
  await getPrisma().docIssueLink.deleteMany({
    where: { docId, issueId, doc: { projectId } }
  });
}
