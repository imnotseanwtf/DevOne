import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * A provider's base URL is typed by an administrator, but the server is the
 * one that calls it. Local models (Ollama, LM Studio) and company gateways
 * live on loopback and private networks, so those stay allowed; what is
 * refused is the link-local range, where cloud metadata services hand out
 * credentials (169.254.169.254), plus the unspecified, multicast and
 * reserved ranges, which are never a model server.
 */
export class UnsafeProviderUrlError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'UnsafeProviderUrlError';
  }
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['169.254.0.0', 16],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];

export function isForbiddenProviderAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4ToInt(address);
    if (value === null) return true;
    return BLOCKED_V4.some(([base, bits]) => {
      const baseValue = ipv4ToInt(base) ?? 0;
      const mask = (-1 << (32 - bits)) >>> 0;
      return (value & mask) >>> 0 === (baseValue & mask) >>> 0;
    });
  }
  if (family === 6) {
    const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
    if (normalized === '::') return true;
    if (/^fe[89ab]/.test(normalized) || normalized.startsWith('ff')) return true;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isForbiddenProviderAddress(mapped[1]) : false;
  }
  return true;
}

async function defaultResolve(hostname: string): Promise<string[]> {
  try {
    return (await lookup(hostname, { all: true })).map((result) => result.address);
  } catch {
    throw new UnsafeProviderUrlError('The host could not be resolved');
  }
}

/** Resolves the base URL's host and refuses metadata, link-local and reserved addresses. */
export async function assertSafeProviderUrl(
  baseUrl: string,
  resolve: (hostname: string) => Promise<string[]> = defaultResolve
): Promise<void> {
  const hostname = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [hostname] : await resolve(hostname);
  if (addresses.length === 0) throw new UnsafeProviderUrlError('The host could not be resolved');
  if (addresses.some(isForbiddenProviderAddress)) {
    throw new UnsafeProviderUrlError(
      'That address is a link-local or reserved one (such as a cloud metadata service)'
    );
  }
}
