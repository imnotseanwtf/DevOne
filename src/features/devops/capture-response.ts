import {
  SshHostAccessError,
  startCapture,
  TerminalPolicyError
} from '@/features/devops/ssh-service';
import { getCurrentUser } from '@/lib/auth/session';
import { CAPTURE_SECONDS, CONTAINER_ID, DockerError } from '@/lib/docker/containers';
import { HttpAssembler, PcapReader } from '@/lib/docker/pcap';
import { redactExchange } from '@/lib/docker/redact';
import { SshConnectError } from '@/lib/ssh/connection';

const HEARTBEAT_MS = 15_000;
/** The capture ends itself after its length; this is only a backstop for a stuck connection. */
const GRACE_MS = 20_000;
const MAX_EXCHANGES = 300;
const MAX_BYTES = 50 * 1024 * 1024;
const encoder = new TextEncoder();

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function failureMessage(error: unknown): string {
  if (
    error instanceof DockerError ||
    error instanceof SshConnectError ||
    error instanceof TerminalPolicyError
  ) {
    return error.message;
  }
  if (error instanceof SshHostAccessError) return 'Saved host not found';
  return 'Could not start the capture';
}

/**
 * A short capture of a container's HTTP traffic as Server-Sent Events:
 * `exchange` carries a request with its response, `status` carries what the
 * capture container prints (image download, "listening"), and `end` says why it
 * stopped. Credentials are hidden unless the caller asked to see them.
 */
export async function captureResponse(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });

  const params = new URL(request.url).searchParams;
  const projectId = params.get('projectId') ?? '';
  const source = params.get('source') ?? '';
  const containerId = params.get('containerId') ?? '';
  const port = Number(params.get('port'));
  const seconds = Number(params.get('seconds'));
  const reveal = params.get('reveal') === '1';
  if (
    !projectId ||
    !source ||
    !CONTAINER_ID.test(containerId) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !(CAPTURE_SECONDS as readonly number[]).includes(seconds)
  ) {
    return new Response(null, { status: 400 });
  }

  let stream;
  try {
    stream = await startCapture(
      user.id,
      projectId,
      source === 'local' ? { kind: 'local' } : { kind: 'host', hostId: source },
      containerId,
      port,
      seconds,
      reveal
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
      let exchanges = 0;
      let bytes = 0;
      let lastStatus = '';
      const send = (text: string) => {
        if (open) controller.enqueue(encoder.encode(text));
      };
      const finish = (reason: string) => {
        if (!open) return;
        assembler.end();
        send(sse('end', { reason, exchanges }));
        stopNow();
        controller.close();
      };
      const timers = [
        setInterval(() => send(': ping\n\n'), HEARTBEAT_MS),
        setTimeout(() => finish('Capture finished'), (seconds + GRACE_MS / 1000) * 1000)
      ];
      const stopNow = () => {
        if (!open) return;
        open = false;
        for (const timer of timers) {
          clearInterval(timer);
          clearTimeout(timer);
        }
        request.signal.removeEventListener('abort', stopNow);
        stream.close();
      };
      stop = stopNow;
      request.signal.addEventListener('abort', stopNow);

      const assembler = new HttpAssembler(port, (exchange) => {
        exchanges++;
        send(sse('exchange', reveal ? exchange : redactExchange(exchange)));
        if (exchanges >= MAX_EXCHANGES) finish(`Stopped after ${MAX_EXCHANGES} requests`);
      });
      const reader = new PcapReader((segment) => assembler.push(segment));

      stream.onData((chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) {
          finish('Stopped: the capture grew too large');
          return;
        }
        try {
          reader.push(chunk);
        } catch {
          finish(lastStatus || 'The capture could not be read');
        }
      });
      stream.onStatus((text) => {
        const line = text.trim().split('\n').at(-1)?.slice(0, 200) ?? '';
        if (!line) return;
        lastStatus = line;
        send(sse('status', { text: line }));
      });
      stream.onEnd((reason) => {
        // Nothing was captured and Docker said why (no permission, image can't be pulled): show that.
        if (reason && bytes === 0 && lastStatus) finish(lastStatus);
        else if (reason) finish(reason);
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
