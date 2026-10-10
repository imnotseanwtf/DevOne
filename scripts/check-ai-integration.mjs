import assert from 'node:assert/strict';
import { mock } from 'bun:test';

// A small repository double keeps service behavior checks independent of a configured database.
// Migrations are exercised separately against PostgreSQL; these checks exercise the actual services.
let providers = [{ id: 'a', name: 'Alpha', alias: 'Beta', providerType: 'custom', authType: 'none', format: 'openai', baseUrl: 'https://8.8.8.8', models: ['m'], priority: 100, enabled: true, encryptedApiKey: null, cooldownUntil: null }];
let connections = [];
let sessions = [];
let nextId = 1;
const matches = (record, where = {}) => Object.entries(where).every(([key, value]) => key === 'NOT' ? record.id !== value.id : record[key] === value);
const database = {
  user: { findUnique: async ({ where }) => ({ role: where.id === 'admin' ? 'ADMIN' : 'MEMBER' }) },
  aiProvider: {
    findMany: async ({ where } = {}) => providers.filter((entry) => matches(entry, where)).map((entry) => structuredClone({ ...entry, connections: connections.filter((account) => account.providerId === entry.id) })),
    findUnique: async ({ where, select }) => { const entry = providers.find((record) => record.id === where.id); return entry ? structuredClone({ ...entry, connections: connections.filter((account) => account.providerId === entry.id && matches(account, select?.connections?.where)) }) : null; },
    create: async ({ data }) => { const row = { id: `p-${nextId++}`, alias: null, cooldownUntil: null, ...data }; providers.push(row); return structuredClone(row); },
    update: async ({ where, data }) => { const entry = providers.find((record) => record.id === where.id); Object.assign(entry, data); return structuredClone(entry); }
  },
  aiConnection: {
    findUnique: async ({ where }) => { const entry = connections.find((record) => record.id === where.id); return entry ? structuredClone({ ...entry, provider: providers.find((record) => record.id === entry.providerId) }) : null; },
    upsert: async ({ where, create, update }) => { let entry = connections.find((record) => record.id === where.id); if (entry) Object.assign(entry, update); else { entry = { priority: 100, isActive: true, allowedModels: [], modelLocks: {}, providerSpecificData: {}, rateLimitedUntil: null, encryptedApiKey: null, encryptedAccessToken: null, encryptedRefreshToken: null, encryptedIdToken: null, expiresAt: null, lastRefreshAt: null, ...create }; connections.push(entry); } return structuredClone(entry); },
    updateMany: async ({ where, data }) => { const matched = connections.filter((record) => matches(record, where)); matched.forEach((entry) => Object.assign(entry, data)); return { count: matched.length }; },
    update: async ({ where, data }) => { const entry = connections.find((record) => record.id === where.id); Object.assign(entry, data); return structuredClone(entry); }
  },
  aiCombo: { findMany: async () => [] },
  aiRouterSettings: { findUnique: async () => null },
  aiOAuthSession: { deleteMany: async ({ where }) => { const previous = sessions.length; sessions = sessions.filter((entry) => !matches(entry, where)); return { count: previous - sessions.length }; } },
  $executeRaw: async () => 1,
  $transaction: async (work) => { const previous = structuredClone({ providers, connections, sessions }); try { return await work(database); } catch (error) { ({ providers, connections, sessions } = previous); throw error; } }
};
mock.module('../src/lib/db/prisma.ts', () => ({ getPrisma: () => database }));
mock.module('../src/lib/audit/record.ts', () => ({ recordAudit: async () => undefined }));
const { saveProvider, loadRouterState, fetchProviderModels, refreshProviderModels } = await import('../src/features/ai-router/service.ts');
const { createConnectionRepository } = await import('../src/features/ai-router/connection-repository.ts');
const { oauthConfigFingerprint } = await import('../src/lib/ai-router/security.ts');
const { getProviderDefinition } = await import('../src/lib/ai-router/registry.ts');
const { encryptSecret, decryptSecret } = await import('../src/lib/encryption/secrets.ts');
const key = Buffer.alloc(32, 7);
process.env.DEVONE_ENCRYPTION_KEY = key.toString('base64');
const input = { name: 'Beta', alias: null, providerType: 'custom', authType: 'none', format: 'openai', baseUrl: 'https://8.8.8.8', models: ['m'], priority: 200, enabled: true };

await assert.rejects(saveProvider('member', input), /Administrators only/);
await assert.rejects(saveProvider('admin', input), /name or alias/);
assert.equal(providers.length, 1, 'a conflicting provider must not be saved');
const providerId = await saveProvider('admin', { ...input, name: 'Token', authType: 'access_token', apiKey: 'test-access-token' });
assert.equal(connections.length, 1);
const stored = connections[0].encryptedAccessToken;
assert.notEqual(stored, 'test-access-token');
await saveProvider('admin', { ...input, id: providerId, name: 'Token', authType: 'access_token' });
assert.equal(connections[0].encryptedAccessToken, stored, 'editing without a secret preserves the access token');
assert.equal(decryptSecret(stored, key), 'test-access-token');
const beforeInvalid = providers.length;
await assert.rejects(saveProvider('admin', { ...input, name: 'Missing key', authType: 'api_key' }), /key or access token/);
assert.equal(providers.length, beforeInvalid, 'a rejected credential cannot leave an orphan provider');

// Parent provider configuration changes invalidate sessions and disconnect existing OAuth accounts.
process.env.DEVONE_AI_CLAUDE_CLIENT_ID = 'test-application';
const oauthId = await saveProvider('admin', { ...input, name: 'Claude profile', providerType: 'claude', authType: 'oauth', format: 'claude', alias: 'cc-test' });
const config = getProviderDefinition('claude').oauth;
connections.push({ id: 'oauth-1', providerId: oauthId, authType: 'oauth', isActive: true, encryptedApiKey: null, encryptedAccessToken: encryptSecret('oauth-secret', key), encryptedRefreshToken: encryptSecret('rotating-secret', key), encryptedIdToken: null, expiresAt: null, lastRefreshAt: null, providerSpecificData: { oauthConfigHash: oauthConfigFingerprint('claude', config), upstreamBaseUrl: input.baseUrl } });
sessions.push({ providerId: oauthId });
assert.ok(await createConnectionRepository().findById('oauth-1'));
await saveProvider('admin', { ...input, id: oauthId, name: 'Claude profile', providerType: 'claude', authType: 'oauth', format: 'claude', alias: 'cc-test', baseUrl: 'https://1.1.1.1' });
assert.equal(sessions.length, 0);
assert.equal(connections.find((entry) => entry.id === 'oauth-1').isActive, false);
connections.find((entry) => entry.id === 'oauth-1').isActive = true;
assert.equal(await createConnectionRepository().findById('oauth-1'), null, 'reactivating cannot send bound OAuth credentials to a changed upstream');
connections.find((entry) => entry.id === 'oauth-1').isActive = false;

let headers;
const discovered = await fetchProviderModels('admin', { baseUrl: 'https://8.8.8.8', providerType: 'anthropic', format: 'claude', authType: 'api_key', apiKey: 'test-api-key' }, async (_url, init) => { headers = new Headers(init.headers); return Response.json({ data: [{ id: 'model-a' }] }); });
assert.deepEqual(discovered, ['model-a']);
assert.equal(headers.get('x-api-key'), 'test-api-key');
assert.equal(headers.get('anthropic-version'), '2023-06-01');
assert.equal(headers.get('authorization'), null);
assert.equal(headers.get('anthropic-beta'), null, 'API-key discovery does not need OAuth beta');

// Metadata discovery can use a cooling account without clearing its inference cooldown.
const coolingUntil = new Date(Date.now() + 60_000);
connections.push({ id: 'oauth-cooling', providerId: oauthId, authType: 'oauth', isActive: true, encryptedApiKey: null, encryptedAccessToken: encryptSecret('catalog-secret', key), encryptedRefreshToken: null, encryptedIdToken: null, expiresAt: null, lastRefreshAt: null, rateLimitedUntil: coolingUntil, modelLocks: {}, lastError: 'HTTP 429: Error', providerSpecificData: { oauthConfigHash: oauthConfigFingerprint('claude', config), upstreamBaseUrl: 'https://1.1.1.1' } });
const discoveryRequest = { providerId: oauthId, baseUrl: 'https://1.1.1.1' };
const modelResponse = async (url, init) => {
  headers = new Headers(init.headers);
  assert.equal(headers.get('authorization'), 'Bearer catalog-secret');
  assert.equal(headers.get('anthropic-beta'), 'oauth-2025-04-20');
  assert.equal(new URL(url).searchParams.get('limit'), '1000');
  return Response.json({ data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }] });
};
assert.deepEqual(await fetchProviderModels('admin', discoveryRequest, modelResponse), ['claude-opus-5-5', 'claude-sonnet-5-5']);
const beforeRefresh = structuredClone(connections);
await assert.rejects(refreshProviderModels('member', oauthId, modelResponse), /Administrators only/);
await refreshProviderModels('admin', oauthId, modelResponse);
assert.deepEqual(providers.find((provider) => provider.id === oauthId).models, ['m', 'claude-opus-5-5', 'claude-sonnet-5-5'], 'refresh retains configured defaults and adds discovered models');
assert.deepEqual(connections, beforeRefresh, 'catalog refresh must preserve account secrets, errors and cooldowns');
await assert.rejects(refreshProviderModels('admin', oauthId, async () => new Response(null, { status: 429 })), /HTTP 429/);
assert.deepEqual(providers.find((provider) => provider.id === oauthId).models, ['m', 'claude-opus-5-5', 'claude-sonnet-5-5'], 'failed discovery must preserve the catalog');
await refreshProviderModels('admin', oauthId, async (url, init) => {
  providers.find((provider) => provider.id === oauthId).models = ['new-default', 'custom-model'];
  return modelResponse(url, init);
});
assert.deepEqual(providers.find((provider) => provider.id === oauthId).models, ['new-default', 'custom-model', 'claude-opus-5-5', 'claude-sonnet-5-5'], 'refresh merges against the current catalog, preserving concurrent model edits');
const currentModels = [...providers.find((provider) => provider.id === oauthId).models];
await assert.rejects(refreshProviderModels('admin', oauthId, async (url, init) => {
  providers.find((provider) => provider.id === oauthId).baseUrl = 'https://8.8.4.4';
  return modelResponse(url, init);
}), /configuration changed/);
assert.deepEqual(providers.find((provider) => provider.id === oauthId).models, currentModels, 'models from a previous upstream must not be saved after a configuration change');
providers.find((provider) => provider.id === oauthId).baseUrl = 'https://1.1.1.1';
process.env.DEVONE_AI_CODEX_CLIENT_ID = 'codex-test-client';
const codexId = await saveProvider('admin', { ...input, name: 'Codex profile', providerType: 'codex', authType: 'oauth', format: 'openai-responses', alias: 'cx-test', models: ['gpt-6-astra'] });
connections.push({ id: 'codex-account', providerId: codexId, authType: 'oauth', isActive: true, encryptedApiKey: null, encryptedAccessToken: encryptSecret('codex-secret', key), encryptedRefreshToken: null, encryptedIdToken: null, expiresAt: null, lastRefreshAt: null, providerSpecificData: { oauthConfigHash: oauthConfigFingerprint('codex', getProviderDefinition('codex').oauth), upstreamBaseUrl: input.baseUrl, chatgptAccountId: 'workspace-1' } });
const codexModels = await fetchProviderModels('admin', { providerId: codexId, baseUrl: input.baseUrl }, async (url, init) => {
  const h = new Headers(init.headers);
  assert.equal(h.get('authorization'), 'Bearer codex-secret');
  assert.equal(h.get('chatgpt-account-id'), 'workspace-1');
  assert.equal(h.get('originator'), 'codex_cli_rs');
  assert.equal(new URL(url).searchParams.get('client_version'), '0.159.0');
  return Response.json({ models: [{ slug: 'gpt-6.1-sol' }, { slug: 'gpt-6-astra' }, { slug: 'gpt-image-2.5', kind: 'image' }, { slug: 'gpt-5.6-sol-image' }, { slug: 'gpt-6.1-sol' }] });
});
assert.deepEqual(codexModels, ['gpt-6-astra', 'gpt-6.1-sol'], 'native Codex catalog uses slug IDs and excludes image-only entries');
await assert.rejects(fetchProviderModels('admin', { providerId, baseUrl: 'https://1.1.1.1' }, async () => { throw new Error('must not fetch'); }), /saved provider URL/);
const state = await loadRouterState();
assert.equal(state.providers.find((entry) => entry.id === oauthId).authHeader, 'x-api-key');
console.log('AI service authorization, namespace, persistence and discovery checks passed');

let forwarded;
const afterTasks = [];
mock.module('../src/lib/auth/session.ts', () => ({ getCurrentUser: async () => ({ id: 'admin' }) }));
mock.module('next/server', () => ({ after: (work) => { afterTasks.push(work); } }));
mock.module('../src/lib/ai-router/forward.ts', () => ({
  routerError: (status, message, code) => Response.json({ error: { message, code } }, { status }),
  forwardChatCompletion: async (options) => {
    forwarded = options;
    options.onFinish({ target: null, status: 200, attempts: 0, usage: { promptTokens: null, completionTokens: null }, error: null });
    return Response.json({ ok: true });
  }
}));
database.aiUsage = { create: async () => ({ id: 'usage' }) };
const { handleChatCompletion } = await import('../src/features/ai-router/request.ts');
const request = (body, headers = {}) => new Request('https://devone.example/api/ai/v1/responses', { method: 'POST', body: JSON.stringify(body), headers: { host: 'devone.example', origin: 'https://devone.example', ...headers } });
const nativeBody = { model: 'Token/m', input: 'Hello', reasoning: { effort: 'low' }, include: ['reasoning.encrypted_content'] };
const nativeAnswer = await handleChatCompletion(request(nativeBody), 'openai-responses');
assert.equal(nativeAnswer.status, 200, 'native options must reach a native upstream without Chat-only prevalidation');
assert.deepEqual(forwarded.body.reasoning, nativeBody.reasoning);
const wrongKey = await handleChatCompletion(request(nativeBody, { authorization: 'Bearer provider-secret' }), 'openai-responses');
assert.equal(wrongKey.status, 401, 'a supplied wrong gateway key must not fall back to browser cookies');
providers.find((entry) => entry.id === 'a').enabled = false;
database.aiRouterSettings.findUnique = async () => ({ defaultModel: 'Token/m', compressToolOutput: true, maxToolOutputChars: 30000 });
const disabledAnswer = await handleChatCompletion(request({ model: 'Alpha/m', messages: [{ role: 'user', content: 'Hello' }] }));
assert.equal(disabledAnswer.status, 200);
assert.equal(forwarded.body.model, 'Alpha/m');
assert.equal(forwarded.targets.length, 0, 'a known disabled provider must not silently switch to a paid default');
await Promise.all(afterTasks.map((work) => work()));
console.log('AI request native passthrough, gateway authentication and default-model checks passed');
