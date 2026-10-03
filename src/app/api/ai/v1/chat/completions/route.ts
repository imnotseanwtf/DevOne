import { handleChatCompletion } from '@/features/ai-router/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** OpenAI-compatible chat completions, routed across the configured providers with fallback. */
export function POST(request: Request) {
  return handleChatCompletion(request);
}
