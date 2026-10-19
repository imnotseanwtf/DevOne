import { handleChatCompletion } from '@/features/ai-router/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export function POST(request: Request): Promise<Response> {
  return handleChatCompletion(request, 'openai-responses');
}
