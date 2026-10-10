import { providerUrl, type RouteTarget } from './routing';
import { translateRequest, ProtocolError, object, type JsonObject } from './translation';
import type { ProviderCredential, ProviderFormat } from './types';
import { prepareOpenCodeRequest } from './opencode-free';

// Matches 9Router's CLAUDE_SYSTEM_PROMPT for its Claude Code OAuth transport.
const CLAUDE_OAUTH_SYSTEM_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";

export interface ExecuteOptions {
  body: Record<string, unknown>;
  sourceFormat?: ProviderFormat;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  validateUrl?: (url: string) => Promise<void>;
}
export interface UpstreamExecution {
  response: Response;
  format: ProviderFormat;
  read: () => Promise<ReadableStreamReadResult<Uint8Array>>;
  close: () => void;
  cancel: () => void;
  restore?: (body: JsonObject) => JsonObject;
  finishRestore?: () => JsonObject | null;
}
/** One account, one request. A deadline covers fetch and JSON; streams get an idle deadline after their first byte. */
export async function executeTarget(
  options: ExecuteOptions,
  target: RouteTarget,
  credential: ProviderCredential | null
): Promise<UpstreamExecution> {
  const provider = target.provider,
    format = provider.format ?? 'openai';
  const tokenAuth = credential?.authType === 'oauth' || credential?.authType === 'access_token';
  let body = translateRequest(options.body, options.sourceFormat ?? 'openai', format, target.model);
  if (provider.providerType === 'claude' && format === 'claude' && tokenAuth) {
    if (body.system !== undefined && typeof body.system !== 'string' && !Array.isArray(body.system))
      throw new ProtocolError('Expected Claude system instructions');
    const system =
      typeof body.system === 'string'
        ? [{ type: 'text', text: body.system }]
        : ((body.system as unknown[] | undefined)?.map((block) => object(block, 'system block')) ??
          []);
    body.system = system.some(
      (block) => block.type === 'text' && block.text === CLAUDE_OAUTH_SYSTEM_PROMPT
    )
      ? system
      : [{ type: 'text', text: CLAUDE_OAUTH_SYSTEM_PROMPT }, ...system];
  }
  let openCode: ReturnType<typeof prepareOpenCodeRequest> | undefined;
  if (provider.providerType === 'opencode') {
    if (format !== 'openai') throw new ProtocolError('OpenCode Free requires the Chat format', 503);
    openCode = prepareOpenCodeRequest(body, target.connectionId ?? provider.id);
    body = openCode.body;
  }
  if (provider.providerType === 'codex') {
    if (format !== 'openai-responses')
      throw new ProtocolError('Codex requires the Responses format', 503);
    for (const key of ['temperature', 'top_p', 'max_output_tokens']) {
      if (body[key] !== undefined) throw new ProtocolError(`Unsupported Codex field: ${key}`);
    }
    if (body.store !== undefined && body.store !== false)
      throw new ProtocolError('Unsupported Codex stored responses');
    for (const rawTool of Array.isArray(body.tools) ? body.tools : []) {
      if (object(rawTool).type !== 'function')
        throw new ProtocolError('Unsupported Codex hosted tool');
    }
    if (body.tools !== undefined && !Array.isArray(body.tools))
      throw new ProtocolError('Expected tools');
    body.store = false;
    body.stream = true;
    if (body.instructions === undefined) body.instructions = 'You are a helpful assistant.';
    if (typeof body.instructions !== 'string') throw new ProtocolError('Expected instructions');
    const input =
      typeof body.input === 'string'
        ? [{ role: 'user', content: [{ type: 'input_text', text: body.input }] }]
        : body.input;
    if (!Array.isArray(input)) throw new ProtocolError('Expected Codex input');
    body.input = input.map((raw) => {
      const item = object(raw);
      return item.role === 'system' ? { ...item, role: 'developer' } : item;
    });
  }
  if (provider.forceStream) body.stream = true;
  if (body.stream === true && format === 'openai' && body.stream_options === undefined)
    body.stream_options = { include_usage: true };
  const path =
    provider.upstreamPath ??
    (format === 'claude'
      ? 'messages'
      : format === 'openai-responses'
        ? 'responses'
        : 'chat/completions');
  const url = providerUrl(provider.baseUrl, path);
  await options.validateUrl?.(url);
  const headers = new Headers({
    ...provider.headers,
    'content-type': 'application/json',
    accept: body.stream ? 'text/event-stream' : 'application/json'
  });
  for (const [name, value] of Object.entries(openCode?.headers ?? {})) headers.set(name, value);
  if (format === 'claude' && !headers.has('anthropic-version'))
    headers.set('anthropic-version', '2023-06-01');
  if (
    format === 'claude' &&
    tokenAuth &&
    (provider.providerType === 'claude' || provider.providerType === 'anthropic')
  ) {
    const beta = 'oauth-2025-04-20';
    if (
      !headers
        .get('anthropic-beta')
        ?.split(',')
        .map((value) => value.trim())
        .includes(beta)
    )
      headers.append('anthropic-beta', beta);
  }
  const secret =
    credential?.authType === 'none'
      ? null
      : tokenAuth
        ? credential?.accessToken
        : credential?.apiKey;
  const nativeClaudeKey =
    !tokenAuth &&
    format === 'claude' &&
    (provider.providerType === 'claude' || provider.providerType === 'anthropic');
  if (secret) {
    const header = tokenAuth
      ? 'authorization'
      : nativeClaudeKey
        ? 'x-api-key'
        : (provider.authHeader ?? (format === 'claude' ? 'x-api-key' : 'authorization'));
    const scheme = tokenAuth
      ? 'bearer'
      : nativeClaudeKey
        ? 'raw'
        : (provider.authScheme ?? (format === 'claude' ? 'raw' : 'bearer'));
    headers.set(header, scheme === 'bearer' ? `Bearer ${secret}` : secret);
  }
  if (provider.providerType === 'codex') {
    const account =
      credential?.providerSpecificData?.chatgptAccountId ??
      credential?.providerSpecificData?.accountId;
    if (typeof account === 'string' && account) {
      if (/[\r\n]/.test(account)) throw new ProtocolError('Invalid Codex account metadata', 401);
      headers.set('ChatGPT-Account-ID', account);
    }
  }
  const controller = new AbortController(),
    timeoutMs = options.timeoutMs ?? 60_000;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout>;
  let timedOut = false,
    closed = false;
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  // Attach immediately so abort during URL/header setup or before a race cannot be unhandled.
  void aborted.catch(() => undefined);
  const abort = () => {
    rejectAbort(
      new ProtocolError(
        timedOut ? 'Upstream answer timed out' : 'Client disconnected',
        timedOut ? 504 : 499
      )
    );
    controller.abort();
    void reader?.cancel().catch(() => undefined);
  };
  const startTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, timeoutMs);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  startTimer();
  if (options.signal?.aborted) abort();
  try {
    const response = await Promise.race([
      (options.fetchImpl ?? fetch)(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error'
      }),
      aborted
    ]);
    reader = response.body?.getReader();
    const streamed = (response.headers.get('content-type') ?? '').includes('text/event-stream');
    let firstByte = false;
    return {
      response,
      format,
      restore: openCode?.restore,
      finishRestore: openCode?.finishRestore,
      async read() {
        if (!reader) {
          close();
          return { done: true, value: undefined };
        }
        if (streamed && firstByte) startTimer();
        const result = await Promise.race([reader.read(), aborted]);
        if (result.done) close();
        else if (result.value.length) {
          firstByte = true;
          if (streamed) clearTimeout(timer);
        }
        return result;
      },
      close,
      cancel() {
        abort();
        close();
      }
    };
  } catch (error) {
    abort();
    close();
    throw error;
  }
}
