import { z } from 'zod';

export const projectSchema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(80),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((value) => value || undefined)
    .optional()
});

export type ProjectInput = z.input<typeof projectSchema>;
export type ParsedProjectInput = z.output<typeof projectSchema>;

export interface ProjectActionResult {
  ok: boolean;
  error?: string;
}
