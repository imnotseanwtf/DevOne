import {
  findCallerByKey,
  loadRouterState,
  recordProviderFailure,
  recordUsage,
  type RouterCaller
} from '@/features/ai-router/service';
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

export async function handleChatCompletion(request: Request): Promise<Response> {
  if (isDemoMode()) return routerError(403, DEMO_DISABLED_MESSAGE, 'demo_mode');
  const caller = await authenticate(request);
  if (caller instanceof Response) return caller;
  if (!limiter.take(caller.userId)) {
    return routerError(429, 'Too many requests. Wait a minute and try again.', 'rate_limited');
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return routerError(400, 'The body must be a JSON object', 'invalid_request');
  }
  if (typeof body.model !== 'string' || !body.model.trim()) {
    return routerError(400, 'Say which "model" to use', 'invalid_request');
  }
  if (!Array.isArray(body.messages)) {
    return routerError(400, '"messages" must be an array', 'invalid_request');
  }

  const requested = body.model.trim();
  const state = await loadRouterState();
  if (!state.providers.some((provider) => provider.enabled)) {
    return routerError(
      503,
      'No AI providers are set up. An administrator adds them under Admin → AI router.',
      'no_providers'
    );
  }
  const startedAt = Date.now();
  return forwardChatCompletion({
    body,
    targets: resolveTargets(requested, state.providers, state.combos),
    apiKeyFor: state.apiKeyFor,
    signal: request.signal,
    onFailure: recordProviderFailure,
    onFinish: (outcome) => recordUsage(caller, requested, startedAt, outcome)
  });
}
