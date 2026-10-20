export type ProviderFormat = 'openai' | 'claude' | 'openai-responses';
export type ProviderAuthType = 'api_key' | 'oauth' | 'access_token' | 'none';

export interface ProviderCredential {
  id: string;
  providerId: string;
  authType: ProviderAuthType;
  apiKey?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
  expiresAt?: Date | null;
  lastRefreshAt?: Date | null;
  providerSpecificData?: Record<string, unknown>;
}

export interface ProviderOAuthConfig {
  clientId: string;
  clientSecret?: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  encoding: 'form' | 'json';
  refreshLeadMs: number;
  redirectUri?: string;
  authorizeParams?: Record<string, string>;
  includeStateInToken?: boolean;
}

export interface ProviderDefinition {
  id: string;
  alias: string;
  name: string;
  authTypes?: ProviderAuthType[];
  transport: {
    baseUrl: string;
    path: string;
    format: ProviderFormat;
    forceStream?: boolean;
    headers?: Record<string, string>;
    auth: { header: string; scheme: 'raw' | 'bearer' };
  };
  models: {
    id: string;
    name: string;
    upstreamModelId?: string;
    responsesLite?: boolean;
    /** The model answers 400 when temperature, top_p or top_k is sent. */
    rejectsSampling?: boolean;
  }[];
  oauth?: ProviderOAuthConfig;
}

export interface CredentialRepository {
  findById(id: string): Promise<ProviderCredential | null>;
  update(id: string, patch: Partial<ProviderCredential>): Promise<ProviderCredential>;
  withLock?<T>(id: string, work: (repository: CredentialRepository) => Promise<T>): Promise<T>;
}
