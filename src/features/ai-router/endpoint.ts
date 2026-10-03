import { getAppUrl } from '@/lib/auth/oauth';
import { headers } from 'next/headers';

/** The router's base URL as tools outside the browser should use it. */
export async function routerEndpoint(): Promise<string> {
  const appUrl = getAppUrl();
  if (appUrl) return `${appUrl}/api/ai/v1`;
  const requestHeaders = await headers();
  const host =
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3000';
  const protocol =
    requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${protocol}://${host}/api/ai/v1`;
}
