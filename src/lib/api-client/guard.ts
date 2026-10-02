import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * DevOne's server can reach the machines DevOne runs beside: the internal
 * database, the metadata service, other services on the host. A request
 * composed in the browser must not be able to use the server as a proxy into
 * that network, so every destination is resolved and checked before it is
 * fetched.
 */
export class BlockedRequestError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'BlockedRequestError';
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

const BLOCKED_V4_RANGES: [string, number][] = [
  ['0.0.0.0', 8], // this network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata at 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4] // reserved
];

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);

  if (family === 4) {
    const value = ipv4ToInt(address);
    if (value === null) return true;

    return BLOCKED_V4_RANGES.some(([base, bits]) => {
      const baseValue = ipv4ToInt(base);
      if (baseValue === null) return false;
      const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
      return (value & mask) >>> 0 === (baseValue & mask) >>> 0;
    });
  }

  if (family === 6) {
    const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
    if (normalized === '::' || normalized === '::1') return true;
    // Unique local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized)) return true;
    // IPv4-mapped addresses re-enter the v4 rules.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    return false;
  }

  return true;
}

export function parseRequestUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BlockedRequestError('Enter a valid absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedRequestError('Only http and https requests are allowed');
  }
  return url;
}

/**
 * Resolves the hostname and refuses private destinations. Checking the resolved
 * address rather than the hostname is what stops a public name that points at
 * 127.0.0.1 or the cloud metadata endpoint.
 */
export async function assertSafeRequestUrl(
  value: string,
  resolve: (hostname: string) => Promise<string[]> = defaultResolve
): Promise<URL> {
  const url = parseRequestUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  const addresses = isIP(hostname) ? [hostname] : await resolve(hostname);
  if (addresses.length === 0) throw new BlockedRequestError('Host could not be resolved');

  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new BlockedRequestError('That host is on a private or reserved network');
    }
  }

  return url;
}

async function defaultResolve(hostname: string): Promise<string[]> {
  try {
    const results = await lookup(hostname, { all: true });
    return results.map((result) => result.address);
  } catch {
    throw new BlockedRequestError('Host could not be resolved');
  }
}

/** Substitutes {{VAR}} placeholders from the selected environment. */
export function applyVariables(text: string, variables: Record<string, string>): string {
  return text.replaceAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) =>
    Object.hasOwn(variables, name) ? variables[name] : match
  );
}
