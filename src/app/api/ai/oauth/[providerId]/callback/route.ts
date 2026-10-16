import { getCurrentUser } from '@/lib/auth/session';
import { getAppUrl } from '@/lib/auth/oauth';
import { isDemoMode } from '@/lib/demo';
import { finishProviderOAuth } from '@/features/ai-router/oauth-service';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> }
): Promise<Response> {
  const appUrl = getAppUrl();
  if (!appUrl) return Response.json({ error: 'OAuth is not configured' }, { status: 503 });
  const back = (result: string) => {
    const response = NextResponse.redirect(
      new URL(`/router?tab=providers&aiOAuth=${result}`, appUrl)
    );
    response.headers.set('cache-control', 'no-store');
    response.headers.set('referrer-policy', 'no-referrer');
    return response;
  };
  if (isDemoMode()) return back('error');
  const user = await getCurrentUser();
  if (!user || user.role !== 'ADMIN') return back('error');
  const url = new URL(request.url);
  if (url.searchParams.has('error')) return back('error');
  try {
    const { providerId } = await params;
    await finishProviderOAuth(
      user.id,
      providerId,
      url.searchParams.get('state') ?? '',
      url.searchParams.get('code') ?? ''
    );
    return back('connected');
  } catch {
    return back('error');
  }
}
