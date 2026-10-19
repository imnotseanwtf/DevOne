/** The router's own "best available" name; always valid, even before the list loads. */
export const DEFAULT_MODEL = 'auto';

export const MODEL_STORAGE_KEY = 'devone:docs-ai-model';

/** Ids from the router's /models answer, or null when it isn't the shape we expect. */
export function parseModelIds(body: unknown): string[] | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  const ids = data
    .map((entry) => (entry as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set(ids)];
}

/** The remembered model if the router still offers it, otherwise auto. */
export function pickModel(saved: string | null | undefined, available: string[] | null): string {
  if (!saved) return DEFAULT_MODEL;
  if (available === null) return saved;
  return available.includes(saved) ? saved : DEFAULT_MODEL;
}

/** Display names only: the original id remains the request and storage value. */
export function modelLabel(id: string, includeProvider = false): string {
  if (id === DEFAULT_MODEL) return 'Auto (first available)';
  const slash = id.lastIndexOf('/');
  const model = id.slice(slash + 1);
  const normalized = model.replace(
    /^claude-(\d+(?:[.-]\d{1,2})?)-(sonnet|opus|haiku|fable)/i,
    'claude-$2-$1'
  );
  const claude = /^claude-(sonnet|opus|haiku|fable)-(\d+(?:[.-]\d{1,2}(?=-|$))?)(.*)$/i.exec(
    normalized
  );
  let label: string;
  if (claude) {
    const [, family, version, variant] = claude;
    const suffix = variant.replace(/^-/, '').replaceAll('-', ' ');
    label = `Claude ${family[0].toUpperCase()}${family.slice(1).toLowerCase()} ${version.replace('-', '.')}${suffix ? ` (${suffix})` : ''}`;
  } else if (/^gpt-[\w.-]+$/i.test(model)) {
    label = `GPT ${model
      .slice(4)
      .replaceAll('-', ' ')
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())}`;
  } else {
    return id;
  }
  if (!includeProvider || slash < 0) return label;
  const provider = id.slice(0, slash);
  const providerNames: Record<string, string> = {
    cc: 'Claude Code',
    cx: 'Codex',
    oa: 'OpenAI',
    an: 'Anthropic',
    oc: 'OpenCode Free',
    ol: 'Ollama'
  };
  return `${label} (via ${providerNames[provider.toLowerCase()] ?? provider})`;
}
