import { sessionMessageSchema } from '@/features/devops/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { isSameOrigin } from '@/lib/http/same-origin';
import {
  closeSshSession,
  getSshSession,
  resizeSshSession,
  writeSshSession
} from '@/lib/ssh/session-store';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

async function openSession(request: Request, { params }: RouteContext) {
  if (!isSameOrigin(request)) return { error: NextResponse.json({}, { status: 403 }) };
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({}, { status: 401 }) };
  const session = getSshSession((await params).sessionId, user.id);
  if (!session) return { error: NextResponse.json({ error: 'Session ended' }, { status: 404 }) };
  return { session };
}

/** Keystrokes and terminal resizes. */
export async function POST(request: Request, context: RouteContext) {
  const { session, error } = await openSession(request, context);
  if (!session) return error;

  const parsed = sessionMessageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({}, { status: 400 });
  if (parsed.data.type === 'input') writeSshSession(session, parsed.data.data);
  else resizeSshSession(session, parsed.data.cols, parsed.data.rows);
  return new NextResponse(null, { status: 204 });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { session, error } = await openSession(request, context);
  if (!session) return error;
  closeSshSession(session.id, 'Disconnected');
  return new NextResponse(null, { status: 204 });
}
