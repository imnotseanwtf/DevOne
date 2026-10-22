import {
  followContainerLogs,
  SshHostAccessError,
  TerminalPolicyError
} from '@/features/devops/ssh-service';
import { getCurrentUser } from '@/lib/auth/session';
import { CONTAINER_ID, DockerError } from '@/lib/docker/containers';
import { SshConnectError } from '@/lib/ssh/connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;
const encoder = new TextEncoder();

const sse = (event: string | null, data: unknown) =>
  `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;

function failureMessage(error: unknown): string {
  if (
    error instanceof DockerError ||
    error instanceof SshConnectError ||
    error instanceof TerminalPolicyError
  ) {
    return error.message;
  }
  if (error instanceof SshHostAccessError) return 'Saved host not found';
  return 'Could not follow the logs';
}

/**
 * A container's logs as Server-Sent Events, live (`docker logs --follow`): each
 * message is a JSON string chunk, and an `end` event says why it stopped.
 * Closing the connection stops the Docker command.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });

  const params = new URL(request.url).searchParams;
  const projectId = params.get('projectId') ?? '';
  const source = params.get('source') ?? '';
  const containerId = params.get('containerId') ?? '';
  if (!projectId || !source || !CONTAINER_ID.test(containerId)) {
    return new Response(null, { status: 400 });
  }

  let logs;
  try {
    logs = await followContainerLogs(
      user.id,
      projectId,
      source === 'local' ? { kind: 'local' } : { kind: 'host', hostId: source },
      containerId
    );
  } catch (error) {
    // Sent as a stream event so the page can show it; EventSource hides HTTP error bodies.
    return new Response(sse('end', { reason: failureMessage(error) }), {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  let stop: (() => void) | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (text: string) => {
        if (open) controller.enqueue(encoder.encode(text));
      };
      const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
      const stopNow = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        request.signal.removeEventListener('abort', stopNow);
        logs.close();
      };
      stop = stopNow;
      request.signal.addEventListener('abort', stopNow);

      logs.onData((chunk) => send(sse(null, chunk)));
      logs.onEnd((reason) => {
        if (reason) send(sse('end', { reason }));
        stopNow();
        controller.close();
      });
      send(': connected\n\n');
    },
    cancel() {
      stop?.();
    }
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
