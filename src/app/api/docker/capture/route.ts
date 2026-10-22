import { captureResponse } from '@/features/devops/capture-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A few seconds of a container's HTTP traffic, as request/response pairs. Owners only. */
export function GET(request: Request) {
  return captureResponse(request);
}
