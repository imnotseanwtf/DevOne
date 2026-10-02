import { GitProvider } from '@/generated/prisma/client';
import { syncIssuesForRepositoryFullName } from '@/features/issues/service';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * GitLab webhook: resyncs issue links on pushes and merge-request changes, so
 * the board follows all branches without manual syncs.
 *
 * Setup: project (or group) Settings → Webhooks → URL
 * `https://<devone>/api/webhooks/gitlab`, the same secret token as
 * `DEVONE_GITLAB_WEBHOOK_TOKEN`, trigger on push and merge request events.
 * The token (`X-Gitlab-Token`) is always verified, and repeating a delivery
 * is safe: links are idempotent and statuses only move forward.
 */
export async function POST(request: Request) {
  const secret = process.env.DEVONE_GITLAB_WEBHOOK_TOKEN;
  if (!secret) {
    return NextResponse.json({ error: 'GitLab webhooks are not configured' }, { status: 503 });
  }

  const provided = Buffer.from(request.headers.get('x-gitlab-token') ?? '');
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    object_kind?: string;
    event_name?: string;
    project?: { path_with_namespace?: string };
  } | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });

  const event = body.object_kind ?? body.event_name ?? '';
  if (event === 'push' || event === 'merge_request' || event === 'tag_push') {
    const fullName = body.project?.path_with_namespace;
    if (!fullName) return NextResponse.json({ error: 'Missing project' }, { status: 400 });
    const result = await syncIssuesForRepositoryFullName(GitProvider.GITLAB, fullName);
    return NextResponse.json({ ok: true, repository: fullName, event, ...result });
  }

  return NextResponse.json({ ok: true, ignored: event || 'unknown' });
}
