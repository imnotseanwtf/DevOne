import type { Exchange, HttpMessageBody } from '@/lib/docker/pcap';

export const HIDDEN = '‹hidden›';

/** Headers that carry credentials. */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token'
]);

/** Field names whose values are credentials or personal secrets, in JSON, forms and query strings. */
const SENSITIVE_KEY =
  /pass(?:word|wd|phrase)?|secret|token|api[-_]?key|apikey|authorization|credential|private[-_]?key|session|otp|pin|cvv|card[-_]?number|ssn/i;

function maskHeaders(headers: [string, string][]): [string, string][] {
  return headers.map(([key, value]) => [
    key,
    SENSITIVE_HEADERS.has(key.toLowerCase()) ? HIDDEN : value
  ]);
}

function maskJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        SENSITIVE_KEY.test(key) && (typeof inner === 'string' || typeof inner === 'number')
          ? HIDDEN
          : maskJson(inner)
      ])
    );
  }
  return value;
}

/** `a=1&password=x` with the secret values hidden. */
function maskPairs(text: string): string {
  return text
    .split('&')
    .map((pair) => {
      const at = pair.indexOf('=');
      if (at < 0) return pair;
      return SENSITIVE_KEY.test(decodeURIComponent(pair.slice(0, at).replace(/\+/g, ' ')))
        ? `${pair.slice(0, at)}=${HIDDEN}`
        : pair;
    })
    .join('&');
}

function maskTarget(target: string): string {
  const at = target.indexOf('?');
  return at < 0 ? target : `${target.slice(0, at + 1)}${maskPairs(target.slice(at + 1))}`;
}

function maskBody(body: HttpMessageBody, headers: [string, string][]): HttpMessageBody {
  if (body.text === null || body.note === 'truncated') {
    // A cut-off body can't be parsed to find its secrets: show none of it rather than risk leaking.
    return body.note === 'truncated' ? { text: null, size: body.size, note: 'truncated' } : body;
  }
  const type = headers.find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
  const trimmed = body.text.trim();
  if (/json/i.test(type) || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return { ...body, text: JSON.stringify(maskJson(JSON.parse(body.text)), null, 2) };
    } catch {
      // Not JSON after all: fall through.
    }
  }
  if (/x-www-form-urlencoded/i.test(type)) return { ...body, text: maskPairs(body.text) };
  return body;
}

/**
 * A copy of the exchange that is safe to put on screen: credentials in headers,
 * query strings and form or JSON bodies are replaced with a placeholder. Free
 * text can still contain anything, which is why a capture asks first and why
 * a body that was cut off is withheld.
 */
export function redactExchange(exchange: Exchange): Exchange {
  const { request, response } = exchange;
  return {
    ...exchange,
    request: {
      ...request,
      target: maskTarget(request.target),
      headers: maskHeaders(request.headers),
      body: maskBody(request.body, request.headers)
    },
    response: response
      ? {
          ...response,
          headers: maskHeaders(response.headers),
          body: maskBody(response.body, response.headers)
        }
      : null
  };
}
