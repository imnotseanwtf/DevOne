import type { ProviderDefinition, ProviderFormat, ProviderOAuthConfig } from './types';

const definitions: ProviderDefinition[] = [
  {
    id: 'opencode',
    alias: 'oc',
    name: 'OpenCode Free',
    authTypes: ['none'],
    transport: {
      baseUrl: 'https://opencode.ai/zen/v1',
      path: '/chat/completions',
      format: 'openai',
      forceStream: true,
      auth: { header: 'Authorization', scheme: 'bearer' }
    },
    models: [{ id: 'big-pickle', name: 'Big Pickle' }]
  },
  {
    id: 'openai',
    alias: 'oa',
    name: 'OpenAI',
    authTypes: ['api_key', 'access_token'],
    transport: {
      baseUrl: 'https://api.openai.com/v1',
      path: '/chat/completions',
      format: 'openai',
      auth: { header: 'Authorization', scheme: 'bearer' }
    },
    models: [{ id: 'gpt-4o', name: 'GPT-4o' }]
  },
  {
    id: 'anthropic',
    alias: 'an',
    name: 'Anthropic',
    authTypes: ['api_key', 'access_token'],
    transport: {
      baseUrl: 'https://api.anthropic.com/v1',
      path: '/messages',
      format: 'claude',
      headers: { 'anthropic-version': '2023-06-01' },
      auth: { header: 'x-api-key', scheme: 'raw' }
    },
    models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }]
  },
  {
    id: 'claude',
    alias: 'cc',
    name: 'Claude OAuth',
    authTypes: ['api_key', 'oauth', 'access_token'],
    transport: {
      baseUrl: 'https://api.anthropic.com/v1',
      path: '/messages',
      format: 'claude',
      headers: { 'anthropic-version': '2023-06-01' },
      auth: { header: 'Authorization', scheme: 'bearer' }
    },
    models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }]
  },
  {
    id: 'codex',
    alias: 'cx',
    name: 'Codex OAuth',
    authTypes: ['oauth', 'access_token'],
    transport: {
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      path: '/responses',
      format: 'openai-responses',
      forceStream: true,
      auth: { header: 'Authorization', scheme: 'bearer' }
    },
    models: [{ id: 'gpt-5-codex', name: 'GPT-5 Codex' }]
  },
  {
    id: 'ollama',
    alias: 'ol',
    name: 'Ollama',
    authTypes: ['none', 'api_key'],
    transport: {
      baseUrl: 'http://localhost:11434/v1',
      path: '/chat/completions',
      format: 'openai',
      auth: { header: 'Authorization', scheme: 'bearer' }
    },
    models: []
  },
  {
    id: 'custom',
    alias: 'custom',
    name: 'Custom provider',
    authTypes: ['api_key', 'oauth', 'access_token', 'none'],
    transport: {
      baseUrl: 'https://api.openai.com/v1',
      path: '/chat/completions',
      format: 'openai',
      auth: { header: 'Authorization', scheme: 'bearer' }
    },
    models: []
  }
];

const oauthDefaults: Record<string, Omit<ProviderOAuthConfig, 'clientId'>> = {
  claude: {
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://api.anthropic.com/v1/oauth/token',
    scope: 'org:create_api_key user:profile user:inference',
    encoding: 'json',
    authorizeParams: { code: 'true' },
    includeStateInToken: true,
    refreshLeadMs: 14_400_000
  },
  codex: {
    authorizeUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    scope: 'openid profile email offline_access',
    encoding: 'form',
    refreshLeadMs: 600_000
  }
};

/** Installation configuration contains OAuth client identities, never provider credentials. */
export function getProviderDefinition(
  idOrAlias: string,
  env: Record<string, string | undefined> = process.env
): ProviderDefinition | null {
  const definition = definitions.find(
    (value) => value.id === idOrAlias || value.alias === idOrAlias
  );
  if (!definition) return null;
  const prefix = `DEVONE_AI_${definition.id.toUpperCase()}_`;
  const read = (key: string): string | undefined => env[`${prefix}${key}`]?.trim() || undefined;
  const format = read('FORMAT') ?? definition.transport.format;
  if (!['openai', 'claude', 'openai-responses'].includes(format))
    throw new Error('Invalid provider transport format');
  const scheme = read('AUTH_SCHEME') ?? definition.transport.auth.scheme;
  if (scheme !== 'raw' && scheme !== 'bearer')
    throw new Error('Invalid provider authentication scheme');
  const pathForFormat = {
    openai: '/chat/completions',
    claude: '/messages',
    'openai-responses': '/responses'
  };
  const result: ProviderDefinition = {
    ...definition,
    authTypes: definition.authTypes ? [...definition.authTypes] : undefined,
    transport: {
      ...definition.transport,
      baseUrl: read('BASE_URL') ?? definition.transport.baseUrl,
      format: format as ProviderFormat,
      path: read('PATH') ?? pathForFormat[format as ProviderFormat],
      headers: definition.transport.headers ? { ...definition.transport.headers } : undefined,
      auth: { header: read('AUTH_HEADER') ?? definition.transport.auth.header, scheme }
    },
    models: definition.models.map((model) => ({ ...model }))
  };
  const clientId = read('CLIENT_ID');
  if (!clientId) return result;
  const defaults = oauthDefaults[definition.id];
  const authorizeUrl = read('AUTHORIZE_URL') ?? defaults?.authorizeUrl;
  const tokenUrl = read('TOKEN_URL') ?? defaults?.tokenUrl;
  if (!authorizeUrl || !tokenUrl)
    throw new Error('OAuth authorize and token URLs must be configured');
  const encoding = read('TOKEN_ENCODING') ?? defaults?.encoding ?? 'form';
  if (encoding !== 'form' && encoding !== 'json') throw new Error('Invalid OAuth token encoding');
  const refreshLeadMs = Number(read('REFRESH_LEAD_MS') ?? defaults?.refreshLeadMs ?? 60_000);
  if (!Number.isFinite(refreshLeadMs) || refreshLeadMs < 0)
    throw new Error('Invalid OAuth refresh lead time');
  result.oauth = {
    clientId,
    clientSecret: read('CLIENT_SECRET'),
    authorizeUrl,
    tokenUrl,
    scope: read('SCOPE') ?? defaults?.scope ?? '',
    encoding,
    refreshLeadMs,
    redirectUri: read('REDIRECT_URI'),
    authorizeParams: defaults?.authorizeParams ? { ...defaults.authorizeParams } : undefined,
    includeStateInToken: defaults?.includeStateInToken
  };
  return result;
}
