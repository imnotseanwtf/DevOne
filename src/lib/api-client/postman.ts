import {
  MAX_IMPORTED_REQUESTS,
  OpenApiImportError,
  type ImportedCollection,
  type ImportedRequest
} from './openapi';
import { HTTP_METHODS, NO_AUTH, normalizeFolder, type ApiAuth, type ApiMethod } from './types';

/**
 * Postman collections (v2.0 and v2.1 exports) as DevOne collections. Folders keep
 * their nesting, `{{variables}}` already use DevOne's syntax, and `:param` path
 * segments become `{{param}}` path params. The collection's variables come back
 * separately so they can seed an environment.
 */

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** True for a Postman collection export (as opposed to OpenAPI or anything else). */
export function isPostmanCollection(doc: unknown): doc is Json {
  if (!isObject(doc) || !isObject(doc.info) || !Array.isArray(doc.item)) return false;
  const schema = text(doc.info.schema);
  return schema.includes('schema.getpostman.com') || typeof doc.info._postman_id === 'string';
}

export interface PostmanImport extends ImportedCollection {
  /** Collection variables, for an environment. */
  variables: { key: string; value: string }[];
}

/** Postman auth params are `[{ key, value }]` in v2.1 and a plain object in v2.0. */
function authParams(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value.filter(isObject).map((entry) => [text(entry.key), text(entry.value)])
    );
  }
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, text(entry)]));
  }
  return {};
}

/** `undefined` means "inherit from the parent". */
function toAuth(auth: unknown): ApiAuth | undefined {
  if (!isObject(auth)) return undefined;
  const type = text(auth.type);
  if (type === 'inherit') return undefined;
  if (type === 'noauth') return NO_AUTH;
  const params = authParams(auth[type]);
  if (type === 'bearer') return { type: 'bearer', token: params.token ?? '' };
  if (type === 'basic') {
    return { type: 'basic', username: params.username ?? '', password: params.password ?? '' };
  }
  if (type === 'apikey') {
    return {
      type: 'apiKey',
      name: params.key ?? '',
      value: params.value ?? '',
      in: params.in === 'query' ? 'query' : 'header'
    };
  }
  // OAuth, AWS signatures and the like have no DevOne equivalent; the request imports
  // without auth rather than failing.
  return NO_AUTH;
}

const enabled = (entry: unknown): entry is Json => isObject(entry) && entry.disabled !== true;

function toUrl(url: unknown): { url: string; pathParams: Record<string, string> } {
  if (typeof url === 'string')
    return { url: url.replace(/(^|\/):(\w+)/g, '$1{{$2}}'), pathParams: {} };
  if (!isObject(url)) return { url: '', pathParams: {} };

  const pathParams: Record<string, string> = {};
  for (const variable of Array.isArray(url.variable) ? url.variable : []) {
    if (isObject(variable) && text(variable.key))
      pathParams[text(variable.key)] = text(variable.value);
  }

  let base = text(url.raw).split('?')[0];
  if (!base) {
    const protocol = text(url.protocol);
    const host = Array.isArray(url.host) ? url.host.map(text).join('.') : text(url.host);
    const path = Array.isArray(url.path) ? url.path.map(text).join('/') : text(url.path);
    base = `${protocol ? `${protocol}://` : ''}${host}${path ? `/${path}` : ''}`;
  }
  // Postman's `:id` path params are DevOne's `{{id}}`.
  base = base.replace(/(^|\/):(\w+)/g, '$1{{$2}}');

  const query = (Array.isArray(url.query) ? url.query : [])
    .filter(enabled)
    .map((entry) => `${text(entry.key)}=${text(entry.value)}`);
  return { url: query.length ? `${base}?${query.join('&')}` : base, pathParams };
}

function toBody(body: unknown, headers: Record<string, string>) {
  if (!isObject(body)) return { body: '', bodyType: 'NONE' as const };
  const mode = text(body.mode);
  if (mode === 'raw') {
    const raw = text(body.raw);
    const language =
      isObject(body.options) && isObject(body.options.raw) ? text(body.options.raw.language) : '';
    const contentType =
      Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
    const json = language === 'json' || contentType.includes('json');
    return {
      body: raw,
      bodyType: json ? ('JSON' as const) : raw ? ('TEXT' as const) : ('NONE' as const)
    };
  }
  if (mode === 'urlencoded' || mode === 'formdata') {
    // File fields in form-data have nothing to send from the browser; text fields do.
    const fields = (Array.isArray(body[mode]) ? (body[mode] as unknown[]) : [])
      .filter(enabled)
      .filter((entry) => text(entry.type) !== 'file')
      .map((entry) => `${text(entry.key)}=${text(entry.value)}`);
    return {
      body: fields.join('&'),
      bodyType: fields.length ? ('FORM' as const) : ('NONE' as const)
    };
  }
  if (mode === 'graphql' && isObject(body.graphql)) {
    let variables: unknown = {};
    try {
      variables = JSON.parse(text(body.graphql.variables) || '{}');
    } catch {
      variables = {};
    }
    return {
      body: JSON.stringify({ query: text(body.graphql.query), variables }, null, 2),
      bodyType: 'JSON' as const
    };
  }
  return { body: '', bodyType: 'NONE' as const };
}

function description(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (isObject(value)) return text(value.content) || undefined;
  return undefined;
}

export function postmanToCollection(doc: Json): PostmanImport {
  const info = isObject(doc.info) ? doc.info : {};
  const requests: ImportedRequest[] = [];

  const walk = (items: unknown[], folder: string[], inheritedAuth: ApiAuth) => {
    for (const item of items) {
      if (!isObject(item) || requests.length >= MAX_IMPORTED_REQUESTS) continue;
      const name = text(item.name) || 'Untitled';
      if (Array.isArray(item.item)) {
        walk(item.item, [...folder, name.replaceAll('/', '-')], toAuth(item.auth) ?? inheritedAuth);
        continue;
      }
      const request = typeof item.request === 'string' ? { url: item.request } : item.request;
      if (!isObject(request)) continue;

      const method = text(request.method).toUpperCase();
      const headers = Object.fromEntries(
        (Array.isArray(request.header) ? request.header : [])
          .filter(enabled)
          .map((header) => [text(header.key), text(header.value)])
          .filter(([key]) => key)
      );
      const { url, pathParams } = toUrl(request.url);
      const { body, bodyType } = toBody(request.body, headers);
      requests.push({
        name,
        folder: normalizeFolder(folder.join('/')),
        method: (HTTP_METHODS as readonly string[]).includes(method)
          ? (method as ApiMethod)
          : 'GET',
        url,
        headers,
        body,
        bodyType,
        auth: toAuth(request.auth) ?? inheritedAuth,
        pathParams,
        docs: {
          method: (HTTP_METHODS as readonly string[]).includes(method) ? method : 'GET',
          path: url,
          summary: name,
          description: description(request.description),
          parameters: [],
          responses: []
        }
      });
    }
  };

  walk(doc.item as unknown[], [], toAuth(doc.auth) ?? NO_AUTH);
  if (requests.length === 0)
    throw new OpenApiImportError('The collection has no requests to import');

  const variables = (Array.isArray(doc.variable) ? doc.variable : [])
    .filter(enabled)
    .map((variable) => ({ key: text(variable.key), value: text(variable.value) }))
    .filter((variable) => /^[A-Za-z_][\w.-]*$/.test(variable.key));

  return { title: text(info.name) || 'Postman collection', requests, variables };
}
