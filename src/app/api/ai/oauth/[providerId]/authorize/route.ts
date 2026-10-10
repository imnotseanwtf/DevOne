import { getCurrentUser } from '@/lib/auth/session';
import { isDemoMode, DEMO_DISABLED_MESSAGE } from '@/lib/demo';
import { isSameOrigin } from '@/lib/http/same-origin';
import { startProviderOAuth } from '@/features/ai-router/oauth-service';
import { AiRouterError } from '@/features/ai-router/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> }
): Promise<Response> {
  if (isDemoMode()) return Response.json({ error: DEMO_DISABLED_MESSAGE }, { status: 403 });
  if (!isSameOrigin(request))
    return Response.json({ error: 'Use the DevOne admin page to connect' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user || user.role !== 'ADMIN')
    return Response.json({ error: 'Administrators only' }, { status: 403 });
  try {
    const { providerId } = await params;
    return Response.json(
      { url: await startProviderOAuth(user.id, providerId) },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AiRouterError ? error.message : 'Could not start provider connection'
      },
      { status: 400 }
    );
  }
}
