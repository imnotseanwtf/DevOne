import { handleMessages } from '@/features/ai-router/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Anthropic Messages API (Claude Code), routed across the configured providers. */
export function POST(request: Request) {
  return handleMessages(request);
}
