import { getCurrentUser } from '@/lib/auth/session';
import { listSessionContainers } from '@/lib/docker/session-containers';
import { getSshSession } from '@/lib/ssh/session-store';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Container names for the terminal's autocomplete. A server without Docker, or
 * a user who can't use it, is an empty list rather than an error: the terminal
 * just has nothing to suggest.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const session = getSshSession((await params).sessionId, user.id);
  if (!session) return new Response(null, { status: 404 });

  const containers = await listSessionContainers(session).catch(() => []);
  return NextResponse.json({
    containers: containers.map(({ name, image, state }) => ({ name, image, state }))
  });
}
