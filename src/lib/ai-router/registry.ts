import type { ProviderDefinition, ProviderFormat, ProviderOAuthConfig } from './types';

export const CODEX_CLIENT_VERSION = '0.159.0';
export const CLAUDE_DEFAULT_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const CLAUDE_CODE_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
export const CODEX_DEFAULT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

// Bootstrap catalog; model discovery refreshes the saved list from the account's API.
const claudeModels: ProviderDefinition['models'] = [
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', rejectsSampling: true },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1' },
  { id: 'claude-opus-5', name: 'Claude Opus 5' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', rejectsSampling: true },
  { id: 'claude-fable-5', name: 'Claude Fable 5' },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
  { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' }
];

export const SAMPLING_FIELDS = ['temperature', 'top_p', 'top_k'] as const;

/** Matches the plain, `cc/` alias and `Claude/` provider-prefixed forms of a model id. */
export function modelRejectsSampling(model: string): boolean {
  const id = model.slice(model.lastIndexOf('/') + 1).toLowerCase();
  return claudeModels.some((entry) => entry.rejectsSampling && entry.id === id);
}

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
    models: claudeModels
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
    models: claudeModels
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
      headers: {
        originator: 'codex_cli_rs',
        'User-Agent': `codex_cli_rs/${CODEX_CLIENT_VERSION}`,
        version: CODEX_CLIENT_VERSION
      },
      auth: { header: 'Authorization', scheme: 'bearer' }
    },
    models: [
      { id: 'gpt-6.1-sol', name: 'GPT 6.1 Sol', responsesLite: true },
      { id: 'gpt-6-astra', name: 'GPT 6 Astra' },
      { id: 'gpt-6-sol', name: 'GPT 6 Sol', responsesLite: true },
      { id: 'gpt-6-luna', name: 'GPT 6 Luna', responsesLite: true },
      { id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' },
      { id: 'gpt-5.6-terra', name: 'GPT 5.6 Terra' },
      { id: 'gpt-5.6-luna', name: 'GPT 5.6 Luna' },
      { id: 'gpt-5.5', name: 'GPT 5.5' },
      { id: 'gpt-daybreak-blue-latest', name: 'GPT Daybreak Blue' },
      { id: 'gpt-reserve', name: 'GPT Reserve' }
    ]
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

// Public native-client identities. Claude's endpoints and manual callback match the installed CLI;
// hosted Codex follows https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs.
const oauthDefaults: Record<string, ProviderOAuthConfig> = {
  claude: {
    clientId: CLAUDE_DEFAULT_CLIENT_ID,
    redirectUri: CLAUDE_CODE_REDIRECT_URI,
    authorizeUrl: 'https://claude.com/cai/oauth/authorize',
    tokenUrl: 'https://platform.claude.com/v1/oauth/token',
    scope: 'org:create_api_key user:profile user:inference',
    encoding: 'json',
    authorizeParams: { code: 'true' },
    includeStateInToken: true,
    refreshLeadMs: 14_400_000
  },
  codex: {
    clientId: CODEX_DEFAULT_CLIENT_ID,
    redirectUri: 'http://localhost:1455/auth/callback',
    authorizeUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    scope: 'openid profile email offline_access',
    encoding: 'form',
    authorizeParams: {
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'codex_cli_rs'
    },
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
  const defaults = oauthDefaults[definition.id];
  const clientId = read('CLIENT_ID') ?? defaults?.clientId;
  if (!clientId) return result;
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
    redirectUri:
      read('REDIRECT_URI') ?? (clientId === defaults?.clientId ? defaults?.redirectUri : undefined),
    authorizeParams: defaults?.authorizeParams ? { ...defaults.authorizeParams } : undefined,
    includeStateInToken: defaults?.includeStateInToken
  };
  return result;
}
