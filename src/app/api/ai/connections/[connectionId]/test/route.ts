import { handleChatCompletion } from '@/features/ai-router/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** An administrator's diagnostic chat is pinned to one account, without fallback. */
export async function POST(
  request: Request,
  context: { params: Promise<{ connectionId: string }> }
): Promise<Response> {
  const { connectionId } = await context.params;
  return handleChatCompletion(request, 'openai', connectionId);
}
