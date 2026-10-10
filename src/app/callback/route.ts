import { createHash } from 'node:crypto';
import { getPrisma } from '@/lib/db/prisma';
import { getCurrentUser } from '@/lib/auth/session';
import { GET as providerCallback } from '@/app/api/ai/oauth/[providerId]/callback/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Loopback clients use /callback; the stored state identifies the provider, never URL input. */
export async function GET(request: Request): Promise<Response> {
  const state = new URL(request.url).searchParams.get('state') ?? '';
  const user = await getCurrentUser();
  const session =
    user?.role === 'ADMIN' && state && state.length <= 256
      ? await getPrisma().aiOAuthSession.findUnique({
          where: { stateHash: createHash('sha256').update(state).digest('hex') },
          select: { providerId: true, userId: true }
        })
      : null;
  const providerId = session?.userId === user?.id ? (session?.providerId ?? '') : '';
  return providerCallback(request, { params: Promise.resolve({ providerId }) });
}
