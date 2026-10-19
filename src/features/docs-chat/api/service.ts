import { parseModelIds } from '@/lib/docs-chat/models';
import type { ModelListResponse } from './types';

export async function getChatModels(signal?: AbortSignal): Promise<string[]> {
  const response = await fetch('/api/ai/v1/models', { signal });
  if (!response.ok) throw new Error('Could not load models. Try again.');
  const models = parseModelIds((await response.json()) as ModelListResponse);
  if (!models) throw new Error('Could not read the model list. Try again.');
  return models;
}
