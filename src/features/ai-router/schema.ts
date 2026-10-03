import { z } from 'zod';

const name = z.string().trim().min(1, 'Enter a name').max(60, 'Use at most 60 characters');

export const providerSchema = z.object({
  id: z.string().min(1).optional(),
  name: name.regex(/^[^/\s][^/]*$/, 'A provider name cannot contain "/"'),
  baseUrl: z.string().trim().min(1, 'Enter the base URL').max(500),
  /** Empty keeps the saved key when editing; `clearApiKey` removes it. */
  apiKey: z.string().trim().max(1000).optional(),
  clearApiKey: z.boolean().optional(),
  models: z.array(z.string().trim().min(1).max(200)).max(500),
  priority: z.number().int().min(0).max(10_000),
  enabled: z.boolean()
});

export type ProviderInput = z.infer<typeof providerSchema>;

export const comboStepSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().trim().min(1, 'Pick a model').max(200)
});

export const comboSchema = z.object({
  id: z.string().min(1).optional(),
  name: name.regex(/^[\w.:-]+$/, 'Use letters, numbers, "-", "_", "." or ":"'),
  steps: z.array(comboStepSchema).min(1, 'Add at least one model').max(20)
});

export type ComboInput = z.infer<typeof comboSchema>;

export const fetchModelsSchema = z.object({
  providerId: z.string().min(1).optional(),
  baseUrl: z.string().trim().min(1).max(500),
  apiKey: z.string().trim().max(1000).optional()
});
