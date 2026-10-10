import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { isBlockedAddress } from '@/lib/api-client/guard';
import type { ProviderOAuthConfig } from './types';

export class GatewayRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'GatewayRequestError';
  }
}

function normalizeAddress(value: string): string {
  let address = value.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(address) === 6)
    address = new URL(`http://[${address}]/`).hostname.replace(/^\[|\]$/g, '');
  const mapped = address.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/);
  if (!mapped) return address;
  const first = parseInt(mapped[1], 16);
  const second = parseInt(mapped[2], 16);
  return `${first >> 8}.${first & 255}.${second >> 8}.${second & 255}`;
}

/** Local inference is allowed only for exact host:port entries set by the operator. */
export async function resolveGatewayUrl(
  value: string,
  allowedHosts = (process.env.DEVONE_AI_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
  resolve: (hostname: string) => Promise<string[]> = async (hostname) =>
    (await lookup(hostname, { all: true })).map((entry) => entry.address)
): Promise<{ url: URL; addresses: string[] }> {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new GatewayRequestError('Invalid provider URL', 400);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const localAllowed = allowedHosts.includes(url.host.toLowerCase());
  if (url.protocol === 'http:' && !localAllowed) {
    throw new GatewayRequestError('Use HTTPS, or explicitly allow this local host and port', 400);
  }
  const addresses = isIP(hostname) ? [hostname] : await resolve(hostname);
  if (!addresses.length) throw new GatewayRequestError('Provider host could not be resolved', 400);
  for (const rawAddress of addresses) {
    const address = normalizeAddress(rawAddress);
    if (
      address.startsWith('169.254.') ||
      address === 'fd00:ec2::254' ||
      hostname === 'metadata.google.internal'
    ) {
      throw new GatewayRequestError('Metadata service access is forbidden', 400);
    }
    if (!localAllowed && isBlockedAddress(address)) {
      throw new GatewayRequestError(
        'Private provider hosts require an explicit allowed host and port',
        400
      );
    }
  }
  return { url, addresses };
}

export async function assertGatewayUrl(
  value: string,
  allowedHosts?: string[],
  resolve?: (hostname: string) => Promise<string[]>
): Promise<void> {
  await resolveGatewayUrl(value, allowedHosts, resolve);
}

export async function readGatewayBody(
  request: Request,
  maxBytes = 1024 * 1024
): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length')) > maxBytes) {
    throw new GatewayRequestError('Request body is too large', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new GatewayRequestError('A JSON body is required', 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new GatewayRequestError('Request body is too large', 413);
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new GatewayRequestError('The body must be a JSON object', 400);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof GatewayRequestError) throw error;
    throw new GatewayRequestError('Invalid JSON body', 400);
  } finally {
    reader.releaseLock();
  }
}

export function validOAuthSession(
  session: { providerId: string; userId: string; stateHash: string; expiresAt: Date },
  providerId: string,
  userId: string,
  stateHash: string,
  now = new Date()
): boolean {
  return (
    session.providerId === providerId &&
    session.userId === userId &&
    session.stateHash === stateHash &&
    session.expiresAt > now
  );
}

export function oauthConfigFingerprint(providerType: string, config: ProviderOAuthConfig): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        providerType,
        clientId: config.clientId,
        authorizeUrl: config.authorizeUrl,
        tokenUrl: config.tokenUrl,
        scope: config.scope,
        encoding: config.encoding,
        redirectUri: config.redirectUri,
        authorizeParams: config.authorizeParams,
        includeStateInToken: config.includeStateInToken
      })
    )
    .digest('hex');
}

/** Only truncate text returned by tools; preserve the user's messages and tool-call structure. */
export function compressToolMessages<T extends Record<string, unknown>>(
  body: T,
  limit: number
): { body: T; savedChars: number } {
  let savedChars = 0;
  const shrink = (text: string) => {
    if (text.length <= limit) return text;
    const marker = '\n[tool output truncated]\n';
    const available = Math.max(0, limit - marker.length);
    const tail = Math.floor(available / 2);
    const result = available
      ? text.slice(0, Math.ceil(available / 2)) + marker + (tail ? text.slice(-tail) : '')
      : marker.slice(0, limit);
    savedChars += text.length - result.length;
    return result;
  };
  const shrinkContent = (content: unknown): unknown => {
    if (typeof content === 'string') return shrink(content);
    if (!Array.isArray(content)) return content;
    return content.map((block: unknown) => {
      if (!block || typeof block !== 'object') return block;
      const entry = block as Record<string, unknown>;
      return ['text', 'input_text', 'output_text'].includes(String(entry.type)) &&
        typeof entry.text === 'string'
        ? { ...entry, text: shrink(entry.text) }
        : block;
    });
  };
  const messages = Array.isArray(body.messages)
    ? body.messages.map((message: unknown) => {
        if (!message || typeof message !== 'object') return message;
        const entry = message as Record<string, unknown>;
        if (entry.role === 'tool') return { ...entry, content: shrinkContent(entry.content) };
        if (Array.isArray(entry.content))
          return {
            ...entry,
            content: entry.content.map((block: unknown) => {
              if (!block || typeof block !== 'object') return block;
              const result = block as Record<string, unknown>;
              return result.type === 'tool_result'
                ? { ...result, content: shrinkContent(result.content) }
                : block;
            })
          };
        return message;
      })
    : body.messages;
  const input = Array.isArray(body.input)
    ? body.input.map((item: unknown) => {
        if (!item || typeof item !== 'object') return item;
        const entry = item as Record<string, unknown>;
        return entry.type === 'function_call_output'
          ? { ...entry, output: shrinkContent(entry.output) }
          : item;
      })
    : body.input;
  return {
    body: { ...body, ...(messages ? { messages } : {}), ...(input ? { input } : {}) },
    savedChars
  };
}
