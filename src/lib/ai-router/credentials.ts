import { refreshProviderToken } from './oauth';
import type { CredentialRepository, ProviderCredential, ProviderOAuthConfig } from './types';

const refreshLocks = new Map<string, Promise<void>>();

async function withAccountLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  const previous = refreshLocks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  refreshLocks.set(id, queued);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (refreshLocks.get(id) === queued) refreshLocks.delete(id);
  }
}

function usable(credential: ProviderCredential): boolean {
  if (credential.authType === 'api_key' || credential.authType === 'none') return true;
  return (
    Boolean(credential.accessToken) &&
    (!credential.expiresAt || credential.expiresAt.getTime() > Date.now())
  );
}

function shouldRefresh(credential: ProviderCredential, config: ProviderOAuthConfig): boolean {
  return (
    Boolean(credential.refreshToken) &&
    (!credential.accessToken ||
      Boolean(
        credential.expiresAt && credential.expiresAt.getTime() <= Date.now() + config.refreshLeadMs
      ))
  );
}

export interface CredentialManager {
  ensureFresh(id: string): Promise<ProviderCredential | null>;
  forceRefresh(id: string, failedAccessToken?: string | null): Promise<ProviderCredential | null>;
}

export function createCredentialManager(
  repository: CredentialRepository,
  configFor: (providerId: string) => ProviderOAuthConfig | undefined,
  fetchImpl: typeof fetch = fetch
): CredentialManager {
  async function refresh(
    id: string,
    force: boolean,
    failedAccessToken?: string | null
  ): Promise<ProviderCredential | null> {
    const initial = await repository.findById(id);
    if (!initial) return null;
    if (initial.authType !== 'oauth') return force ? null : usable(initial) ? initial : null;
    const config = configFor(initial.providerId);
    const rejectedToken = failedAccessToken === undefined ? initial.accessToken : failedAccessToken;
    const initialAccessToken = initial.accessToken;
    const initialRefreshTime = initial.lastRefreshAt?.getTime();
    if (force && initial.accessToken !== rejectedToken && usable(initial)) return initial;
    if (!config || !initial.refreshToken) return force ? null : usable(initial) ? initial : null;
    if (!force && !shouldRefresh(initial, config)) return usable(initial) ? initial : null;
    return withAccountLock(id, async () => {
      async function rotate(
        lockedRepository: CredentialRepository
      ): Promise<ProviderCredential | null> {
        // Reload after both locks: another process may have rotated a single-use token.
        const credential = await lockedRepository.findById(id);
        if (!credential) return null;
        if (credential.authType !== 'oauth')
          return force ? null : usable(credential) ? credential : null;
        if (force && credential.accessToken !== rejectedToken && usable(credential))
          return credential;
        if (
          !force &&
          usable(credential) &&
          (credential.accessToken !== initialAccessToken ||
            credential.lastRefreshAt?.getTime() !== initialRefreshTime)
        )
          return credential;
        const latestConfig = configFor(credential.providerId);
        if (
          !latestConfig ||
          !credential.refreshToken ||
          (!force && !shouldRefresh(credential, latestConfig))
        )
          return force ? null : usable(credential) ? credential : null;
        try {
          const tokens = await refreshProviderToken(
            latestConfig,
            credential.refreshToken,
            fetchImpl
          );
          return await lockedRepository.update(id, {
            ...tokens,
            refreshToken: tokens.refreshToken ?? credential.refreshToken,
            idToken: tokens.idToken ?? credential.idToken,
            lastRefreshAt: new Date()
          });
        } catch {
          // Proactive failure may retain a still-valid token; a rejected or expired token is unusable.
          return !force && usable(credential) ? credential : null;
        }
      }
      return repository.withLock ? repository.withLock(id, rotate) : rotate(repository);
    });
  }
  return {
    ensureFresh: (id) => refresh(id, false),
    forceRefresh: (id, failedAccessToken) => refresh(id, true, failedAccessToken)
  };
}
