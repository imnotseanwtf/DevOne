/**
 * How the AI router picks where a request goes, and when it moves on. Pure
 * functions, so they are checked without a database or network.
 */

export interface RouterProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  priority: number;
  enabled: boolean;
  cooldownUntil: Date | null;
}

// A type, not an interface, so a list of steps can be stored as Prisma JSON.
export type ComboStep = {
  providerId: string;
  model: string;
};

export interface RouterCombo {
  name: string;
  steps: ComboStep[];
}

export interface RouteTarget {
  provider: RouterProvider;
  model: string;
}

/** Asking for this model tries every enabled provider's first model, by priority. */
export const AUTO_MODEL = 'auto';

const byPriority = (a: RouterProvider, b: RouterProvider) =>
  a.priority - b.priority || a.name.localeCompare(b.name);

/** "OpenRouter/x/y" names a model on one provider; provider names match in any case. */
function splitProviderModel(requested: string, providers: RouterProvider[]) {
  const slash = requested.indexOf('/');
  if (slash <= 0) return null;
  const prefix = requested.slice(0, slash).toLowerCase();
  const provider = providers.find((candidate) => candidate.name.toLowerCase() === prefix);
  return provider ? { provider, model: requested.slice(slash + 1) } : null;
}

/**
 * The provider models to try for a requested model, first choice first:
 * a combo's steps, a "Provider/model" name, every provider serving the model,
 * or for "auto" each provider's first model. Disabled providers are left out;
 * ones cooling down after a failure go last, still tried when nothing else
 * answers.
 */
export function resolveTargets(
  requested: string,
  providers: RouterProvider[],
  combos: RouterCombo[],
  now = new Date()
): RouteTarget[] {
  const enabled = providers.filter((provider) => provider.enabled).toSorted(byPriority);
  let targets: RouteTarget[];

  const combo = combos.find((candidate) => candidate.name === requested);
  if (combo) {
    targets = combo.steps.flatMap((step) => {
      const provider = enabled.find((candidate) => candidate.id === step.providerId);
      return provider ? [{ provider, model: step.model }] : [];
    });
  } else if (requested === AUTO_MODEL) {
    targets = enabled.flatMap((provider) =>
      provider.models[0] ? [{ provider, model: provider.models[0] }] : []
    );
  } else {
    const named = splitProviderModel(requested, enabled);
    const serving = enabled
      .filter((provider) => provider.models.includes(requested))
      .map((provider) => ({ provider, model: requested }));
    // "OpenRouter/x" is the named provider's x, unless some provider serves a model literally called that.
    targets = serving.length > 0 || !named ? serving : [named];
  }

  const cooling = (target: RouteTarget) =>
    target.provider.cooldownUntil !== null && target.provider.cooldownUntil > now;
  return [...targets.filter((t) => !cooling(t)), ...targets.filter(cooling)];
}

/** The model names a client can ask for, for `GET /models`. */
export function listModelIds(providers: RouterProvider[], combos: RouterCombo[]): string[] {
  const enabled = providers.filter((provider) => provider.enabled).toSorted(byPriority);
  const ids = new Set<string>();
  if (enabled.some((provider) => provider.models.length > 0)) ids.add(AUTO_MODEL);
  for (const combo of combos) ids.add(combo.name);
  for (const provider of enabled) {
    for (const model of provider.models) {
      ids.add(model);
      ids.add(`${provider.name}/${model}`);
    }
  }
  return [...ids];
}

/**
 * Whether another provider might do better. A malformed request (400, 413,
 * 422) fails the same everywhere, so it goes straight back to the client;
 * missing or spent keys, unknown models, rate limits and outages move on.
 */
export function shouldFallBack(status: number): boolean {
  if (status >= 500) return true;
  return [401, 402, 403, 404, 408, 409, 429].includes(status);
}

const MINUTE = 60_000;

/**
 * How long to rest a provider after a failure. A rate limit honours
 * Retry-After (seconds or a date, capped at an hour); a refused key rests
 * longest since retrying soon will not help.
 */
export function cooldownMs(status: number, retryAfter: string | null, now = Date.now()): number {
  if (status === 429) {
    const fromHeader = parseRetryAfter(retryAfter, now);
    return Math.min(fromHeader ?? MINUTE, 60 * MINUTE);
  }
  if (status === 401 || status === 402 || status === 403) return 10 * MINUTE;
  if (status === 0 || status >= 500 || status === 408) return 30_000;
  return 0;
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

const NO_USAGE: TokenUsage = { promptTokens: null, completionTokens: null };

function readUsage(value: unknown): TokenUsage | null {
  if (!value || typeof value !== 'object') return null;
  const usage = (value as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return null;
  const { prompt_tokens, completion_tokens } = usage as Record<string, unknown>;
  return {
    promptTokens: typeof prompt_tokens === 'number' ? prompt_tokens : null,
    completionTokens: typeof completion_tokens === 'number' ? completion_tokens : null
  };
}

/** Token counts from a whole (non-streamed) completion. */
export function usageFromJson(text: string): TokenUsage {
  try {
    return readUsage(JSON.parse(text)) ?? NO_USAGE;
  } catch {
    return NO_USAGE;
  }
}

/** Token counts from a streamed completion: the last chunk that carries `usage`. */
export function usageFromSse(text: string): TokenUsage {
  let found: TokenUsage = NO_USAGE;
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      found = readUsage(JSON.parse(data)) ?? found;
    } catch {
      // A partial or non-JSON line: keep what was found.
    }
  }
  return found;
}

/** Joins a provider's base URL and an API path without doubling slashes. */
export function providerUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** A base URL an administrator typed: http(s) only, no query or fragment, no trailing slash. */
export function normalizeBaseUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.search || url.hash || url.username || url.password) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Model ids from an OpenAI-style `GET /models` response, sorted. */
export function parseModelList(value: unknown): string[] {
  const data = (value as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const ids = data
    .map((entry) => (entry as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
