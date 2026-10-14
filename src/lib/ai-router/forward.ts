import {
  providerUrl,
  shouldFallBack,
  usageFromJson,
  usageFromSse,
  type RouteTarget,
  type TokenUsage
} from '@/lib/ai-router/routing';

export interface AttemptFailure {
  target: RouteTarget;
  /** The provider's HTTP status, or 0 when it could not be reached. */
  status: number;
  error: string;
  retryAfter: string | null;
}

export interface ForwardOutcome {
  /** The provider model that answered, or null when none did. */
  target: RouteTarget | null;
  status: number;
  attempts: number;
  usage: TokenUsage;
  error: string | null;
}

export interface ForwardOptions {
  /** The client's chat completion request, as parsed JSON. */
  body: Record<string, unknown>;
  targets: RouteTarget[];
  apiKeyFor: (providerId: string) => string | null;
  fetchImpl?: typeof fetch;
  /** The client's request signal: a client that leaves stops the upstream call. */
  signal?: AbortSignal;
  /** How long to wait for a provider to start answering before moving on. */
  timeoutMs?: number;
  onFailure?: (failure: AttemptFailure) => void | Promise<void>;
  /** Called once, after the answer has been sent in full (or the request failed). */
  onFinish?: (outcome: ForwardOutcome) => void | Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 60_000;
/** A streamed answer's usage is in its last chunks; only this much of the tail is kept. */
const SSE_TAIL_CHARS = 64 * 1024;

const NO_USAGE: TokenUsage = { promptTokens: null, completionTokens: null };

export function routerError(status: number, message: string, code: string): Response {
  return Response.json({ error: { message, type: 'devone_router_error', code } }, { status });
}

function upstreamBody(body: Record<string, unknown>, model: string): string {
  const next: Record<string, unknown> = { ...body, model };
  // Ask for token counts in the last streamed chunk, unless the client chose otherwise.
  if (next.stream === true && next.stream_options === undefined) {
    next.stream_options = { include_usage: true };
  }
  return JSON.stringify(next);
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } | string };
    const message = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
    if (typeof message === 'string' && message) return message.slice(0, 500);
  } catch {
    // Not JSON: use the text as it is.
  }
  return (text || response.statusText || `HTTP ${response.status}`).slice(0, 500);
}

function answerHeaders(response: Response, target: RouteTarget, attempts: number): Headers {
  const headers = new Headers({
    'content-type': response.headers.get('content-type') ?? 'application/json',
    'x-devone-provider': target.provider.name,
    'x-devone-model': target.model,
    'x-devone-attempts': String(attempts)
  });
  if ((headers.get('content-type') ?? '').includes('text/event-stream')) {
    headers.set('cache-control', 'no-cache, no-transform');
    headers.set('x-accel-buffering', 'no');
  }
  return headers;
}

/** Passes a streamed answer through untouched, reading token counts from its tail. */
function relayStream(
  body: ReadableStream<Uint8Array>,
  finish: (usage: TokenUsage, error: string | null) => void
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let tail = '';
  let done = false;
  const end = (error: string | null) => {
    if (done) return;
    done = true;
    finish(usageFromSse(tail + decoder.decode()), error);
  };
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done: finished } = await reader.read();
        if (finished) {
          end(null);
          controller.close();
          return;
        }
        tail = (tail + decoder.decode(value, { stream: true })).slice(-SSE_TAIL_CHARS);
        controller.enqueue(value);
      } catch (error) {
        end(error instanceof Error ? error.message : 'Stream interrupted');
        controller.error(error);
      }
    },
    async cancel(reason) {
      end('Client disconnected');
      await reader.cancel(reason).catch(() => undefined);
    }
  });
}

/**
 * Sends a chat completion to each target in turn until one answers. A
 * provider that is down, rate-limited or refuses its key hands over to the
 * next; a request the provider calls malformed goes back to the client as is.
 * Once a provider starts answering, the answer is relayed as it arrives.
 */
export async function forwardChatCompletion(options: ForwardOptions): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const finish = (outcome: ForwardOutcome) => {
    void Promise.resolve(options.onFinish?.(outcome)).catch(() => undefined);
  };
  const requested = typeof options.body.model === 'string' ? options.body.model : '';

  if (options.targets.length === 0) {
    const message = `No enabled provider serves the model "${requested}"`;
    finish({ target: null, status: 404, attempts: 0, usage: NO_USAGE, error: message });
    return routerError(404, message, 'model_not_found');
  }

  let attempts = 0;
  let last: { status: number; error: string } | null = null;

  for (const target of options.targets) {
    if (options.signal?.aborted) break;
    attempts += 1;

    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    const apiKey = options.apiKeyFor(target.provider.id);

    let response: Response;
    try {
      response = await fetchImpl(providerUrl(target.provider.baseUrl, 'chat/completions'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: options.body.stream === true ? 'text/event-stream' : 'application/json',
          'x-title': 'DevOne',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
        },
        body: upstreamBody(options.body, target.model),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      const message = options.signal?.aborted
        ? 'Client disconnected'
        : controller.signal.aborted
          ? `No answer within ${Math.round(timeoutMs / 1000)} s`
          : error instanceof Error
            ? error.message
            : 'Could not reach the provider';
      last = { status: 0, error: message };
      await options.onFailure?.({ target, status: 0, error: message, retryAfter: null });
      continue;
    }
    clearTimeout(timer);

    if (!response.ok) {
      options.signal?.removeEventListener('abort', abort);
      const error = await readError(response);
      last = { status: response.status, error };
      if (shouldFallBack(response.status)) {
        await options.onFailure?.({
          target,
          status: response.status,
          error,
          retryAfter: response.headers.get('retry-after')
        });
        continue;
      }
      finish({ target, status: response.status, attempts, usage: NO_USAGE, error });
      return Response.json(
        { error: { message: error, type: 'upstream_error', code: response.status } },
        { status: response.status, headers: answerHeaders(response, target, attempts) }
      );
    }

    const headers = answerHeaders(response, target, attempts);
    const streamed = (headers.get('content-type') ?? '').includes('text/event-stream');
    if (streamed && response.body) {
      const body = relayStream(response.body, (usage, error) => {
        options.signal?.removeEventListener('abort', abort);
        finish({ target, status: response.status, attempts, usage, error });
      });
      return new Response(body, { status: response.status, headers });
    }

    const text = await response.text();
    options.signal?.removeEventListener('abort', abort);
    finish({ target, status: response.status, attempts, usage: usageFromJson(text), error: null });
    return new Response(text, { status: response.status, headers });
  }

  const status = last && last.status >= 400 ? last.status : 502;
  const message = last
    ? `Every provider failed. Last error: ${last.error}`
    : 'The request was cancelled';
  finish({ target: null, status, attempts, usage: NO_USAGE, error: message });
  return routerError(status, message, 'all_providers_failed');
}
