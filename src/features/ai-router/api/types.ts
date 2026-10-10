import type { ProviderAuthType, ProviderFormat } from '@/lib/ai-router/types';

export interface AiConnectionSummary {
  id: string;
  providerId: string;
  name: string;
  authType: ProviderAuthType;
  priority: number;
  isActive: boolean;
  allowedModels: string[];
  expiresAt: Date | null;
  rateLimitedUntil: Date | null;
  lastError: string | null;
  hasApiKey: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
}

export interface AiProviderSummary {
  id: string;
  name: string;
  providerType: string;
  alias: string | null;
  format: ProviderFormat;
  authType: ProviderAuthType;
  baseUrl: string;
  models: string[];
  priority: number;
  enabled: boolean;
  cooldownUntil: Date | null;
  lastError: string | null;
  hasApiKey: boolean;
  oauthConfigured: boolean;
}

export interface AiRouterSettings {
  defaultModel: string | null;
  compressToolOutput: boolean;
  maxToolOutputChars: number;
}

export interface ConnectionInput {
  id?: string;
  providerId: string;
  name: string;
  authType: ProviderAuthType;
  apiKey?: string;
  priority: number;
  isActive: boolean;
  allowedModels: string[];
}

export interface AiGatewayAdminData {
  providers: AiProviderSummary[];
  connections: AiConnectionSummary[];
  settings: AiRouterSettings;
  combos: AiComboSummary[];
}

export interface AiComboSummary {
  id: string;
  name: string;
  steps: { providerId: string; model: string }[];
}

export interface AiKeySummary {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface AiGatewayEndpointData {
  keys: AiKeySummary[];
  endpoint: string;
  models: string[];
}
