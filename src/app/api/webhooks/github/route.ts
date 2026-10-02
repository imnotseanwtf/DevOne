import { GitProvider } from '@/generated/prisma/client';
import { syncIssuesForRepositoryFullName } from '@/features/issues/service';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * GitHub webhook: resyncs issue links every time code is pushed or a pull
 * request changes, so the board follows all branches without manual syncs.
 *
 * Setup: repository (or organization) Settings → Webhooks → Add webhook with
 * Payload URL `https://<devone>/api/webhooks/github`, content type JSON, and
 * the same secret as `DEVONE_GITHUB_WEBHOOK_SECRET`. Subscribe to pushes and
 * pull requests. Signature (`X-Hub-Signature-256`) is always verified, and
 * repeating a delivery is safe: links are idempotent and statuses only move
 * forward.
 */
export async function POST(request: Request) {
  const secret = process.env.DEVONE_GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'GitHub webhooks are not configured' }, { status: 503 });
  }

  const raw = await request.text();
  const signature = request.headers.get('x-hub-signature-256') ?? '';
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const received = Buffer.from(signature);
  const computed = Buffer.from(expected);
  if (received.length !== computed.length || !timingSafeEqual(received, computed)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = request.headers.get('x-github-event') ?? '';
  if (event === 'ping') return NextResponse.json({ ok: true, event: 'ping' });
  if (event !== 'push' && event !== 'pull_request') {
    return NextResponse.json({ ok: true, ignored: event || 'unknown' });
  }

  let fullName: string | undefined;
  try {
    fullName = (JSON.parse(raw) as { repository?: { full_name?: string } }).repository?.full_name;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  if (!fullName) return NextResponse.json({ error: 'Missing repository' }, { status: 400 });

  const result = await syncIssuesForRepositoryFullName(GitProvider.GITHUB, fullName);
  return NextResponse.json({ ok: true, repository: fullName, event, ...result });
}
