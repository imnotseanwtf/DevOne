import { connectRequestSchema } from '@/features/devops/schema';
import {
  connectNewSsh,
  connectSavedSsh,
  SshHostAccessError,
  TerminalPolicyError
} from '@/features/devops/ssh-service';
import { getCurrentUser } from '@/lib/auth/session';
import { isSameOrigin } from '@/lib/http/same-origin';
import { SshConnectError } from '@/lib/ssh/connection';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Opens an SSH shell and returns the id its stream and input routes use. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail('Cross-site request refused', 403);
  const user = await getCurrentUser();
  if (!user) return fail('Sign in again', 401);

  const parsed = connectRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('Check the connection details', 400);
  const input = parsed.data;

  try {
    const size = { cols: input.cols, rows: input.rows };
    const connected =
      input.mode === 'saved'
        ? await connectSavedSsh(user.id, input.projectId, input.hostId, size)
        : await connectNewSsh(user.id, input.projectId, input.connection, size);
    return NextResponse.json({
      sessionId: connected.session.id,
      label: connected.session.label,
      fingerprint: connected.fingerprint,
      hostId: connected.hostId
    });
  } catch (error) {
    if (error instanceof SshConnectError) return fail(error.message, 502);
    if (error instanceof TerminalPolicyError) return fail(error.message, 403);
    if (error instanceof SshHostAccessError) return fail('Saved host not found', 404);
    return fail('Could not open the connection', 500);
  }
}
