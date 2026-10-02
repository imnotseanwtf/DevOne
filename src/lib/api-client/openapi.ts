import { parse as parseYaml } from 'yaml';
import {
  appendQuery,
  HTTP_METHODS,
  NO_AUTH,
  normalizeFolder,
  type ApiAuth,
  type ApiMethod,
  type ApiRequestDraft
} from './types';

export class OpenApiImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenApiImportError';
  }
}

export interface ImportedRequest extends ApiRequestDraft {
  name: string;
  /**
   * The operation's first tag, so the sidebar can group requests per feature.
   * Folders are `/`-separated paths, so a tag like `Store/Products` nests.
   */
  folder: string | null;
  docs: OperationDocs;
}

/** One property of a schema, flattened for display; `children` holds nested properties. */
export interface SchemaField {
  name: string;
  /** e.g. `string`, `integer (int32)`, `ProductDto`, `ProductDto[]`. */
  type: string;
  required?: boolean;
  nullable?: boolean;
  description?: string;
  enum?: string[];
  children?: SchemaField[];
}

export interface SchemaDocs {
  type: string;
  fields: SchemaField[];
  /** Pretty-printed example: the spec's own when it has one, otherwise generated. */
  example?: string;
}

export interface ParameterDocs {
  name: string;
  in: string;
  required: boolean;
  type: string;
  description?: string;
  /** The spec's example, default or first enum value, used to pre-fill the Params tab. */
  example?: string;
}

export interface ResponseDocs extends Partial<SchemaDocs> {
  status: string;
  description?: string;
  contentType?: string;
}

/**
 * What an operation needs to authenticate. `declared` comes from the spec's
 * security schemes; the others are inferred from its 401 response, since many
 * generated specs (Swashbuckle without `AddSecurityDefinition`) never declare any.
 */
export type AuthRequirement =
  | { status: 'declared'; schemes: AuthSchemeDocs[] }
  | { status: 'required' | 'possible'; suggestion: ApiAuth; reason: string }
  | { status: 'public'; reason: string };

export interface AuthSchemeDocs {
  name: string;
  /** e.g. `Bearer token (JWT)`, `API key in header X-Api-Key`, `OAuth 2`. */
  label: string;
  description?: string;
}

/** What the document says about one operation, stored alongside the imported request. */
export interface OperationDocs {
  method: string;
  path: string;
  auth?: AuthRequirement;
  summary?: string;
  description?: string;
  deprecated?: boolean;
  parameters: ParameterDocs[];
  requestBody?: SchemaDocs & { contentType: string; required: boolean; description?: string };
  responses: ResponseDocs[];
}

export interface ImportedCollection {
  title: string;
  requests: ImportedRequest[];
}

export const MAX_IMPORTED_REQUESTS = 500;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parses an imported document (JSON, or YAML for OpenAPI) without checking its kind. */
export function parseDocumentText(text: string): unknown {
  try {
    return parseYaml(text, { maxAliasCount: 100 });
  } catch {
    throw new OpenApiImportError('The document is not valid JSON or YAML');
  }
}

/** Checks that a parsed document is OpenAPI 3.x or Swagger 2.0. */
export function assertOpenApi(doc: unknown): Json {
  if (!isObject(doc) || (!('openapi' in doc) && !('swagger' in doc))) {
    throw new OpenApiImportError('That is not an OpenAPI, Swagger or Postman collection document');
  }
  if (!isObject(doc.paths)) throw new OpenApiImportError('The document has no paths');
  return doc;
}

/** Parses an OpenAPI 3.x or Swagger 2.0 document, given as JSON or YAML text. */
export function parseOpenApiText(text: string): Json {
  return assertOpenApi(parseDocumentText(text));
}

/**
 * One request per operation, grouped into folders by tag. Path parameters
 * become `{{name}}` so they can be filled from an environment. `sourceUrl`
 * resolves a relative server such as `/api/v1`, and stands in for a missing
 * one (Swashbuckle and most generators serve the document from the API host);
 * without either the base is `{{baseUrl}}`.
 */
export function openApiToCollection(doc: Json, sourceUrl?: string): ImportedCollection {
  const info = isObject(doc.info) ? doc.info : {};
  const title = (typeof info.title === 'string' && info.title.trim()) || 'Imported API';
  const baseUrl = resolveBaseUrl(doc, sourceUrl);
  const schemes = isObject(doc.components)
    ? (doc.components as Json).securitySchemes
    : doc.securityDefinitions;

  const requests: ImportedRequest[] = [];
  const prefix = commonPathPrefix(Object.keys(doc.paths as Json));
  // If any 401 in the document talks about bearer tokens, a bare "Unauthorized"
  // elsewhere most likely means the same scheme.
  const bearerHinted = JSON.stringify(doc.paths).toLowerCase().includes('bearer');

  for (const [path, pathItem] of Object.entries(doc.paths as Json)) {
    if (!isObject(pathItem)) continue;
    const sharedParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const [key, operation] of Object.entries(pathItem)) {
      const method = key.toUpperCase() as ApiMethod;
      if (!HTTP_METHODS.includes(method) || !isObject(operation)) continue;
      if (requests.length >= MAX_IMPORTED_REQUESTS) {
        return { title: title.slice(0, 80), requests };
      }

      const parameters = [
        ...sharedParameters,
        ...(Array.isArray(operation.parameters) ? operation.parameters : [])
      ]
        .map((parameter) => resolveRef(doc, parameter))
        .filter(isObject);

      let url = baseUrl + path.replaceAll(/\{([^}]+)\}/g, '{{$1}}');
      const headers: Record<string, string> = {};
      const pathParams: Record<string, string> = {};

      // Path values come pre-filled when the spec gives one. Query parameters go
      // in the URL when required or when there's a value to send; the rest show
      // up unchecked in the Params tab (from the docs), since an empty `?Page=`
      // fails validation on most typed backends.
      for (const parameter of parameters) {
        if (typeof parameter.name !== 'string') continue;
        const example = parameterExample(doc, parameter);
        if (parameter.in === 'path' && example) pathParams[parameter.name] = example;
        if (parameter.in === 'query' && (parameter.required === true || example)) {
          url = appendQuery(url, parameter.name, example);
        }
        if (parameter.in === 'header' && parameter.required === true) {
          headers[parameter.name] = example;
        }
      }

      const { body, bodyType } = requestBody(doc, operation, parameters);
      const security = Array.isArray(operation.security)
        ? operation.security
        : Array.isArray(doc.security)
          ? doc.security
          : [];

      // Without a summary the path is the clearest name; the method is already
      // shown next to it, and the prefix every path shares (`/api/v1`) is noise.
      const summary =
        (typeof operation.summary === 'string' && operation.summary.trim()) ||
        (typeof operation.operationId === 'string' && operation.operationId) ||
        path.slice(prefix.length) ||
        path;
      const [tag] = Array.isArray(operation.tags) ? operation.tags : [];

      const authRequirement = describeAuth(operation, security, schemes, bearerHinted);
      const docs = operationDocs(doc, method, path, operation, parameters);
      docs.auth = authRequirement;

      requests.push({
        name: summary.slice(0, 80),
        folder: typeof tag === 'string' ? normalizeFolder(tag) : null,
        method,
        url,
        headers,
        body,
        bodyType,
        auth:
          authRequirement.status === 'declared'
            ? authFromSecurity(security, schemes)
            : authRequirement.status === 'required'
              ? authRequirement.suggestion
              : NO_AUTH,
        pathParams,
        docs
      });
    }
  }

  return { title: title.slice(0, 80), requests };
}

function resolveBaseUrl(doc: Json, sourceUrl?: string): string {
  let base: string | undefined;

  if (Array.isArray(doc.servers) && isObject(doc.servers[0])) {
    const server = doc.servers[0];
    if (typeof server.url === 'string') {
      base = server.url;
      if (isObject(server.variables)) {
        for (const [name, variable] of Object.entries(server.variables)) {
          const fallback = isObject(variable) ? String(variable.default ?? '') : '';
          base = base.replaceAll(`{${name}}`, fallback);
        }
      }
    }
  } else if (typeof doc.host === 'string') {
    const scheme = Array.isArray(doc.schemes) && doc.schemes.includes('https') ? 'https' : 'http';
    base = `${scheme}://${doc.host}${typeof doc.basePath === 'string' ? doc.basePath : ''}`;
  }

  if (base && !/^https?:\/\//i.test(base)) {
    if (!sourceUrl) return `{{baseUrl}}${base === '/' ? '' : base}`;
    try {
      base = new URL(base, sourceUrl).toString();
    } catch {
      return '{{baseUrl}}';
    }
  }

  if (!base && sourceUrl) {
    try {
      base = new URL(sourceUrl).origin;
    } catch {
      // Fall through to the placeholder.
    }
  }

  return (base ?? '{{baseUrl}}').replace(/\/+$/, '');
}

/** The leading path segments every path shares, e.g. `/api/v1`; never a whole path. */
function commonPathPrefix(paths: string[]): string {
  if (paths.length < 2) return '';
  const split = paths.map((path) => path.split('/').filter(Boolean));
  const shared: string[] = [];
  for (let index = 0; ; index++) {
    const segment = split[0][index];
    if (
      segment === undefined ||
      segment.startsWith('{') ||
      split.some((parts) => parts[index] !== segment || parts.length <= index + 1)
    ) {
      break;
    }
    shared.push(segment);
  }
  return shared.length ? `/${shared.join('/')}` : '';
}

function resolveRef(doc: Json, value: unknown, depth = 0): unknown {
  if (!isObject(value) || typeof value.$ref !== 'string' || depth > 20) return value;
  if (!value.$ref.startsWith('#/')) return {};

  let target: unknown = doc;
  for (const segment of value.$ref.slice(2).split('/')) {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    target = isObject(target) ? target[key] : undefined;
  }
  return resolveRef(doc, target, depth + 1);
}

function parameterExample(doc: Json, parameter: Json): string {
  if (parameter.example !== undefined) return String(parameter.example);
  const schema = resolveRef(doc, parameter.schema ?? parameter);
  if (isObject(schema)) {
    if (schema.example !== undefined) return String(schema.example);
    if (schema.default !== undefined) return String(schema.default);
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return String(schema.enum[0]);
  }
  return '';
}

function requestBody(
  doc: Json,
  operation: Json,
  parameters: Json[]
): Pick<ApiRequestDraft, 'body' | 'bodyType'> {
  const content = isObject(operation.requestBody)
    ? (resolveRef(doc, operation.requestBody) as Json).content
    : undefined;

  if (isObject(content)) {
    const jsonType = Object.keys(content).find((type) => type.includes('json'));
    if (jsonType && isObject(content[jsonType])) {
      const media = content[jsonType] as Json;
      const example = mediaExample(doc, media);
      return { body: JSON.stringify(example ?? {}, null, 2), bodyType: 'JSON' };
    }

    const form = content['application/x-www-form-urlencoded'];
    if (isObject(form)) {
      const sample = sampleFromSchema(doc, form.schema);
      const fields = isObject(sample) ? Object.keys(sample) : [];
      return { body: fields.map((field) => `${field}=`).join('&'), bodyType: 'FORM' };
    }

    const [firstType] = Object.keys(content);
    if (firstType) return { body: '', bodyType: 'TEXT' };
  }

  // Swagger 2.0 puts the body in a `body` parameter instead.
  const bodyParameter = parameters.find((parameter) => parameter.in === 'body');
  if (bodyParameter) {
    const sample = sampleFromSchema(doc, bodyParameter.schema);
    return { body: JSON.stringify(sample ?? {}, null, 2), bodyType: 'JSON' };
  }

  return { body: '', bodyType: 'NONE' };
}

function mediaExample(doc: Json, media: Json): unknown {
  if (media.example !== undefined) return media.example;
  if (isObject(media.examples)) {
    const [first] = Object.values(media.examples);
    const resolved = resolveRef(doc, first);
    if (isObject(resolved) && resolved.value !== undefined) return resolved.value;
  }
  return sampleFromSchema(doc, media.schema);
}

/** A plausible example value for a JSON schema, following `$ref`s a few levels deep. */
export function sampleFromSchema(doc: Json, input: unknown, depth = 0): unknown {
  const schema = resolveRef(doc, input);
  if (!isObject(schema) || depth > 6) return undefined;

  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  if (Array.isArray(schema.allOf)) {
    return Object.assign(
      {},
      ...schema.allOf.map((part) => {
        const sample = sampleFromSchema(doc, part, depth + 1);
        return isObject(sample) ? sample : {};
      })
    );
  }
  const variants = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(variants) && variants.length > 0) {
    return sampleFromSchema(doc, variants[0], depth + 1);
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  if (type === 'object' || isObject(schema.properties)) {
    const result: Json = {};
    if (isObject(schema.properties)) {
      for (const [name, property] of Object.entries(schema.properties)) {
        const sample = sampleFromSchema(doc, property, depth + 1);
        if (sample !== undefined) result[name] = sample;
      }
    }
    return result;
  }

  if (type === 'array') {
    const item = sampleFromSchema(doc, schema.items, depth + 1);
    return item === undefined ? [] : [item];
  }

  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return true;
  if (type === 'string') {
    switch (schema.format) {
      case 'date-time':
        return '2026-01-01T00:00:00Z';
      case 'date':
        return '2026-01-01';
      case 'email':
        return 'user@example.com';
      case 'uuid':
        return '00000000-0000-0000-0000-000000000000';
      case 'uri':
      case 'url':
        return 'https://example.com';
      default:
        return 'string';
    }
  }
  return undefined;
}

/** Maps the first usable security requirement to auth fields with `{{VARIABLE}}` values. */
function authFromSecurity(security: unknown[], schemes: unknown): ApiAuth {
  if (!isObject(schemes)) return NO_AUTH;

  for (const requirement of security) {
    if (!isObject(requirement)) continue;
    for (const name of Object.keys(requirement)) {
      const scheme = schemes[name];
      if (!isObject(scheme)) continue;

      const type = String(scheme.type ?? '').toLowerCase();
      const httpScheme = String(scheme.scheme ?? '').toLowerCase();

      if (
        (type === 'http' && httpScheme === 'bearer') ||
        type === 'oauth2' ||
        type === 'openidconnect'
      ) {
        return { type: 'bearer', token: '{{TOKEN}}' };
      }
      if ((type === 'http' && httpScheme === 'basic') || type === 'basic') {
        return { type: 'basic', username: '{{USERNAME}}', password: '{{PASSWORD}}' };
      }
      if (type === 'apikey' && typeof scheme.name === 'string') {
        if (scheme.in === 'header' || scheme.in === 'query') {
          return { type: 'apiKey', name: scheme.name, value: '{{API_KEY}}', in: scheme.in };
        }
      }
    }
  }
  return NO_AUTH;
}

// Docs ---------------------------------------------------------------------------

const MAX_FIELDS = 300;
const MAX_EXAMPLE_CHARS = 20_000;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Prefers JSON over `text/plain` and friends, which .NET lists first. */
function pickMedia(content: unknown): [string, Json] | undefined {
  if (!isObject(content)) return undefined;
  const entries = Object.entries(content).filter((entry): entry is [string, Json] =>
    isObject(entry[1])
  );
  return (
    entries.find(([type]) => type === 'application/json') ??
    entries.find(([type]) => type.includes('json')) ??
    entries[0]
  );
}

function refName(value: unknown): string | undefined {
  if (!isObject(value) || typeof value.$ref !== 'string') return undefined;
  return value.$ref.split('/').pop();
}

function schemaType(doc: Json, input: unknown): string {
  const name = refName(input);
  if (name) return name;
  const schema = resolveRef(doc, input);
  if (!isObject(schema)) return 'any';

  const variants = schema.oneOf ?? schema.anyOf ?? schema.allOf;
  if (Array.isArray(variants) && variants.length > 0) {
    const names = variants.map((variant) => schemaType(doc, variant));
    return schema.allOf ? names.join(' & ') : names.join(' | ');
  }

  const type = Array.isArray(schema.type)
    ? schema.type.find((entry) => entry !== 'null')
    : schema.type;
  if (type === 'array') return `${schemaType(doc, schema.items)}[]`;
  if (typeof type !== 'string') return isObject(schema.properties) ? 'object' : 'any';
  return typeof schema.format === 'string' ? `${type} (${schema.format})` : type;
}

/**
 * The properties of a schema as a tree. `seen` holds the `$ref`s on the
 * current branch, so self-referencing schemas (a category with child
 * categories) stop instead of recursing forever.
 */
function schemaFields(
  doc: Json,
  input: unknown,
  budget: { left: number },
  seen: Set<string> = new Set(),
  depth = 0
): SchemaField[] {
  const name = refName(input);
  if ((name && seen.has(name)) || depth > 6 || budget.left <= 0) return [];
  const branch = name ? new Set([...seen, name]) : seen;

  let schema = resolveRef(doc, input);
  if (!isObject(schema)) return [];

  if (schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array'))) {
    return schemaFields(doc, schema.items, budget, branch, depth);
  }

  if (Array.isArray(schema.allOf)) {
    return schema.allOf.flatMap((part) => schemaFields(doc, part, budget, branch, depth));
  }
  const variants = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(variants) && variants.length > 0) {
    schema = resolveRef(doc, variants[0]);
    if (!isObject(schema)) return [];
  }

  if (!isObject(schema.properties)) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);

  const fields: SchemaField[] = [];
  for (const [property, value] of Object.entries(schema.properties)) {
    if (budget.left-- <= 0) break;
    const resolved = resolveRef(doc, value);
    const details = isObject(resolved) ? resolved : {};
    const children = schemaFields(doc, value, budget, branch, depth + 1);

    fields.push({
      name: property,
      type: schemaType(doc, value),
      ...(required.has(property) ? { required: true } : {}),
      ...(details.nullable === true ||
      (Array.isArray(details.type) && details.type.includes('null'))
        ? { nullable: true }
        : {}),
      ...(text(details.description) ? { description: text(details.description) } : {}),
      ...(Array.isArray(details.enum) ? { enum: details.enum.map(String) } : {}),
      ...(children.length > 0 ? { children } : {})
    });
  }
  return fields;
}

function schemaDocs(doc: Json, media: Json): SchemaDocs {
  const example = mediaExample(doc, media);
  const pretty = example === undefined ? undefined : JSON.stringify(example, null, 2);
  return {
    type: schemaType(doc, media.schema),
    fields: schemaFields(doc, media.schema, { left: MAX_FIELDS }),
    ...(pretty ? { example: pretty.slice(0, MAX_EXAMPLE_CHARS) } : {})
  };
}

function operationDocs(
  doc: Json,
  method: string,
  path: string,
  operation: Json,
  parameters: Json[]
): OperationDocs {
  const docs: OperationDocs = {
    method,
    path,
    parameters: parameters
      .filter((parameter) => typeof parameter.name === 'string' && parameter.in !== 'body')
      .map((parameter) => ({
        name: parameter.name as string,
        in: String(parameter.in ?? 'query'),
        required: parameter.required === true || parameter.in === 'path',
        type: schemaType(doc, parameter.schema ?? parameter),
        ...(text(parameter.description) ? { description: text(parameter.description) } : {}),
        ...(parameterExample(doc, parameter) ? { example: parameterExample(doc, parameter) } : {})
      })),
    responses: []
  };

  const summary = text(operation.summary);
  const description = text(operation.description);
  if (summary) docs.summary = summary;
  if (description) docs.description = description;
  if (operation.deprecated === true) docs.deprecated = true;

  const body = resolveRef(doc, operation.requestBody);
  const bodyMedia = isObject(body) ? pickMedia(body.content) : undefined;
  if (isObject(body) && bodyMedia) {
    docs.requestBody = {
      contentType: bodyMedia[0],
      required: body.required === true,
      ...(text(body.description) ? { description: text(body.description) } : {}),
      ...schemaDocs(doc, bodyMedia[1])
    };
  } else {
    // Swagger 2.0 carries the body as an `in: body` parameter.
    const bodyParameter = parameters.find((parameter) => parameter.in === 'body');
    if (bodyParameter) {
      docs.requestBody = {
        contentType: 'application/json',
        required: bodyParameter.required === true,
        ...schemaDocs(doc, { schema: bodyParameter.schema })
      };
    }
  }

  if (isObject(operation.responses)) {
    for (const [status, value] of Object.entries(operation.responses)) {
      const response = resolveRef(doc, value);
      if (!isObject(response)) continue;
      // OpenAPI 3 nests the schema under content; Swagger 2.0 puts it on the response.
      const media =
        pickMedia(response.content) ??
        (response.schema
          ? (['application/json', { schema: response.schema }] as [string, Json])
          : undefined);
      docs.responses.push({
        status,
        ...(text(response.description) ? { description: text(response.description) } : {}),
        ...(media ? { contentType: media[0], ...schemaDocs(doc, media[1]) } : {})
      });
    }
    docs.responses.sort((a, b) => a.status.localeCompare(b.status));
  }

  return docs;
}

// Auth ---------------------------------------------------------------------------

const TOKEN_HINT = /bearer|token|jwt|authenticat|sign(?:ed)? in|log(?:ged)? in/i;

function schemeLabel(scheme: Json): string {
  const type = String(scheme.type ?? '').toLowerCase();
  const httpScheme = String(scheme.scheme ?? '').toLowerCase();
  if (type === 'http' && httpScheme === 'bearer') {
    return typeof scheme.bearerFormat === 'string'
      ? `Bearer token (${scheme.bearerFormat})`
      : 'Bearer token';
  }
  if ((type === 'http' && httpScheme === 'basic') || type === 'basic') return 'Basic auth';
  if (type === 'apikey')
    return `API key in ${String(scheme.in ?? 'header')} ${String(scheme.name ?? '')}`.trim();
  if (type === 'oauth2') return 'OAuth 2 (send the access token as a Bearer token)';
  if (type === 'openidconnect')
    return 'OpenID Connect (send the ID/access token as a Bearer token)';
  return type || 'Unknown scheme';
}

function describeAuth(
  operation: Json,
  security: unknown[],
  schemes: unknown,
  bearerHinted: boolean
): AuthRequirement {
  // An explicit empty list on the operation means "no auth" even if the document has a default.
  if (Array.isArray(operation.security) && operation.security.length === 0) {
    return { status: 'public', reason: 'The spec marks this endpoint as public.' };
  }

  if (isObject(schemes) && security.length > 0) {
    const declared: AuthSchemeDocs[] = [];
    for (const requirement of security) {
      if (!isObject(requirement)) continue;
      for (const name of Object.keys(requirement)) {
        const scheme = schemes[name];
        if (!isObject(scheme) || declared.some((entry) => entry.name === name)) continue;
        declared.push({
          name,
          label: schemeLabel(scheme),
          ...(text(scheme.description) ? { description: text(scheme.description) } : {})
        });
      }
    }
    if (declared.length > 0) return { status: 'declared', schemes: declared };
  }

  const responses = isObject(operation.responses) ? operation.responses : {};
  const unauthorized = responses['401'] ?? responses['403'];
  if (!unauthorized) {
    return { status: 'public', reason: 'No 401 response is documented, so no auth looks needed.' };
  }

  const description = isObject(unauthorized) ? text(unauthorized.description) : undefined;
  const bearer: ApiAuth = { type: 'bearer', token: '{{TOKEN}}' };
  if (description && TOKEN_HINT.test(description)) {
    return { status: 'required', suggestion: bearer, reason: `401: ${description}` };
  }
  return {
    status: 'possible',
    suggestion: bearer,
    reason: bearerHinted
      ? `401: ${description ?? 'Unauthorized'}. Other endpoints in this API use a Bearer token; this one may need it too, or the 401 may just mean wrong credentials.`
      : `401: ${description ?? 'Unauthorized'}. The spec doesn't say which scheme.`
  };
}
