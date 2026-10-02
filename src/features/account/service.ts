import { GitProvider, Prisma } from '@/generated/prisma/client';
import { DEMO_DISABLED_MESSAGE, isDemoMode } from '@/lib/demo';
import { readPreferences, type UserPreferences } from '@/features/account/preferences';
import { recordAudit } from '@/lib/audit/record';
import { getPrisma } from '@/lib/db/prisma';
import { encryptSecret, getEncryptionKey } from '@/lib/encryption/secrets';
import { createGitHubProvider } from '@/lib/git/github';
import { createGitLabProvider } from '@/lib/git/gitlab';
import {
  normalizeGitLabBaseUrl,
  ProviderAuthenticationError,
  type GitProviderId
} from '@/lib/git/provider';

/** A refusal worded for the person, shown as-is. */
export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountError';
  }
}

export async function getProfile(userId: string) {
  const user = await getPrisma().user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
      provider: true,
      role: true,
      createdAt: true,
      lastLoginAt: true,
      demoExpiresAt: true,
      preferences: true,
      _count: { select: { memberships: true } }
    }
  });
  const { _count, preferences, ...profile } = user;
  return {
    ...profile,
    projectCount: _count.memberships,
    preferences: readPreferences(preferences)
  };
}

export async function getPreferences(userId: string): Promise<UserPreferences> {
  const user = await getPrisma().user.findUnique({
    where: { id: userId },
    select: { preferences: true }
  });
  return readPreferences(user?.preferences);
}

export async function savePreferences(userId: string, preferences: UserPreferences) {
  await getPrisma().user.update({
    where: { id: userId },
    data: { preferences: preferences as unknown as Prisma.InputJsonValue }
  });
}

export async function listConnections(userId: string) {
  const [user, connections] = await Promise.all([
    getPrisma().user.findUniqueOrThrow({
      where: { id: userId },
      select: { provider: true, providerUserId: true }
    }),
    getPrisma().gitConnection.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        providerUserId: true,
        baseUrl: true,
        encryptedRefreshToken: true,
        tokenExpiresAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { repositories: true } }
      },
      orderBy: { createdAt: 'asc' }
    })
  ]);
  return connections.map(({ encryptedRefreshToken, _count, ...connection }) => ({
    ...connection,
    kind: encryptedRefreshToken ? ('oauth' as const) : ('token' as const),
    repositoryCount: _count.repositories,
    // The connection DevOne signs this person in with can't be removed.
    isSignIn:
      connection.provider === user.provider && connection.providerUserId === user.providerUserId
  }));
}

export type AccountConnection = Awaited<ReturnType<typeof listConnections>>[number];

async function identify(provider: GitProviderId, token: string, gitlabBaseUrl?: string) {
  const client =
    provider === 'github'
      ? createGitHubProvider()
      : createGitLabProvider(await normalizeGitLabBaseUrl(gitlabBaseUrl || 'https://gitlab.com'));
  try {
    return await client.getIdentity(token);
  } catch (error) {
    if (error instanceof ProviderAuthenticationError) {
      throw new AccountError('The provider rejected this token');
    }
    if (error instanceof Error && error.message.includes('GitLab')) {
      throw new AccountError(error.message);
    }
    throw new AccountError('Could not reach the provider');
  }
}

/**
 * Adds a GitHub or GitLab account to pick repositories from, or replaces the
 * token of one already connected (same account on the same server).
 */
export async function connectAccount(
  userId: string,
  input: { provider: GitProviderId; token: string; gitlabBaseUrl?: string }
) {
  if (isDemoMode()) throw new AccountError(DEMO_DISABLED_MESSAGE);
  const identity = await identify(input.provider, input.token, input.gitlabBaseUrl);
  const provider = input.provider === 'github' ? GitProvider.GITHUB : GitProvider.GITLAB;
  const existing = await getPrisma().gitConnection.findUnique({
    where: { userId_provider_baseUrl: { userId, provider, baseUrl: identity.baseUrl } },
    select: { providerUserId: true }
  });
  if (existing && existing.providerUserId !== identity.providerUserId) {
    throw new AccountError(
      `This token belongs to @${identity.username}, not the account already connected on this server`
    );
  }
  const encryptedToken = encryptSecret(input.token, getEncryptionKey());
  await getPrisma().gitConnection.upsert({
    where: { userId_provider_baseUrl: { userId, provider, baseUrl: identity.baseUrl } },
    create: {
      userId,
      provider,
      providerUserId: identity.providerUserId,
      baseUrl: identity.baseUrl,
      encryptedToken
    },
    // A pasted token never expires here, so any OAuth refresh state is dropped.
    update: { encryptedToken, encryptedRefreshToken: null, tokenExpiresAt: null }
  });
  await recordAudit({
    actorId: userId,
    action: existing ? 'account.connection.token' : 'account.connection.add',
    target: `${input.provider}:${identity.username}`,
    details: { baseUrl: identity.baseUrl }
  });
  return { username: identity.username, replaced: Boolean(existing) };
}

/** Removing a connection also unlinks the repositories reached through it. */
export async function removeConnection(userId: string, connectionId: string) {
  const connections = await listConnections(userId);
  const connection = connections.find((entry) => entry.id === connectionId);
  if (!connection) throw new AccountError('Connection not found');
  if (connection.isSignIn) {
    throw new AccountError("You sign in with this account, so it can't be removed");
  }
  await getPrisma().gitConnection.delete({ where: { id: connectionId } });
  await recordAudit({
    actorId: userId,
    action: 'account.connection.remove',
    target: `${connection.provider.toLowerCase()}:${connection.providerUserId}`,
    details: { baseUrl: connection.baseUrl, repositories: connection.repositoryCount }
  });
}

export async function listSessions(userId: string) {
  return getPrisma().session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true, userAgent: true, ipAddress: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: 'desc' }
  });
}

export async function revokeSession(userId: string, sessionId: string) {
  const { count } = await getPrisma().session.deleteMany({ where: { id: sessionId, userId } });
  if (count === 0) throw new AccountError('Session not found');
  await recordAudit({ actorId: userId, action: 'account.session.revoke' });
}

export async function revokeOtherSessions(userId: string, keepSessionId: string) {
  const { count } = await getPrisma().session.deleteMany({
    where: { userId, id: { not: keepSessionId } }
  });
  await recordAudit({
    actorId: userId,
    action: 'account.session.revoke-others',
    details: { count }
  });
  return count;
}
