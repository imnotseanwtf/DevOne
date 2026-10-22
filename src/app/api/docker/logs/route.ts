import { followResponse } from '@/features/devops/follow-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A container's logs, live (`docker logs --follow`). */
export function GET(request: Request) {
  return followResponse(request, 'logs');
}
