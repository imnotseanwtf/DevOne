import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'devone_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function getSessionExpiry(now = new Date()): Date {
  return new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
}
