import {
  explainProviderError,
  shouldFallBack,
  usageFromJson,
  type RouteTarget,
  type TokenUsage
} from './routing';
import type { ProviderCredential, ProviderFormat } from './types';
import { executeTarget, type UpstreamExecution } from './executors';
import {
  ProtocolError,
  translateResponse,
  normalizedUsage,
  object,
  type JsonObject
} from './translation';
import {
  SseReader,
  ChatStreamTranslator,
  ClientStreamTranslator,
  ChatAccumulator,
  upstreamError,
  hasOutput
} from './streaming';

export interface AttemptFailure {
  target: RouteTarget;
  status: number;
  error: string;
  retryAfter: string | null;
}
export interface ForwardOutcome {
  target: RouteTarget | null;
  status: number;
  attempts: number;
  usage: TokenUsage;
  error: string | null;
}
export interface ForwardOptions {
  body: Record<string, unknown>;
  targets: RouteTarget[];
  apiKeyFor: (providerId: string) => string | null;
  credentialFor?: (target: RouteTarget) => Promise<ProviderCredential | null>;
  refreshCredential?: (
    target: RouteTarget,
    failedAccessToken?: string | null
  ) => Promise<ProviderCredential | null>;
  validateUrl?: (url: string) => Promise<void>;
  sourceFormat?: ProviderFormat;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  onFailure?: (failure: AttemptFailure) => void | Promise<void>;
  onFinish?: (outcome: ForwardOutcome) => void | Promise<void>;
}
const NO_USAGE: TokenUsage = { promptTokens: null, completionTokens: null };
export function routerError(status: number, message: string, code: string): Response {
  return Response.json({ error: { message, type: 'devone_router_error', code } }, { status });
}
function usageOf(usage: JsonObject | undefined): TokenUsage {
  return {
    promptTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : null,
    completionTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : null
  };
}
function headersFor(target: RouteTarget, attempts: number, streaming: boolean): Headers {
  const headers = new Headers({
    'content-type': streaming ? 'text/event-stream' : 'application/json',
    'x-devone-provider': target.provider.name,
    'x-devone-model': target.model,
    'x-devone-attempts': String(attempts)
  });
  if (streaming) {
    headers.set('cache-control', 'no-cache, no-transform');
    headers.set('x-accel-buffering', 'no');
  }
  return headers;
}
async function readText(execution: UpstreamExecution): Promise<string> {
  const decoder = new TextDecoder();
  let text = '',
    bytes = 0;
  while (true) {
    const next = await execution.read();
    if (next.done) return text + decoder.decode();
    bytes += next.value.byteLength;
    if (bytes > 16 * 1024 * 1024) throw new ProtocolError('Upstream answer too large', 502);
    text += decoder.decode(next.value, { stream: true });
  }
}
function safeError(error: unknown, secrets: string[]): string {
  let text = error instanceof ProtocolError ? error.message : 'Could not reach the provider';
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
  return text.slice(0, 500);
}
function httpError(text: string, status: number): ProtocolError {
  try {
    const body = object(JSON.parse(text)),
      error = upstreamError(body);
    if (error) return new ProtocolError(error.message, status);
  } catch {
    /* A provider may return plain text. */
  }
  return new ProtocolError(text || `HTTP ${status}`, status);
}
/** Fallback and credential refresh stay here; each executor handles just one account. */
export async function forwardChatCompletion(options: ForwardOptions): Promise<Response> {
  const source = options.sourceFormat ?? 'openai';
  let attempts = 0,
    finished = false;
  const secrets: string[] = [];
  const finish = async (
    target: RouteTarget | null,
    status: number,
    usage: TokenUsage,
    error: string | null
  ) => {
    if (finished) return;
    finished = true;
    await Promise.resolve(options.onFinish?.({ target, status, attempts, usage, error })).catch(
      () => undefined
    );
  };
  const failure = async (
    target: RouteTarget,
    status: number,
    error: string,
    retryAfter: string | null
  ) => {
    await Promise.resolve(options.onFailure?.({ target, status, error, retryAfter })).catch(
      () => undefined
    );
  };
  if (!options.targets.length) {
    const message = `No enabled provider serves the model "${String(options.body.model ?? '')}"`;
    await finish(null, 404, NO_USAGE, message);
    return routerError(404, message, 'model_not_found');
  }
  let last: { status: number; error: string } | null = null;
  const tried = new Set<string>(),
    refreshedAccounts = new Set<string>(),
    failedAccounts = new Set<string>();
  const overrides = new Map<string, ProviderCredential>();
  const candidates = [...options.targets];
  for (let targetIndex = 0; targetIndex < candidates.length; targetIndex++) {
    const target = candidates[targetIndex];
    if (options.signal?.aborted) break;
    const accountId = `${target.provider.id}:${target.connectionId ?? 'legacy'}`;
    const account = `${accountId}:${target.model}`;
    if (failedAccounts.has(accountId)) continue;
    if (tried.has(account)) continue;
    tried.add(account);
    let credential: ProviderCredential | null = null,
      execution: UpstreamExecution | undefined,
      retryAfter: string | null = null;
    try {
      credential =
        overrides.get(account) ??
        (options.credentialFor
          ? await options.credentialFor(target)
          : {
              id: target.connectionId ?? target.provider.id,
              providerId: target.provider.id,
              authType: target.provider.authType ?? 'api_key',
              apiKey: options.apiKeyFor(target.provider.id)
            });
      if (options.credentialFor && !credential)
        throw new ProtocolError('Account credential unavailable', 401);
      for (let retry = 0; retry < 2; retry++) {
        if (credential)
          for (const key of [
            credential.apiKey,
            credential.accessToken,
            credential.refreshToken,
            credential.idToken
          ])
            if (key) secrets.push(key);
        attempts++;
        execution = await executeTarget(options, target, credential);
        retryAfter = execution.response.headers.get('retry-after');
        if (
          (execution.response.status === 401 || execution.response.status === 403) &&
          retry === 0 &&
          !refreshedAccounts.has(account) &&
          options.refreshCredential &&
          (credential?.authType === 'oauth' || credential?.authType === 'access_token')
        ) {
          const rejected = httpError(await readText(execution), execution.response.status);
          execution.cancel();
          refreshedAccounts.add(account);
          let refreshed: ProviderCredential | null = null;
          try {
            refreshed = await options.refreshCredential(target, credential.accessToken);
          } catch {
            /* Try the next account when refresh fails. */
          }
          if (refreshed) {
            credential = refreshed;
            continue;
          }
          throw rejected;
        }
        break;
      }
      if (!execution) throw new ProtocolError('Could not execute request', 502);
      if (!execution.response.ok)
        throw httpError(await readText(execution), execution.response.status);
      if (!execution.streamed) {
        const text = await readText(execution);
        let body: JsonObject;
        try {
          body = object(JSON.parse(text));
        } catch {
          throw new ProtocolError('Malformed upstream JSON response', 502);
        }
        body = execution.restore?.(body) ?? body;
        const error = upstreamError(body);
        if (error) throw error;
        const chat =
          execution.format === source
            ? { usage: normalizedUsage(body.usage) }
            : translateResponse(body, execution.format, 'openai');
        const answer = translateResponse(body, execution.format, source);
        execution.close();
        await finish(target, execution.response.status, usageFromJson(JSON.stringify(chat)), null);
        return Response.json(answer, {
          status: execution.response.status,
          headers: headersFor(target, attempts, false)
        });
      }
      const nativePassthrough =
        options.body.stream === true && execution.format === source && source !== 'openai';
      const iterator = new SseReader(execution).events()[Symbol.asyncIterator](),
        normalizer = new ChatStreamTranslator(execution.format, nativePassthrough);
      const pending: (JsonObject | 'DONE')[] = [];
      let ended = false,
        buffered = 0;
      // Read ahead until actual answer content, a terminal frame, or an error. Role/usage metadata cannot commit an error response.
      while (!pending.some(hasOutput)) {
        const frame = await iterator.next();
        if (frame.done) {
          if (!normalizer.ended)
            throw new ProtocolError('Upstream stream ended before completion', 502);
          break;
        }
        const values = normalizer.accept(frame.value);
        pending.push(...values);
        buffered += frame.value.data.length;
        if (buffered > 1024 * 1024)
          throw new ProtocolError('Upstream stream did not produce answer content', 502);
        if (values.includes('DONE')) {
          ended = true;
          break;
        }
      }
      if (options.body.stream !== true) {
        const accumulated = new ChatAccumulator();
        for (const value of pending) if (value !== 'DONE') accumulated.accept(value);
        while (!ended) {
          const frame = await iterator.next();
          if (frame.done) {
            if (!normalizer.ended)
              throw new ProtocolError('Upstream stream ended before completion', 502);
            break;
          }
          for (const value of normalizer.accept(frame.value)) {
            if (value === 'DONE') ended = true;
            else accumulated.accept(value);
          }
        }
        execution.cancel();
        const answer = translateResponse(accumulated.answer(), 'openai', source);
        await finish(target, 200, usageOf(normalizer.usage), null);
        return Response.json(answer, { headers: headersFor(target, attempts, false) });
      }
      const upstream = execution,
        client = new ClientStreamTranslator(source, nativePassthrough);
      const queue: Uint8Array[] = [];
      let doneSent = false,
        done = false;
      const enqueue = (values: (JsonObject | 'DONE')[]) => {
        for (const value of values) {
          if (doneSent) break;
          queue.push(...client.accept(value));
          if (value === 'DONE') doneSent = true;
        }
      };
      enqueue(pending);
      const output = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              while (!queue.length) {
                if (doneSent) break;
                const frame = await iterator.next();
                if (frame.done) {
                  if (!normalizer.ended)
                    throw new ProtocolError('Upstream stream ended before completion', 502);
                  enqueue(['DONE']);
                  break;
                }
                enqueue(normalizer.accept(frame.value));
              }
              if (queue.length) {
                controller.enqueue(queue.shift()!);
                return;
              }
              if (!done) {
                done = true;
                upstream.cancel();
                await finish(target, 200, usageOf(normalizer.usage), null);
                controller.close();
              }
            } catch (error) {
              if (done) return;
              done = true;
              const message = safeError(error, secrets),
                status = error instanceof ProtocolError ? error.status : 502;
              upstream.cancel();
              if (status !== 499) await failure(target, status, message, retryAfter);
              await finish(target, status, usageOf(normalizer.usage), message);
              for (const bytes of client.error(message)) controller.enqueue(bytes);
              controller.close();
            }
          },
          async cancel() {
            if (done) return;
            done = true;
            upstream.cancel();
            await finish(target, 499, usageOf(normalizer.usage), 'Client disconnected');
          }
        },
        { highWaterMark: 0 }
      );
      return new Response(output, { headers: headersFor(target, attempts, true) });
    } catch (error) {
      execution?.cancel();
      const status = error instanceof ProtocolError ? error.status : 0,
        message = safeError(error, secrets);
      last = { status, error: message };
      if (options.signal?.aborted || status === 499) break;
      if (
        (status === 401 || status === 403) &&
        !refreshedAccounts.has(account) &&
        options.refreshCredential &&
        (credential?.authType === 'oauth' || credential?.authType === 'access_token')
      ) {
        refreshedAccounts.add(account);
        let refreshed: ProviderCredential | null = null;
        try {
          refreshed = await options.refreshCredential(target, credential.accessToken);
        } catch {
          /* Try the next account when refresh fails. */
        }
        if (refreshed) {
          overrides.set(account, refreshed);
          tried.delete(account);
          candidates.splice(targetIndex + 1, 0, target);
          continue;
        }
      }
      if (status === 0 || shouldFallBack(status)) {
        if (status !== 404) failedAccounts.add(accountId);
        await failure(target, status, message, retryAfter);
        continue;
      }
      await finish(target, status, NO_USAGE, message);
      return Response.json(
        { error: { message, type: 'upstream_error', code: status } },
        { status, headers: headersFor(target, attempts, false) }
      );
    }
  }
  const status = options.signal?.aborted ? 499 : last && last.status >= 400 ? last.status : 502;
  const message = options.signal?.aborted
    ? 'Client disconnected'
    : last
      ? `Every provider failed. Last error: ${explainProviderError(last.error)}`
      : 'The request was cancelled';
  await finish(null, status, NO_USAGE, message);
  return routerError(status, message, 'all_providers_failed');
}
