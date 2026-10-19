'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { isDemoMode, DEMO_DISABLED_MESSAGE } from '@/lib/demo';
import { AiRouterError } from '../../service';
import { completeHostedOAuth, getPendingOAuthConnection } from '../../oauth-service';
import type { AiOAuthConnection } from '../types';

export async function loadOAuthConnection(state: string): Promise<AiOAuthConnection> {
  const user = await requireUser();
  if (isDemoMode()) throw new AiRouterError(DEMO_DISABLED_MESSAGE);
  return getPendingOAuthConnection(user.id, state);
}

export async function completeOAuthConnection(
  input: unknown
): Promise<{ ok: true; connected: boolean } | { ok: false; error: string }> {
  const parsed = z
    .object({ state: z.string().min(1).max(256), code: z.string().max(10000).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid connection request' };
  const user = await requireUser();
  if (isDemoMode()) return { ok: false, error: DEMO_DISABLED_MESSAGE };
  try {
    return {
      ok: true,
      connected: await completeHostedOAuth(user.id, parsed.data.state, parsed.data.code)
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof AiRouterError
          ? error.message
          : 'Could not finish sign-in. Start a new connection and try again.'
    };
  }
}
