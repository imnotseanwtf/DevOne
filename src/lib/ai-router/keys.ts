import { createHash, randomBytes } from 'node:crypto';

const KEY_PREFIX = 'dvo_';

/** A new personal AI router key. Only its hash is stored; the key is shown once. */
export function createAiApiKey(): { key: string; hash: string; prefix: string } {
  const key = `${KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
  return { key, hash: hashAiApiKey(key), prefix: key.slice(0, KEY_PREFIX.length + 6) };
}

export function hashAiApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** The key from `Authorization: Bearer …` or `x-api-key`, if it looks like one of ours. */
export function readAiApiKey(headers: Headers): string | null {
  const authorization = headers.get('authorization');
  const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const key = bearer ?? headers.get('x-api-key')?.trim();
  return key?.startsWith(KEY_PREFIX) ? key : null;
}
