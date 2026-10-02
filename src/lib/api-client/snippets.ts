import { appendQuery, DEFAULT_CONTENT_TYPE, methodHasBody, type ApiRequestDraft } from './types';

export type SnippetLanguage = 'curl' | 'fetch';

interface SnippetParts {
  url: string;
  headers: [string, string][];
  basic?: { username: string; password: string };
  body?: string;
}

/**
 * The request as the snippet shows it: `{{VARIABLES}}` are left unresolved so
 * a copied snippet never leaks an environment's secrets.
 */
function toParts(draft: ApiRequestDraft): SnippetParts {
  let url = draft.url;
  const headers = Object.entries(draft.headers).filter(([name]) => name.trim());
  const has = (name: string) => headers.some(([key]) => key.toLowerCase() === name.toLowerCase());
  let basic: SnippetParts['basic'];

  const { auth } = draft;
  if (auth.type === 'bearer' && auth.token && !has('authorization')) {
    headers.push(['Authorization', `Bearer ${auth.token}`]);
  } else if (auth.type === 'basic' && !has('authorization')) {
    basic = { username: auth.username, password: auth.password };
  } else if (auth.type === 'apiKey' && auth.name.trim()) {
    if (auth.in === 'header') {
      if (!has(auth.name)) headers.push([auth.name.trim(), auth.value]);
    } else {
      url = appendQuery(url, auth.name.trim(), auth.value);
    }
  }

  const sendsBody = methodHasBody(draft.method) && draft.bodyType !== 'NONE';
  const contentType = DEFAULT_CONTENT_TYPE[draft.bodyType];
  if (sendsBody && contentType && !has('content-type')) {
    headers.push(['Content-Type', contentType]);
  }

  return { url, headers, basic, body: sendsBody ? draft.body : undefined };
}

function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

export function toCurl(draft: ApiRequestDraft): string {
  const parts = toParts(draft);
  const lines = [
    draft.method === 'GET'
      ? `curl ${shellQuote(parts.url)}`
      : draft.method === 'HEAD'
        ? `curl --head ${shellQuote(parts.url)}`
        : `curl --request ${draft.method} ${shellQuote(parts.url)}`
  ];
  for (const [name, value] of parts.headers) {
    lines.push(`--header ${shellQuote(`${name}: ${value}`)}`);
  }
  if (parts.basic) {
    lines.push(`--user ${shellQuote(`${parts.basic.username}:${parts.basic.password}`)}`);
  }
  if (parts.body) lines.push(`--data-raw ${shellQuote(parts.body)}`);
  return lines.join(' \\\n  ');
}

export function toFetch(draft: ApiRequestDraft): string {
  const parts = toParts(draft);
  const options: string[] = [];

  if (draft.method !== 'GET') options.push(`  method: ${JSON.stringify(draft.method)}`);

  const headerLines = parts.headers.map(
    ([name, value]) => `    ${JSON.stringify(name)}: ${JSON.stringify(value)}`
  );
  if (parts.basic) {
    const credentials = `${parts.basic.username}:${parts.basic.password}`;
    headerLines.push(`    Authorization: \`Basic \${btoa(${JSON.stringify(credentials)})}\``);
  }
  if (headerLines.length > 0) options.push(`  headers: {\n${headerLines.join(',\n')}\n  }`);

  if (parts.body) options.push(`  body: ${bodyExpression(draft.bodyType, parts.body)}`);

  const call =
    options.length > 0
      ? `fetch(${JSON.stringify(parts.url)}, {\n${options.join(',\n')}\n})`
      : `fetch(${JSON.stringify(parts.url)})`;

  return `const response = await ${call};\n\nconst data = await response.${
    acceptsJson(parts.headers) ? 'json' : 'text'
  }();`;
}

function bodyExpression(bodyType: ApiRequestDraft['bodyType'], body: string): string {
  if (bodyType === 'JSON') {
    try {
      const pretty = JSON.stringify(JSON.parse(body), null, 2).replaceAll('\n', '\n  ');
      return `JSON.stringify(${pretty})`;
    } catch {
      // Not valid JSON yet (or holds a bare {{VAR}}); send the text as written.
    }
  }
  return JSON.stringify(body);
}

function acceptsJson(headers: [string, string][]): boolean {
  return headers.some(
    ([name, value]) =>
      ['accept', 'content-type'].includes(name.toLowerCase()) && value.includes('json')
  );
}

export function toSnippet(language: SnippetLanguage, draft: ApiRequestDraft): string {
  return language === 'curl' ? toCurl(draft) : toFetch(draft);
}
