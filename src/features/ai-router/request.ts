import {
  findCallerByKey,
  loadRouterSettings,
  loadRouterState,
  recordProviderFailure,
  recordUsage,
  type RouterCaller
} from '@/features/ai-router/service';
import {
  anthropicError,
  anthropicToOpenAI,
  errorMessage,
  estimateTokens,
  openAIToAnthropic,
  translateStream
} from '@/lib/ai-router/anthropic';
import { compressToolMessages } from '@/lib/ai-router/compress';
import { forwardChatCompletion, routerError } from '@/lib/ai-router/forward';
import { readAiApiKey } from '@/lib/ai-router/keys';
import { aiRateLimit, createRateLimiter } from '@/lib/ai-router/rate-limit';
import { listModelIds, resolveTargets } from '@/lib/ai-router/routing';
import { getCurrentUser } from '@/lib/auth/session';
import { DEMO_DISABLED_MESSAGE, isDemoMode } from '@/lib/demo';
import { isSameOrigin } from '@/lib/http/same-origin';

const limiter = createRateLimiter(aiRateLimit());

/**
 * Who is calling: a personal key (tools such as OpenCode, Cursor or curl), or
 * a signed-in browser on DevOne itself. Browsers must be same-origin, so
 * other sites cannot spend someone's quota with their cookie.
 */
async function authenticate(request: Request): Promise<RouterCaller | Response> {
  const key = readAiApiKey(request.headers);
  if (key) {
    const caller = await findCallerByKey(key);
    return caller ?? routerError(401, 'Invalid API key', 'invalid_api_key');
  }
  if (request.method !== 'GET' && !isSameOrigin(request)) {
    return routerError(
      401,
      'Send a DevOne AI key as "Authorization: Bearer dvo_…"',
      'missing_api_key'
    );
  }
  const user = await getCurrentUser();
  return user
    ? { userId: user.id, apiKeyId: null }
    : routerError(401, 'Send a DevOne AI key as "Authorization: Bearer dvo_…"', 'missing_api_key');
}

export async function handleModels(request: Request): Promise<Response> {
  if (isDemoMode()) return routerError(403, DEMO_DISABLED_MESSAGE, 'demo_mode');
  const caller = await authenticate(request);
  if (caller instanceof Response) return caller;
  const { providers, combos } = await loadRouterState();
  const created = Math.floor(Date.now() / 1000);
  return Response.json({
    object: 'list',
    data: listModelIds(providers, combos).map((id) => ({
      id,
      object: 'model',
      created,
      owned_by: 'devone'
    }))
  });
}

interface Prepared {
  caller: RouterCaller;
  body: Record<string, unknown>;
  state: Awaited<ReturnType<typeof loadRouterState>>;
}

/** Checks, in order: demo mode, who is calling, the rate limit, the JSON body and the providers. */
async function prepare(
  request: Request,
  fail: (status: number, message: string, code: string) => Response
): Promise<Prepared | Response> {
  if (isDemoMode()) return fail(403, DEMO_DISABLED_MESSAGE, 'demo_mode');
  const caller = await authenticate(request);
  if (caller instanceof Response) return caller;
  if (!limiter.take(caller.userId)) {
    return fail(429, 'Too many requests. Wait a minute and try again.', 'rate_limited');
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(400, 'The body must be a JSON object', 'invalid_request');
  }
  if (typeof body.model !== 'string' || !body.model.trim()) {
    return fail(400, 'Say which "model" to use', 'invalid_request');
  }
  if (!Array.isArray(body.messages)) {
    return fail(400, '"messages" must be an array', 'invalid_request');
  }
  const state = await loadRouterState();
  if (!state.providers.some((provider) => provider.enabled)) {
    return fail(
      503,
      'No AI providers are set up. An administrator adds them under Admin → AI router.',
      'no_providers'
    );
  }
  return { caller, body, state };
}

/**
 * Where a request for `requested` goes. A name nothing serves (Claude Code
 * asking for "claude-sonnet-…") goes to the administrator's default model.
 */
function targetsFor(requested: string, state: Prepared['state'], defaultModel: string | null) {
  const targets = resolveTargets(requested, state.providers, state.combos);
  if (targets.length > 0 || !defaultModel) return targets;
  return resolveTargets(defaultModel, state.providers, state.combos);
}

const tokenSaverOff = (request: Request) =>
  request.headers.get('x-devone-token-saver')?.trim().toLowerCase() === 'off';

async function run(
  request: Request,
  prepared: Prepared,
  chatBody: Record<string, unknown>,
  requested: string
): Promise<Response> {
  const settings = await loadRouterSettings();
  let savedChars = 0;
  if (settings.compressToolOutput && !tokenSaverOff(request) && Array.isArray(chatBody.messages)) {
    const compressed = compressToolMessages(chatBody.messages, settings.maxToolOutputChars);
    chatBody = { ...chatBody, messages: compressed.messages };
    savedChars = compressed.savedChars;
  }
  const startedAt = Date.now();
  return forwardChatCompletion({
    body: chatBody,
    targets: targetsFor(requested, prepared.state, settings.defaultModel),
    apiKeyFor: prepared.state.apiKeyFor,
    signal: request.signal,
    onFailure: recordProviderFailure,
    onFinish: (outcome) => recordUsage(prepared.caller, requested, startedAt, outcome, savedChars)
  });
}

export async function handleChatCompletion(request: Request): Promise<Response> {
  const prepared = await prepare(request, routerError);
  if (prepared instanceof Response) return prepared;
  return run(request, prepared, prepared.body, (prepared.body.model as string).trim());
}

const anthropicFail = (status: number, message: string) =>
  Response.json(anthropicError(status, message), { status });

/** Anthropic Messages (Claude Code): translated to a chat completion and back. */
export async function handleMessages(request: Request): Promise<Response> {
  const prepared = await prepare(request, (status, message) => anthropicFail(status, message));
  if (prepared instanceof Response) return prepared;
  const requested = (prepared.body.model as string).trim();
  const upstream = await run(request, prepared, anthropicToOpenAI(prepared.body), requested);
  const headers = new Headers();
  for (const name of ['x-devone-provider', 'x-devone-model', 'x-devone-attempts']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => null)) as unknown;
    return Response.json(
      anthropicError(upstream.status, errorMessage(body, upstream.statusText || 'Request failed')),
      { status: upstream.status, headers }
    );
  }
  if ((upstream.headers.get('content-type') ?? '').includes('text/event-stream') && upstream.body) {
    headers.set('content-type', 'text/event-stream');
    headers.set('cache-control', 'no-cache, no-transform');
    headers.set('x-accel-buffering', 'no');
    return new Response(translateStream(upstream.body, requested), { headers });
  }
  const completion = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;
  if (!completion) return anthropicFail(502, 'The provider sent an unreadable answer');
  return Response.json(openAIToAnthropic(completion, requested), { headers });
}

/** Claude Code asks for a token count before some requests; an estimate is enough. */
export async function handleCountTokens(request: Request): Promise<Response> {
  if (isDemoMode()) return anthropicFail(403, DEMO_DISABLED_MESSAGE);
  const caller = await authenticate(request);
  if (caller instanceof Response) return caller;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object')
    return anthropicFail(400, 'The body must be a JSON object');
  return Response.json({ input_tokens: estimateTokens(body) });
}
