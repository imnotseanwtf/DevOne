import type { SendRequestResult } from '@/features/platform/actions';
import type { OperationDocs } from '@/lib/api-client/openapi';
import {
  joinQuery,
  NO_AUTH,
  pathParamNames,
  splitQuery,
  type ApiAuth,
  type ApiBodyType,
  type ApiMethod,
  type ApiRequestDraft
} from '@/lib/api-client/types';
import type { EditorRow } from './api-key-value-editor';

export interface SavedApiRequest {
  id: string;
  collectionId: string;
  folder: string | null;
  name: string;
  draft: ApiRequestDraft;
}

export interface ApiCollectionView {
  id: string;
  name: string;
  requests: SavedApiRequest[];
}

export interface ApiHistoryView {
  id: string;
  status: number | null;
  durationMs: number | null;
  createdAt: string;
  draft: ApiRequestDraft;
}

/** A project resource, used as an environment: `url` fills `{{baseUrl}}`. */
export interface ApiEnvironmentView {
  id: string;
  name: string;
  /** Only its creator sees a personal environment. */
  personal: boolean;
  environment: 'LOCAL' | 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';
  /** The environment's auth; secret parts only say whether they're set. */
  auth: {
    type: 'none' | 'bearer' | 'basic' | 'apiKey';
    secretSet: boolean;
    username?: string;
    name?: string;
    in?: 'header' | 'query';
  };
  url: string | null;
  variables: { id: string; key: string; isSecret: boolean; value: string | null }[];
  /** Sent with every request in this environment unless the request sets its own. */
  headers: { id: string; name: string; isSecret: boolean; value: string | null }[];
}

/** One open editor tab; rows are kept separately so half-typed entries survive. */
export interface RequestTab {
  key: string;
  requestId: string | null;
  collectionId: string | null;
  name: string;
  method: ApiMethod;
  url: string;
  /** Query rows; unchecked ones (e.g. optional params from the docs) aren't in the URL. */
  params: EditorRow[];
  /** Values for the URL's `{{name}}` path placeholders. */
  pathParams: Record<string, string>;
  headers: EditorRow[];
  body: string;
  bodyType: ApiBodyType;
  formRows: EditorRow[];
  auth: ApiAuth;
  /** From the OpenAPI import; loaded after the tab opens, so briefly null. */
  docs: OperationDocs | null;
  /** What was last saved, to flag unsaved changes; null for a scratch request. */
  savedFingerprint: string | null;
  result?: SendRequestResult;
  sending: boolean;
}

export const EMPTY_DRAFT: ApiRequestDraft = {
  method: 'GET',
  url: '',
  headers: {},
  body: '',
  bodyType: 'JSON',
  auth: NO_AUTH,
  pathParams: {}
};

let tabCounter = 0;

export function parseForm(body: string): EditorRow[] {
  return splitQuery(`?${body}`).params;
}

export function serializeForm(rows: EditorRow[]): string {
  return joinQuery('', rows).slice(1);
}

export function toDraft(tab: RequestTab): ApiRequestDraft {
  return {
    method: tab.method,
    url: tab.url.trim(),
    headers: Object.fromEntries(
      tab.headers.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value])
    ),
    body: tab.bodyType === 'FORM' ? serializeForm(tab.formRows) : tab.body,
    bodyType: tab.bodyType,
    auth: tab.auth,
    // Only placeholders still in the URL, so a stale value can't mark the tab dirty.
    pathParams: Object.fromEntries(
      pathParamNames(tab.url)
        .filter((name) => tab.pathParams[name]?.trim())
        .map((name) => [name, tab.pathParams[name]])
    )
  };
}

export function fingerprint(tab: RequestTab): string {
  return JSON.stringify([tab.name.trim(), tab.collectionId, toDraft(tab)]);
}

export function isDirty(tab: RequestTab): boolean {
  return tab.savedFingerprint !== null && fingerprint(tab) !== tab.savedFingerprint;
}

export function createTab(options: {
  draft?: ApiRequestDraft;
  name?: string;
  requestId?: string | null;
  collectionId?: string | null;
  docs?: OperationDocs | null;
}): RequestTab {
  const draft = options.draft ?? EMPTY_DRAFT;
  const tab: RequestTab = {
    key: `tab-${++tabCounter}`,
    requestId: options.requestId ?? null,
    collectionId: options.collectionId ?? null,
    name: options.name ?? 'Untitled request',
    method: draft.method,
    url: draft.url,
    params: splitQuery(draft.url).params,
    pathParams: draft.pathParams,
    headers: Object.entries(draft.headers).map(([key, value]) => ({ key, value })),
    body: draft.bodyType === 'FORM' ? '' : draft.body,
    bodyType: draft.bodyType,
    formRows: draft.bodyType === 'FORM' ? parseForm(draft.body) : [],
    auth: draft.auth,
    docs: options.docs ?? null,
    savedFingerprint: null,
    sending: false
  };
  if (tab.requestId) tab.savedFingerprint = fingerprint(tab);
  return tab;
}

export function tabFromSaved(request: SavedApiRequest): RequestTab {
  return createTab({
    draft: request.draft,
    name: request.name,
    requestId: request.id,
    collectionId: request.collectionId
  });
}

/** Replaces a tab's request content (e.g. from a pasted curl) but keeps its identity. */
export function withDraft(draft: ApiRequestDraft): Partial<RequestTab> {
  const {
    key: _key,
    requestId: _requestId,
    collectionId: _collectionId,
    name: _name,
    docs: _docs,
    savedFingerprint: _saved,
    ...content
  } = createTab({ draft });
  return content;
}

/** Keeps the URL and the Params rows in step, whichever one was edited. */
export function withUrl(tab: RequestTab, url: string): Partial<RequestTab> {
  const params = splitQuery(url).params;
  const present = new Set(params.map((row) => row.key));
  // Unchecked rows live only in the tab, so typing in the URL must not drop them.
  const unchecked = tab.params.filter((row) => row.enabled === false && !present.has(row.key));
  return { url, params: [...params, ...unchecked] };
}

/**
 * Merges an imported operation's documented parameters into the tab: missing
 * query parameters are listed unchecked with their example, and empty path
 * values take the spec's example. Nothing the user already set is replaced.
 */
export function withDocs(tab: RequestTab, docs: OperationDocs): Partial<RequestTab> {
  const present = new Set(tab.params.map((row) => row.key));
  const suggested = docs.parameters
    .filter((parameter) => parameter.in === 'query' && !present.has(parameter.name))
    .map((parameter) => ({ key: parameter.name, value: parameter.example ?? '', enabled: false }));

  const pathParams = { ...tab.pathParams };
  for (const parameter of docs.parameters) {
    if (parameter.in === 'path' && parameter.example && !pathParams[parameter.name]?.trim()) {
      pathParams[parameter.name] = parameter.example;
    }
  }

  return { docs, params: [...tab.params, ...suggested], pathParams };
}

export function withParams(tab: RequestTab, params: EditorRow[]): Partial<RequestTab> {
  const { base } = splitQuery(tab.url);
  return { params, url: joinQuery(base, params) };
}

/**
 * The text body and the form rows are kept side by side, so switching body
 * types back and forth loses nothing; form rows start from the text body when
 * it already looks like `a=1&b=2`.
 */
export function withBodyType(tab: RequestTab, bodyType: ApiBodyType): Partial<RequestTab> {
  if (bodyType === 'FORM' && tab.formRows.length === 0 && /^[^{[<\s][^=\s]*=/.test(tab.body)) {
    return { bodyType, formRows: parseForm(tab.body) };
  }
  return { bodyType };
}

export interface FolderNode {
  name: string;
  /** Full `/`-separated path; '' for the collection's root. */
  path: string;
  folders: FolderNode[];
  requests: SavedApiRequest[];
  /** Requests in this folder and everything beneath it. */
  count: number;
}

/** Builds the folder tree from request paths, keeping first-seen order (the spec's order). */
export function buildFolderTree(requests: SavedApiRequest[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: [], requests: [], count: 0 };

  for (const request of requests) {
    let node = root;
    node.count++;
    for (const segment of request.folder?.split('/') ?? []) {
      const path = node.path ? `${node.path}/${segment}` : segment;
      let child = node.folders.find((folder) => folder.name === segment);
      if (!child) {
        child = { name: segment, path, folders: [], requests: [], count: 0 };
        node.folders.push(child);
      }
      child.count++;
      node = child;
    }
    node.requests.push(request);
  }
  return root;
}

/** Every folder path in a collection, for the "move to folder" suggestions. */
export function folderPaths(requests: SavedApiRequest[]): string[] {
  const paths = new Set<string>();
  for (const request of requests) {
    const segments = request.folder?.split('/') ?? [];
    segments.forEach((_, index) => paths.add(segments.slice(0, index + 1).join('/')));
  }
  return [...paths].toSorted();
}
