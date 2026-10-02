import { z } from 'zod';

export const loginSchema = z.object({
  provider: z.enum(['github', 'gitlab']),
  token: z.string().trim().min(20, 'Enter a valid personal access token').max(2048),
  gitlabBaseUrl: z.string().trim().max(2048).optional()
});

export type LoginInput = z.infer<typeof loginSchema>;

export interface LoginResult {
  ok: boolean;
  error?: string;
}
