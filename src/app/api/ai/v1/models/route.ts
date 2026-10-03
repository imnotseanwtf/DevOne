import { handleModels } from '@/features/ai-router/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** OpenAI-compatible model list: "auto", the combos, and every provider's models. */
export function GET(request: Request) {
  return handleModels(request);
}
