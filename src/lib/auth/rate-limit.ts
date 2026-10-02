import { createHash } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import { getPrisma } from '@/lib/db/prisma';

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

interface AuthRateLimitState {
  attempts: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
}

interface AuthRateLimitDecision {
  allowed: boolean;
  next: AuthRateLimitState;
}

export function nextAuthRateLimitState(
  state: AuthRateLimitState | null,
  now = new Date()
): AuthRateLimitDecision {
  if (state?.blockedUntil && state.blockedUntil > now) return { allowed: false, next: state };

  if (!state || now.getTime() - state.windowStartedAt.getTime() >= WINDOW_MS) {
    return {
      allowed: true,
      next: { attempts: 1, windowStartedAt: now, blockedUntil: null }
    };
  }

  const attempts = state.attempts + 1;
  return {
    allowed: attempts <= MAX_ATTEMPTS,
    next: {
      attempts,
      windowStartedAt: state.windowStartedAt,
      blockedUntil: attempts > MAX_ATTEMPTS ? new Date(now.getTime() + BLOCK_MS) : null
    }
  };
}

export function authRateLimitKey(
  provider: string,
  forwardedFor: string | null,
  token: string
): string {
  const forwardedAddress = forwardedFor?.split(',')[0]?.trim();
  const dimension =
    process.env.DEVONE_TRUST_PROXY === 'true' && forwardedAddress
      ? `ip:${forwardedAddress}`
      : `token:${token}`;
  return createHash('sha256').update(`login:${provider}:${dimension}`).digest('hex');
}

export async function consumeAuthAttempt(key: string): Promise<boolean> {
  return getPrisma().$transaction(
    async (transaction) => {
      const current = await transaction.authRateLimit.findUnique({ where: { key } });
      const decision = nextAuthRateLimitState(current);

      await transaction.authRateLimit.upsert({
        where: { key },
        create: { key, ...decision.next },
        update: decision.next
      });

      return decision.allowed;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function clearAuthAttempts(key: string): Promise<void> {
  await getPrisma().authRateLimit.deleteMany({ where: { key } });
}
