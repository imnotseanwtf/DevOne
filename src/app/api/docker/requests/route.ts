import { followResponse } from '@/features/devops/follow-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The requests the reverse proxy sent to a container, live, from the proxy's access log. */
export function GET(request: Request) {
  return followResponse(request, 'requests');
}
