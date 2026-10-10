import {
  findCallerByKey,
  loadRouterState,
  recordProviderFailure,
  recordUsage,
  gatewayFetch,
  requireAiAdmin,
  type RouterCaller
} from '@/features/ai-router/service';
import { forwardChatCompletion, routerError, type ForwardOutcome } from '@/lib/ai-router/forward';
import { readAiApiKey } from '@/lib/ai-router/keys';
import { aiRateLimit, createRateLimiter } from '@/lib/ai-router/rate-limit';
import { listModelIds, resolveTargets } from '@/lib/ai-router/routing';
import { getCurrentUser } from '@/lib/auth/session';
import { DEMO_DISABLED_MESSAGE, isDemoMode } from '@/lib/demo';
import { isSameOrigin } from '@/lib/http/same-origin';
import {
  compressToolMessages,
  GatewayRequestError,
  readGatewayBody
} from '@/lib/ai-router/security';
import type { ProviderFormat } from '@/lib/ai-router/types';
import { after } from 'next/server';
import { connectionTestSchema } from './schema';

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
  if (request.headers.has('authorization') || request.headers.has('x-api-key')) {
    return routerError(401, 'Invalid gateway API key', 'invalid_api_key');
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

export async function handleChatCompletion(
  request: Request,
  sourceFormat: ProviderFormat = 'openai',
  connectionId?: string
): Promise<Response> {
  if (isDemoMode()) return routerError(403, DEMO_DISABLED_MESSAGE, 'demo_mode');
  const caller = await authenticate(request);
  if (caller instanceof Response) return caller;
  if (connectionId) {
    try {
      await requireAiAdmin(caller.userId);
    } catch {
      return routerError(403, 'Administrators only', 'forbidden');
    }
  }
  if (!limiter.take(caller.userId)) {
    return routerError(429, 'Too many requests. Wait a minute and try again.', 'rate_limited');
  }

  let body: Record<string, unknown>;
  try {
    body = await readGatewayBody(request);
  } catch (error) {
    return routerError(
      error instanceof GatewayRequestError ? error.status : 400,
      error instanceof Error ? error.message : 'Invalid request',
      'invalid_request'
    );
  }
  if (connectionId) {
    const parsed = connectionTestSchema.safeParse(body);
    if (!parsed.success)
      return routerError(
        400,
        'Choose a model and send up to 24 text messages, each at most 8000 characters.',
        'invalid_request'
      );
    body = { ...parsed.data, stream: false };
  }
  if (typeof body.model !== 'string' || !body.model.trim()) {
    return routerError(400, 'Say which "model" to use', 'invalid_request');
  }
  // Validate the envelope here; the executor validates translation for each target format.
  // Native options (for example encrypted reasoning) must survive native routing.
  const conversation = sourceFormat === 'openai-responses' ? body.input : body.messages;
  if (
    !(Array.isArray(conversation) && conversation.length) &&
    !(
      sourceFormat === 'openai-responses' &&
      typeof conversation === 'string' &&
      conversation.trim()
    )
  ) {
    return routerError(400, 'A nonempty conversation is required', 'invalid_request');
  }

  const requested = body.model.trim();
  const state = await loadRouterState();
  if (!state.providers.some((provider) => provider.enabled)) {
    return routerError(
      503,
      'No AI providers are set up. An administrator adds them under Router → Providers.',
      'no_providers'
    );
  }
  let selectedModel = requested;
  // Diagnostics use a raw model ID and the explicit account ID, independent of global model namespaces.
  let targets = connectionId
    ? state.providers
        .filter((provider) => provider.enabled && provider.models.includes(requested))
        .map((provider) => ({ provider, model: requested }))
    : resolveTargets(selectedModel, state.providers, state.combos);
  const configured = connectionId
    ? state.providers.some((provider) => provider.models.includes(requested))
    : state.combos.some((combo) => combo.name === requested) ||
      resolveTargets(
        requested,
        state.providers.map((provider) => ({ ...provider, enabled: true })),
        state.combos
      ).length > 0;
  if (connectionId && !configured) {
    return routerError(400, 'Choose a model configured for this provider.', 'invalid_model');
  }
  // Model defaults apply only to unknown models, never override a known exhausted account.
  if (
    !connectionId &&
    !targets.length &&
    !configured &&
    state.settings.defaultModel &&
    selectedModel !== state.settings.defaultModel
  ) {
    selectedModel = state.settings.defaultModel;
    targets = resolveTargets(selectedModel, state.providers, state.combos);
  }
  const compressed =
    state.settings.compressToolOutput && request.headers.get('x-devone-token-saver') !== 'off'
      ? compressToolMessages(body, state.settings.maxToolOutputChars)
      : { body, savedChars: 0 };
  body = { ...compressed.body, model: selectedModel };
  const accountTargets = state
    .targetsFor(targets)
    .filter((target) => !connectionId || target.connectionId === connectionId);
  if (connectionId && !accountTargets.length)
    return routerError(
      503,
      'This account is unavailable for the selected model. Enable the provider and account, or clear its cooldown before retrying.',
      'account_unavailable'
    );
  // Codex rejects token-limit fields; its diagnostic still has the normal response-size bound and a deadline.
  if (connectionId && accountTargets[0].provider.providerType !== 'codex') body.max_tokens = 512;
  const startedAt = Date.now();
  let complete!: (outcome: ForwardOutcome) => void;
  const finished = new Promise<ForwardOutcome>((resolve) => {
    complete = resolve;
  });
  // Register while the route's request scope is active; the outcome resolves at stream completion.
  after(async () =>
    recordUsage(caller, requested, startedAt, await finished, compressed.savedChars)
  );
  const deadline = connectionId ? AbortSignal.timeout(30_000) : undefined;
  const timedOut = () => Boolean(deadline?.aborted && !request.signal.aborted);
  const response = await forwardChatCompletion({
    body,
    targets: accountTargets,
    apiKeyFor: state.apiKeyFor,
    signal: deadline ? AbortSignal.any([request.signal, deadline]) : request.signal,
    sourceFormat,
    credentialFor: state.credentialFor,
    refreshCredential: state.refreshCredential,
    fetchImpl: gatewayFetch,
    timeoutMs: connectionId ? 30_000 : undefined,
    onFailure: recordProviderFailure,
    onFinish: (outcome) =>
      complete(
        timedOut() ? { ...outcome, status: 504, error: 'Connection test timed out' } : outcome
      )
  });
  return timedOut()
    ? routerError(504, 'Connection test timed out after 30 seconds.', 'test_timeout')
    : response;
}
