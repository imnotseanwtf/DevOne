import { GitProvider, UserRole } from '@/generated/prisma/client';
import type { LoginResult } from '@/features/auth/schema';
import { getAppUrl, getOAuthConfig } from '@/lib/auth/oauth';
import { createSession } from '@/lib/auth/session';
import { decideRegistration } from '@/lib/auth/registration-policy';
import { getPrisma } from '@/lib/db/prisma';
import { encryptSecret, getEncryptionKey } from '@/lib/encryption/secrets';
import { createGitHubProvider } from '@/lib/git/github';
import { createGitLabProvider } from '@/lib/git/gitlab';
import {
  getAllowedOrganizations,
  isMembershipAllowed,
  normalizeGitLabBaseUrl,
  ProviderAuthenticationError,
  type GitProviderId
} from '@/lib/git/provider';

export function providerIsEnabled(provider: GitProviderId): boolean {
  const enabled = (process.env.DEVONE_AUTH_PROVIDERS ?? 'github,gitlab')
    .split(',')
    .map((value) => value.trim().toLowerCase());
  return enabled.includes(provider);
}

/** Providers whose "Continue with …" button can be offered on the login page. */
export function oauthSignInProviders(): GitProviderId[] {
  if (!getAppUrl()) return [];
  return (['github', 'gitlab'] as const).filter(
    (provider) => providerIsEnabled(provider) && getOAuthConfig(provider) !== null
  );
}

export interface TokenSignIn {
  provider: GitProviderId;
  token: string;
  gitlabBaseUrl?: string;
  /** Only OAuth sign-ins with expiring tokens have these; personal access tokens clear them. */
  refreshToken?: string | null;
  expiresAt?: Date | null;
}

/**
 * Signs in with a provider token, whether pasted or issued by OAuth: checks the
 * identity and org rules, stores the token encrypted, and starts a session.
 */
export async function signInWithToken({
  provider,
  token,
  gitlabBaseUrl,
  refreshToken = null,
  expiresAt = null
}: TokenSignIn): Promise<LoginResult> {
  try {
    const client =
      provider === 'github'
        ? createGitHubProvider()
        : createGitLabProvider(await normalizeGitLabBaseUrl(gitlabBaseUrl || 'https://gitlab.com'));
    const identity = await client.getIdentity(token);

    // Checked on every sign-in, not only registration, so losing org membership revokes access.
    const allowedOrganizations = getAllowedOrganizations(provider);
    if (allowedOrganizations.length > 0) {
      const memberships = await client.getMemberships(token);
      if (!isMembershipAllowed(memberships, allowedOrganizations)) {
        throw new Error('ORGANIZATION_NOT_ALLOWED');
      }
    }

    const prismaProvider = provider === 'github' ? GitProvider.GITHUB : GitProvider.GITLAB;
    const key = getEncryptionKey();
    const encryptedToken = encryptSecret(token, key);
    const tokenFields = {
      encryptedToken,
      encryptedRefreshToken: refreshToken ? encryptSecret(refreshToken, key) : null,
      tokenExpiresAt: expiresAt
    };

    const user = await getPrisma().$transaction(async (transaction) => {
      const existing = await transaction.user.findUnique({
        where: {
          provider_providerUserId: {
            provider: prismaProvider,
            providerUserId: identity.providerUserId
          }
        }
      });
      const userCount = existing ? 1 : await transaction.user.count();

      const registration = decideRegistration(
        Boolean(existing),
        userCount,
        process.env.DEVONE_ALLOW_BOOTSTRAP === 'true',
        process.env.DEVONE_ALLOW_REGISTRATION === 'true'
      );

      if (existing?.disabledAt) throw new Error('USER_DISABLED');
      if (registration === 'bootstrap-disabled') throw new Error('BOOTSTRAP_DISABLED');
      if (registration === 'registration-disabled') {
        throw new Error('REGISTRATION_DISABLED');
      }

      const savedUser = await transaction.user.upsert({
        where: {
          provider_providerUserId: {
            provider: prismaProvider,
            providerUserId: identity.providerUserId
          }
        },
        create: {
          provider: prismaProvider,
          providerUserId: identity.providerUserId,
          username: identity.username,
          name: identity.name,
          avatarUrl: identity.avatarUrl,
          role: registration === 'admin' ? UserRole.ADMIN : UserRole.MEMBER
        },
        update: {
          username: identity.username,
          name: identity.name,
          avatarUrl: identity.avatarUrl,
          lastLoginAt: new Date()
        }
      });

      await transaction.gitConnection.upsert({
        where: {
          userId_provider_baseUrl: {
            userId: savedUser.id,
            provider: prismaProvider,
            baseUrl: identity.baseUrl
          }
        },
        create: {
          userId: savedUser.id,
          provider: prismaProvider,
          providerUserId: identity.providerUserId,
          baseUrl: identity.baseUrl,
          ...tokenFields
        },
        update: { providerUserId: identity.providerUserId, ...tokenFields }
      });

      return savedUser;
    });

    await createSession(user.id);
    return { ok: true };
  } catch (error) {
    if (error instanceof ProviderAuthenticationError) {
      return { ok: false, error: 'The provider rejected this token' };
    }
    if (error instanceof Error && error.message === 'ORGANIZATION_NOT_ALLOWED') {
      return { ok: false, error: 'Your account is not in an organization allowed to use DevOne' };
    }
    if (error instanceof Error && error.message === 'REGISTRATION_DISABLED') {
      return { ok: false, error: 'Registration is disabled for this installation' };
    }
    if (error instanceof Error && error.message === 'USER_DISABLED') {
      return { ok: false, error: 'This account has been disabled by an administrator' };
    }
    if (error instanceof Error && error.message === 'BOOTSTRAP_DISABLED') {
      return { ok: false, error: 'Administrator bootstrap is disabled for this installation' };
    }
    if (error instanceof Error && error.message.includes('GitLab')) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: 'Could not sign in. Check the provider and try again.' };
  }
}
