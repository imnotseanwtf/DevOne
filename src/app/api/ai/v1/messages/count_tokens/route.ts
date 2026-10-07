import { handleCountTokens } from '@/features/ai-router/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return handleCountTokens(request);
}
