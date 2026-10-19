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

export { modelLabel } from '@/lib/ai-router/model-label';
