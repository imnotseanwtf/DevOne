import { getCurrentUser } from '@/lib/auth/session';
import {
  attachSshSession,
  getSshSession,
  type SshEvent,
  type SshSession
} from '@/lib/ssh/session-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;
const encoder = new TextEncoder();

function eventText(event: SshEvent): string {
  return event.type === 'data'
    ? `data: ${event.data.toString('base64')}\n\n`
    : `event: exit\ndata: ${JSON.stringify({ reason: event.reason })}\n\n`;
}

function sessionStream(session: SshSession, signal: AbortSignal): ReadableStream<Uint8Array> {
  let stop: (() => void) | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (text: string) => {
        if (open) controller.enqueue(encoder.encode(text));
      };
      const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
      let detach: (() => void) | null = null;
      let ended = false;

      const stopNow = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        signal.removeEventListener('abort', stopNow);
        detach?.();
      };
      stop = stopNow;
      signal.addEventListener('abort', stopNow);

      send(': connected\n\n');
      detach = attachSshSession(session, (event) => {
        send(eventText(event));
        if (event.type !== 'exit') return;
        ended = true;
        stopNow();
        controller.close();
      });
      // The session may have ended already, during the attach itself.
      if (ended) detach();
    },
    cancel() {
      stop?.();
    }
  });
}

/**
 * The shell's output as Server-Sent Events: each `data:` is a base64 chunk, and
 * an `exit` event carries why the session ended. Closing the stream detaches;
 * the shell stays open briefly so a reload can pick it back up.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const session = getSshSession((await params).sessionId, user.id);
  if (!session) return new Response(null, { status: 404 });

  return new Response(sessionStream(session, request.signal), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform also keeps compression from buffering the stream.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
