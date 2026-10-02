import { z } from 'zod';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type ApiMethod = (typeof HTTP_METHODS)[number];

export const BODY_TYPES = ['NONE', 'JSON', 'TEXT', 'FORM'] as const;
export type ApiBodyType = (typeof BODY_TYPES)[number];

export const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearer'), token: z.string().max(10_000) }),
  z.object({
    type: z.literal('basic'),
    username: z.string().max(1_000),
    password: z.string().max(1_000)
  }),
  z.object({
    type: z.literal('apiKey'),
    name: z.string().max(200),
    value: z.string().max(10_000),
    in: z.enum(['header', 'query'])
  })
]);

export type ApiAuth = z.infer<typeof authSchema>;

export const NO_AUTH: ApiAuth = { type: 'none' };

/**
 * The placeholders an environment's auth fills, matching what imported
 * requests use: `{{TOKEN}}`, `{{USERNAME}}`/`{{PASSWORD}}` and `{{API_KEY}}`.
 */
export function authVariables(auth: ApiAuth): Record<string, string> {
  switch (auth.type) {
    case 'bearer':
      return auth.token ? { TOKEN: auth.token } : {};
    case 'basic':
      return { USERNAME: auth.username, PASSWORD: auth.password };
    case 'apiKey':
      return auth.value ? { API_KEY: auth.value } : {};
    default:
      return {};
  }
}

/** A request with no auth of its own uses the environment's; one with its own keeps it. */
export function withEnvironmentAuth(draft: ApiRequestDraft, auth: ApiAuth): ApiRequestDraft {
  return draft.auth.type === 'none' && auth.type !== 'none' ? { ...draft, auth } : draft;
}

/** Reads a stored `authJson` column, falling back to no auth for anything malformed. */
export function parseStoredAuth(value: unknown): ApiAuth {
  const parsed = authSchema.safeParse(value);
  return parsed.success ? parsed.data : NO_AUTH;
}

/** Everything needed to send (or describe) one request, before variable substitution. */
export interface ApiRequestDraft {
  method: ApiMethod;
  url: string;
  headers: Record<string, string>;
  body: string;
  bodyType: ApiBodyType;
  auth: ApiAuth;
  /** Values for `{{name}}` placeholders in the URL path; blank ones fall back to the environment. */
  pathParams: Record<string, string>;
}

export const DEFAULT_CONTENT_TYPE: Record<ApiBodyType, string | null> = {
  NONE: null,
  JSON: 'application/json',
  TEXT: 'text/plain',
  FORM: 'application/x-www-form-urlencoded'
};

export function methodHasBody(method: ApiMethod): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

/** A header name as HTTP allows it (RFC 9110 token characters). */
export const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Set by the HTTP client itself; an environment can't override them. */
export const RESERVED_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding'
]);

/**
 * Adds an environment's headers to a request. A header the request already
 * sets (in any letter case) keeps the request's value, and empty values are
 * skipped.
 */
export function withEnvironmentHeaders(
  headers: Record<string, string>,
  defaults: { name: string; value: string }[]
): Record<string, string> {
  const merged = { ...headers };
  for (const { name, value } of defaults) {
    if (!value.trim() || hasHeader(merged, name)) continue;
    merged[name] = value.trim();
  }
  return merged;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

/**
 * The headers, URL and body that actually go on the wire: auth is folded in
 * and a Content-Type is added for the body type unless one was set by hand.
 * `resolve` substitutes variables, so auth fields can hold `{{TOKEN}}` too.
 */
export function buildOutgoingRequest(
  draft: ApiRequestDraft,
  resolve: (text: string) => string = (text) => text
): { url: string; headers: Record<string, string>; body: string | undefined } {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(draft.headers)) {
    if (name.trim()) headers[name.trim()] = resolve(value);
  }

  let url = resolve(applyPathParams(draft.url, draft.pathParams));
  const { auth } = draft;

  if (auth.type === 'bearer' && auth.token && !hasHeader(headers, 'authorization')) {
    headers.Authorization = `Bearer ${resolve(auth.token)}`;
  } else if (auth.type === 'basic' && !hasHeader(headers, 'authorization')) {
    const credentials = `${resolve(auth.username)}:${resolve(auth.password)}`;
    headers.Authorization = `Basic ${toBase64(credentials)}`;
  } else if (auth.type === 'apiKey' && auth.name.trim()) {
    const name = auth.name.trim();
    const value = resolve(auth.value);
    if (auth.in === 'header') {
      if (!hasHeader(headers, name)) headers[name] = value;
    } else {
      url = appendQuery(url, name, value);
    }
  }

  const sendsBody = methodHasBody(draft.method) && draft.bodyType !== 'NONE';
  const contentType = DEFAULT_CONTENT_TYPE[draft.bodyType];
  if (sendsBody && contentType && !hasHeader(headers, 'content-type')) {
    headers['Content-Type'] = contentType;
  }

  return { url, headers, body: sendsBody ? resolve(draft.body) : undefined };
}

/** UTF-8 safe base64 that works on both the server and in the browser. */
function toBase64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Appends one query parameter without disturbing the rest of the URL (or `{{VARS}}` in it). */
export function appendQuery(url: string, name: string, value: string): string {
  const hashIndex = url.indexOf('#');
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  const separator = base.includes('?')
    ? base.endsWith('?') || base.endsWith('&')
      ? ''
      : '&'
    : '?';
  return `${base}${separator}${encodeURIComponent(name)}=${encodeURIComponent(value)}${hash}`;
}

export interface KeyValueRow {
  key: string;
  value: string;
  /** Unchecked rows stay listed but are left out of the URL; missing means enabled. */
  enabled?: boolean;
}

/**
 * Splits a URL into its origin (`https://{{host}}`, or a leading `{{baseUrl}}`),
 * its path, and the query/fragment. Placeholders in the origin come from the
 * environment, never from path params.
 */
function splitUrl(url: string): { origin: string; path: string; rest: string } {
  const queryStart = url.search(/[?#]/);
  const beforeQuery = queryStart === -1 ? url : url.slice(0, queryStart);
  const rest = queryStart === -1 ? '' : url.slice(queryStart);
  const scheme = beforeQuery.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//)?.[0] ?? '';
  const slash = beforeQuery.indexOf('/', scheme.length);
  const originEnd = slash === -1 ? beforeQuery.length : slash;
  return {
    origin: beforeQuery.slice(0, originEnd),
    path: beforeQuery.slice(originEnd),
    rest
  };
}

/** The unique `{{name}}` placeholders in a URL's path (not its origin or query), in order. */
export function pathParamNames(url: string): string[] {
  const { path } = splitUrl(url);
  return [
    ...new Set([...path.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)].map((match) => match[1]))
  ];
}

/**
 * Fills `{{name}}` path placeholders from the request's own values. Blank
 * values keep the placeholder, so the environment can still supply it.
 */
export function applyPathParams(url: string, values: Record<string, string>): string {
  const { origin, path, rest } = splitUrl(url);
  const filled = path.replaceAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name].trim() : '';
    return value ? encodePathPart(value) : match;
  });
  return origin + filled + rest;
}

/** Encodes one path segment but leaves `{{VAR}}` readable for the environment. */
function encodePathPart(text: string): string {
  return encodeURIComponent(text).replaceAll('%7B', '{').replaceAll('%7D', '}');
}

/**
 * Splits a URL into its base and query rows, the way Scalar's Params tab keeps
 * the two in sync. Decoding is lenient so `{{VAR}}` placeholders survive.
 */
export function splitQuery(url: string): { base: string; params: KeyValueRow[] } {
  const hashIndex = url.indexOf('#');
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex === -1) return { base: withoutHash, params: [] };

  const params = withoutHash
    .slice(queryIndex + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const equals = pair.indexOf('=');
      const key = equals === -1 ? pair : pair.slice(0, equals);
      const value = equals === -1 ? '' : pair.slice(equals + 1);
      return { key: safeDecode(key), value: safeDecode(value) };
    });
  return { base: withoutHash.slice(0, queryIndex), params };
}

/** Rebuilds a URL from its base and query rows; `{{` `}}` stay readable. */
export function joinQuery(base: string, params: KeyValueRow[]): string {
  const query = params
    .filter((row) => row.enabled !== false && row.key.trim())
    .map((row) => `${encodeQueryPart(row.key)}=${encodeQueryPart(row.value)}`)
    .join('&');
  return query ? `${base}?${query}` : base;
}

function encodeQueryPart(text: string): string {
  return encodeURIComponent(text).replaceAll('%7B', '{').replaceAll('%7D', '}');
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text.replaceAll('+', ' '));
  } catch {
    return text;
  }
}

/** Tidies a `/`-separated folder path: `' A / /B/ '` becomes `'A/B'`, blank becomes null. */
export function normalizeFolder(path: string | null | undefined): string | null {
  const segments = (path ?? '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.length ? segments.join('/').slice(0, 200) : null;
}

/** True when `folder` is `path` itself or anywhere beneath it. */
export function isInFolder(folder: string | null, path: string): boolean {
  return folder === path || Boolean(folder?.startsWith(`${path}/`));
}
