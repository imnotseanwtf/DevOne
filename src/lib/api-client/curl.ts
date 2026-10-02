import {
  appendQuery,
  HTTP_METHODS,
  NO_AUTH,
  type ApiBodyType,
  type ApiMethod,
  type ApiRequestDraft
} from './types';

export class CurlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CurlParseError';
  }
}

/**
 * Splits a shell command into words: single quotes, double quotes (with
 * backslash escapes), bash `$'…'` strings as DevTools' "Copy as cURL" emits,
 * and backslash-newline continuations.
 */
export function tokenizeShell(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let index = 0;

  const ansiEscapes: Record<string, string> = {
    n: '\n',
    t: '\t',
    r: '\r',
    '\\': '\\',
    "'": "'",
    '"': '"',
    '0': '\0'
  };

  while (index < command.length) {
    const char = command[index];

    if (char === '\\' && (command[index + 1] === '\n' || command[index + 1] === '\r')) {
      index += command[index + 1] === '\r' && command[index + 2] === '\n' ? 3 : 2;
      continue;
    }

    if (/\s/.test(char)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
      index++;
      continue;
    }

    inToken = true;

    if (char === '$' && command[index + 1] === "'") {
      index += 2;
      while (index < command.length && command[index] !== "'") {
        if (command[index] === '\\' && index + 1 < command.length) {
          const next = command[index + 1];
          current += ansiEscapes[next] ?? `\\${next}`;
          index += 2;
        } else {
          current += command[index++];
        }
      }
      if (index >= command.length) throw new CurlParseError('Unclosed quote');
      index++;
      continue;
    }

    if (char === "'") {
      const end = command.indexOf("'", index + 1);
      if (end === -1) throw new CurlParseError('Unclosed quote');
      current += command.slice(index + 1, end);
      index = end + 1;
      continue;
    }

    if (char === '"') {
      index++;
      while (index < command.length && command[index] !== '"') {
        if (command[index] === '\\' && '"\\$`\n'.includes(command[index + 1] ?? '')) {
          if (command[index + 1] !== '\n') current += command[index + 1];
          index += 2;
        } else {
          current += command[index++];
        }
      }
      if (index >= command.length) throw new CurlParseError('Unclosed quote');
      index++;
      continue;
    }

    if (char === '\\' && index + 1 < command.length) {
      current += command[index + 1];
      index += 2;
      continue;
    }

    current += char;
    index++;
  }

  if (inToken) tokens.push(current);
  return tokens;
}

const LONG_WITH_VALUE: Record<string, string> = {
  '--request': 'X',
  '--header': 'H',
  '--data': 'd',
  '--data-raw': 'd',
  '--data-binary': 'd',
  '--data-ascii': 'd',
  '--data-urlencode': 'data-urlencode',
  '--json': 'json',
  '--user': 'u',
  '--user-agent': 'A',
  '--cookie': 'b',
  '--referer': 'e',
  '--url': 'url'
};

/** Flags that take a value we don't use; the value must still be skipped. */
const IGNORED_WITH_VALUE = new Set([
  '-o',
  '--output',
  '-m',
  '--max-time',
  '--connect-timeout',
  '-x',
  '--proxy',
  '-w',
  '--write-out',
  '--retry',
  '-c',
  '--cookie-jar',
  '-F',
  '--form'
]);

const SHORT_WITH_VALUE = new Set(['X', 'H', 'd', 'u', 'A', 'b', 'e']);

/** Turns a pasted `curl …` command into a request draft. */
export function parseCurl(command: string): ApiRequestDraft {
  const tokens = tokenizeShell(command.trim());
  if (tokens[0] !== 'curl') throw new CurlParseError('Paste a command that starts with curl');

  let method: string | undefined;
  let url: string | undefined;
  const headers: Record<string, string> = {};
  const data: string[] = [];
  let json = false;
  let forceGet = false;
  let auth: ApiRequestDraft['auth'] = NO_AUTH;

  const apply = (flag: string, value: string) => {
    switch (flag) {
      case 'X':
        method = value.toUpperCase();
        break;
      case 'H': {
        const colon = value.indexOf(':');
        if (colon > 0) headers[value.slice(0, colon).trim()] = value.slice(colon + 1).trim();
        break;
      }
      case 'd':
        data.push(value.startsWith('@') ? '' : value);
        break;
      case 'data-urlencode': {
        const equals = value.indexOf('=');
        data.push(
          equals === -1
            ? encodeURIComponent(value)
            : `${value.slice(0, equals)}=${encodeURIComponent(value.slice(equals + 1))}`
        );
        break;
      }
      case 'json':
        json = true;
        data.push(value);
        break;
      case 'u': {
        const colon = value.indexOf(':');
        auth = {
          type: 'basic',
          username: colon === -1 ? value : value.slice(0, colon),
          password: colon === -1 ? '' : value.slice(colon + 1)
        };
        break;
      }
      case 'A':
        headers['User-Agent'] = value;
        break;
      case 'b':
        headers.Cookie = value;
        break;
      case 'e':
        headers.Referer = value;
        break;
      case 'url':
        url = value;
        break;
    }
  };

  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index];

    if (token.startsWith('--')) {
      const equals = token.indexOf('=');
      const name = equals === -1 ? token : token.slice(0, equals);
      const inline = equals === -1 ? undefined : token.slice(equals + 1);

      if (name in LONG_WITH_VALUE) {
        const value = inline ?? tokens[++index];
        if (value === undefined) throw new CurlParseError(`${name} needs a value`);
        apply(LONG_WITH_VALUE[name], value);
      } else if (name === '--get') {
        forceGet = true;
      } else if (name === '--head') {
        method = 'HEAD';
      } else if (IGNORED_WITH_VALUE.has(name) && inline === undefined) {
        index++;
      }
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      const letter = token[1];
      if (SHORT_WITH_VALUE.has(letter)) {
        const value = token.length > 2 ? token.slice(2) : tokens[++index];
        if (value === undefined) throw new CurlParseError(`-${letter} needs a value`);
        apply(letter, value);
      } else if (IGNORED_WITH_VALUE.has(token)) {
        index++;
      } else {
        // Bundled switches such as -sSL; only -G and -I change the request.
        if (token.includes('G')) forceGet = true;
        if (token.includes('I')) method = 'HEAD';
      }
      continue;
    }

    url ??= token;
  }

  if (!url) throw new CurlParseError('No URL found in the command');
  if (!/^https?:\/\//i.test(url) && !url.startsWith('{{')) url = `https://${url}`;

  let body = data.join('&');
  if (json) {
    body = data.join('');
    headers['Content-Type'] ??= 'application/json';
    headers.Accept ??= 'application/json';
  }

  if (forceGet && body) {
    for (const pair of body.split('&')) {
      const equals = pair.indexOf('=');
      const key = equals === -1 ? pair : pair.slice(0, equals);
      const value = equals === -1 ? '' : pair.slice(equals + 1);
      url = appendQuery(url, decodeURIComponent(key), decodeURIComponent(value));
    }
    body = '';
  }

  const resolvedMethod = (method ?? (forceGet ? 'GET' : body ? 'POST' : 'GET')) as ApiMethod;
  if (!HTTP_METHODS.includes(resolvedMethod)) {
    throw new CurlParseError(`Unsupported method ${resolvedMethod}`);
  }

  return {
    method: resolvedMethod,
    url,
    headers,
    body,
    bodyType: body ? inferBodyType(headers) : 'NONE',
    auth,
    pathParams: {}
  };
}

function inferBodyType(headers: Record<string, string>): ApiBodyType {
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type');
  const contentType = entry?.[1].toLowerCase() ?? 'application/x-www-form-urlencoded';
  if (contentType.includes('json')) return 'JSON';
  if (contentType.includes('x-www-form-urlencoded')) return 'FORM';
  return 'TEXT';
}
