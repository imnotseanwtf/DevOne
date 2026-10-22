import { followResponse } from '@/features/devops/follow-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What happened to a container, live (`docker events`): the last day, then new events. */
export function GET(request: Request) {
  return followResponse(request, 'events');
}
