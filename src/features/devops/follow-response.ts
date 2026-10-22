import {
  followContainerEvents,
  followContainerLogs,
  followContainerRequests,
  SshHostAccessError,
  TerminalPolicyError
} from '@/features/devops/ssh-service';
import { getCurrentUser } from '@/lib/auth/session';
import { createLineReader, isForTarget, parseAccessLogLine } from '@/lib/docker/access-log';
import { CONTAINER_ID, DockerError, type LogStream } from '@/lib/docker/containers';
import { parseDockerEvent } from '@/lib/docker/events';
import { SshConnectError } from '@/lib/ssh/connection';

const HEARTBEAT_MS = 15_000;
/** The first "how many access-log lines have I seen" report, then one at this pace. */
const META_FIRST_MS = 4_000;
const META_EVERY_MS = 10_000;
const encoder = new TextEncoder();

const sse = (event: string | null, data: unknown) =>
  `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;

function failureMessage(error: unknown, fallback: string): string {
  if (
    error instanceof DockerError ||
    error instanceof SshConnectError ||
    error instanceof TerminalPolicyError
  ) {
    return error.message;
  }
  if (error instanceof SshHostAccessError) return 'Saved host not found';
  return fallback;
}

export type FollowKind = 'logs' | 'events' | 'requests';

/**
 * A container's live data as Server-Sent Events. `logs` sends text chunks,
 * `events` sends Docker events, `requests` sends the proxy's requests to this
 * container (with `meta` events saying which proxy and how many log lines it has
 * seen, so the page can tell "no traffic" from "access log is off"). An `end`
 * event says why it stopped. Closing the connection stops the Docker command.
 */
export async function followResponse(request: Request, kind: FollowKind): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });

  const params = new URL(request.url).searchParams;
  const projectId = params.get('projectId') ?? '';
  const source = params.get('source') ?? '';
  const containerId = params.get('containerId') ?? '';
  if (!projectId || !source || !CONTAINER_ID.test(containerId)) {
    return new Response(null, { status: 400 });
  }
  const where =
    source === 'local' ? ({ kind: 'local' } as const) : ({ kind: 'host', hostId: source } as const);

  let stream: LogStream;
  let requestsContext: Awaited<ReturnType<typeof followContainerRequests>> | null = null;
  try {
    if (kind === 'requests') {
      requestsContext = await followContainerRequests(user.id, projectId, where, containerId);
      stream = requestsContext.stream;
    } else if (kind === 'events') {
      stream = await followContainerEvents(user.id, projectId, where, containerId);
    } else {
      stream = await followContainerLogs(user.id, projectId, where, containerId);
    }
  } catch (error) {
    // Sent as a stream event so the page can show it; EventSource hides HTTP error bodies.
    const reason = failureMessage(error, `Could not follow the ${kind}`);
    return new Response(sse('end', { reason }), {
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
      const timers: ReturnType<typeof setInterval>[] = [
        setInterval(() => send(': ping\n\n'), HEARTBEAT_MS)
      ];
      const stopNow = () => {
        if (!open) return;
        open = false;
        for (const timer of timers) clearInterval(timer);
        request.signal.removeEventListener('abort', stopNow);
        stream.close();
      };
      stop = stopNow;
      request.signal.addEventListener('abort', stopNow);

      if (kind === 'logs') {
        stream.onData((chunk) => send(sse(null, chunk)));
      } else if (kind === 'events') {
        stream.onData(
          createLineReader((line) => {
            const event = parseDockerEvent(line);
            if (event) send(sse(null, event));
          })
        );
      } else if (requestsContext) {
        const { target, proxy } = requestsContext;
        let seen = 0;
        const meta = () => send(sse('meta', { proxy, seen }));
        stream.onData(
          createLineReader((line) => {
            const entry = parseAccessLogLine(line);
            if (!entry) return;
            seen++;
            if (isForTarget(entry, target)) send(sse(null, entry));
          })
        );
        // Once the history has been read, and every so often after.
        const first = setTimeout(() => {
          meta();
          timers.push(setInterval(meta, META_EVERY_MS));
        }, META_FIRST_MS);
        timers.push(first as unknown as ReturnType<typeof setInterval>);
      }
      stream.onEnd((reason) => {
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
