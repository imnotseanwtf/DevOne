import { AI_PROVIDER_PRESETS } from '@/lib/ai-router/presets';
import type { AiConnectionSummary, AiProviderSummary } from './api/types';

export function providerPresetId(provider: AiProviderSummary): string {
  return (
    AI_PROVIDER_PRESETS.find((preset) =>
      preset.providerType && preset.providerType !== 'custom'
        ? preset.providerType === provider.providerType
        : preset.baseUrl &&
          preset.baseUrl.replace(/\/$/, '') === provider.baseUrl.replace(/\/$/, '')
    )?.id ?? 'custom'
  );
}

export function providerAccountStats(
  provider: AiProviderSummary,
  connections: AiConnectionSummary[],
  now = Date.now()
): { total: number; available: number } {
  const accounts = connections.filter((account) => account.providerId === provider.id);
  return {
    total: accounts.length,
    available: provider.enabled
      ? accounts.filter(
          (account) =>
            account.isActive &&
            (!account.rateLimitedUntil || new Date(account.rateLimitedUntil).getTime() <= now) &&
            (account.authType === 'none' ||
              (account.authType === 'api_key' && account.hasApiKey) ||
              ((account.authType === 'access_token' || account.authType === 'oauth') &&
                ((account.hasAccessToken &&
                  (!account.expiresAt || new Date(account.expiresAt).getTime() > now)) ||
                  (account.authType === 'oauth' &&
                    account.hasRefreshToken &&
                    provider.oauthConfigured))))
        ).length
      : 0
  };
}
