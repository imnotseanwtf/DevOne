import type { AiConnection, Prisma } from '@/generated/prisma/client';
import { getPrisma } from '@/lib/db/prisma';
import { decryptSecret, encryptSecret, getEncryptionKey } from '@/lib/encryption/secrets';
import { getProviderDefinition } from '@/lib/ai-router/registry';
import { oauthConfigFingerprint } from '@/lib/ai-router/security';
import type {
  CredentialRepository,
  ProviderCredential,
  ProviderAuthType
} from '@/lib/ai-router/types';

function decrypt(value: string | null): string | null {
  return value ? decryptSecret(value, getEncryptionKey()) : null;
}

function encrypt(value: string | null | undefined): string | null {
  return value ? encryptSecret(value, getEncryptionKey()) : null;
}

export function connectionCredential(connection: AiConnection): ProviderCredential {
  return {
    id: connection.id,
    providerId: connection.providerId,
    authType: connection.authType as ProviderAuthType,
    apiKey: decrypt(connection.encryptedApiKey),
    accessToken: decrypt(connection.encryptedAccessToken),
    refreshToken: decrypt(connection.encryptedRefreshToken),
    idToken: decrypt(connection.encryptedIdToken),
    expiresAt: connection.expiresAt,
    lastRefreshAt: connection.lastRefreshAt,
    providerSpecificData: connection.providerSpecificData as Record<string, unknown>
  };
}

export function createConnectionRepository(
  database: Prisma.TransactionClient = getPrisma(),
  locked = false
): CredentialRepository {
  const repository: CredentialRepository = {
    async findById(id) {
      const connection = await database.aiConnection.findUnique({
        where: { id },
        include: { provider: true }
      });
      if (connection?.authType === 'oauth') {
        const config = getProviderDefinition(connection.provider.providerType)?.oauth;
        const metadata = connection.providerSpecificData as Record<string, unknown>;
        if (
          !config ||
          metadata.oauthConfigHash !==
            oauthConfigFingerprint(connection.provider.providerType, config) ||
          metadata.upstreamBaseUrl !== connection.provider.baseUrl
        )
          return null;
      }
      return connection?.isActive ? connectionCredential(connection) : null;
    },
    async update(id, patch) {
      const data: Prisma.AiConnectionUpdateInput = {};
      if (patch.apiKey !== undefined) data.encryptedApiKey = encrypt(patch.apiKey);
      if (patch.accessToken !== undefined) data.encryptedAccessToken = encrypt(patch.accessToken);
      if (patch.refreshToken !== undefined)
        data.encryptedRefreshToken = encrypt(patch.refreshToken);
      if (patch.idToken !== undefined) data.encryptedIdToken = encrypt(patch.idToken);
      if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt;
      if (patch.lastRefreshAt !== undefined) data.lastRefreshAt = patch.lastRefreshAt;
      if (patch.providerSpecificData !== undefined)
        data.providerSpecificData = JSON.parse(
          JSON.stringify(patch.providerSpecificData)
        ) as Prisma.InputJsonValue;
      return connectionCredential(await database.aiConnection.update({ where: { id }, data }));
    }
  };
  if (!locked) {
    repository.withLock = (id, work) =>
      getPrisma().$transaction(
        async (transaction) => {
          // Transaction-scoped advisory locks also serialize refreshes across server processes.
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
          return work(createConnectionRepository(transaction, true));
        },
        { timeout: 30_000, maxWait: 10_000 }
      );
  }
  return repository;
}
