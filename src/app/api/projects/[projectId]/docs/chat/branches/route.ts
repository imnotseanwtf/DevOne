import { DocsChatAccessError, listChatRepositories } from '@/features/docs-chat/service';
import { routerError } from '@/lib/ai-router/forward';
import { getCurrentUser } from '@/lib/auth/session';
import { DEMO_DISABLED_MESSAGE, isDemoMode } from '@/lib/demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The project's linked repositories and their branches, for the chat's Code picker. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  if (isDemoMode()) return routerError(403, DEMO_DISABLED_MESSAGE, 'demo_mode');
  const user = await getCurrentUser();
  if (!user) return routerError(401, 'Sign in to chat with the docs', 'unauthorized');

  const { projectId } = await params;
  try {
    return Response.json({ repositories: await listChatRepositories(user.id, projectId) });
  } catch (error) {
    if (error instanceof DocsChatAccessError) return routerError(404, error.message, 'not_found');
    throw error;
  }
}
