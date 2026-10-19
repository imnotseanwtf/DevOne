import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { createHash } from 'node:crypto';

// Keep real onboarding/authorization code; replace only database and audit I/O.
let providers = [];
let sessions = [];
let accounts = [];
const database = {
  user: { findUnique: async ({ where }) => ({ role: ['admin','other-admin'].includes(where.id) ? 'ADMIN' : 'MEMBER' }) },
  aiProvider: {
    findMany: async ({ where } = {}) => providers.filter(provider => !where || (where.NOT ? provider.id !== where.NOT.id : provider.providerType === where.providerType)),
    findUnique: async ({ where }) => providers.find(provider => provider.id === where.id) ?? null,
    create: async ({ data }) => { const row = { id: `provider-${providers.length}`, ...data }; providers.push(row); return row; }
  },
  aiOAuthSession: {
    findUnique: async ({ where }) => sessions.find(session => session.stateHash === where.stateHash) ?? null,
    deleteMany: async ({ where }) => { const old = sessions.length; sessions = where.id ? sessions.filter(session => !(session.id === where.id && session.userId === where.userId && session.providerId === where.providerId && session.expiresAt > where.expiresAt.gt)) : []; return { count: old - sessions.length }; },
    create: async ({ data }) => { const row = { id: 'session-' + sessions.length, ...data }; sessions.push(row); return row; }
  },
  aiConnection: { create: async ({ data }) => { accounts.push(data); return data; } },
  $executeRaw: async () => 1,
  $transaction: async work => work(database)
};
mock.module('../src/lib/db/prisma.ts', () => ({ getPrisma: () => database }));
mock.module('../src/lib/audit/record.ts', () => ({ recordAudit: async () => undefined }));
let loopbackStarts = 0;
mock.module('../src/features/ai-router/codex-loopback.ts', () => ({ CODEX_LOOPBACK_URI: 'http://localhost:1455/auth/callback', ensureCodexLoopbackListener: async () => { loopbackStarts++; } }));
let devicePending = true;
let deviceRequests = 0;
mock.module('../src/lib/ai-router/device-auth.ts', () => ({
  requestCodexDeviceCode: async () => { deviceRequests++; return { deviceAuthId: 'private-device-id', userCode: 'ABCD-1234', intervalMs: 5000, verificationUrl: 'https://8.8.8.8/codex/device', redirectUri: 'https://8.8.8.8/deviceauth/callback' }; },
  pollCodexDeviceCode: async () => devicePending ? null : { code: 'device-grant', verifier: 'device-pkce-verifier' }
}));
process.env.DEVONE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.DEVONE_APP_URL = 'http://localhost:3000';
process.env.DEVONE_AI_CLAUDE_CLIENT_ID = 'local-installed-client';
process.env.DEVONE_AI_CLAUDE_AUTHORIZE_URL = 'https://8.8.8.8/authorize';
process.env.DEVONE_AI_CLAUDE_TOKEN_URL = 'https://8.8.8.8/token';
process.env.DEVONE_AI_CLAUDE_BASE_URL = 'https://8.8.8.8/v1';
// Exercises the native loopback route without trusting callback URLs from browser input.
process.env.DEVONE_AI_CLAUDE_REDIRECT_URI = 'http://localhost:3000/callback';
const { connectOAuthProvider, finishProviderOAuth, getPendingOAuthConnection, completeHostedOAuth } = await import('../src/features/ai-router/oauth-service.ts');
assert.equal(typeof connectOAuthProvider, 'function', 'choosing Claude must start onboarding without a provider form');
await assert.rejects(connectOAuthProvider('member', 'claude'), /Administrators only/);
assert.equal(providers.length, 0, 'non-admins cannot auto-create providers');
const url = new URL(await connectOAuthProvider('admin', 'claude'));
assert.equal(url.pathname, '/authorize');
assert.equal(url.searchParams.get('client_id'), 'local-installed-client');
assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/callback');
assert.equal(providers.length, 1);
assert.equal(providers[0].providerType, 'claude');
assert.equal(providers[0].authType, 'oauth');
assert.ok(providers[0].models.length, 'the provider can route models after connection');
assert.equal(sessions[0].userId, 'admin');
assert.equal(sessions[0].providerId, providers[0].id);
assert.equal(sessions[0].stateHash, createHash('sha256').update(url.searchParams.get('state')).digest('hex'));
await connectOAuthProvider('admin', 'claude');
assert.equal(providers.length, 1, 'adding another account reuses the existing provider');
process.env.DEVONE_AI_CLAUDE_REDIRECT_URI = 'https://unrelated.example/callback';
await assert.rejects(connectOAuthProvider('admin', 'claude'), /callback address/);
process.env.DEVONE_AI_CLAUDE_REDIRECT_URI = 'http://localhost:3000/callback';
delete process.env.DEVONE_AI_CLAUDE_CLIENT_ID;
delete process.env.DEVONE_AI_CLAUDE_REDIRECT_URI;
const nativeClaudeUrl = new URL(await connectOAuthProvider('admin', 'claude'));
assert.equal(nativeClaudeUrl.pathname, '/router/connect');
const nativeClaudeDetails = await getPendingOAuthConnection('admin', nativeClaudeUrl.searchParams.get('state'));
const claudeAuthorize = new URL(nativeClaudeDetails.url);
assert.equal(claudeAuthorize.searchParams.get('client_id'), '9d1c250a-e61b-44d9-88ed-5944d1962f5e');
assert.equal(claudeAuthorize.searchParams.get('redirect_uri'), 'https://platform.claude.com/oauth/code/callback');
assert.equal(nativeClaudeDetails.flow, 'code');
await assert.rejects(getPendingOAuthConnection('other-admin', nativeClaudeUrl.searchParams.get('state')), /expired/);
process.env.DEVONE_APP_URL = 'http://localhost:3100';
const movedClaudeUrl = new URL(await connectOAuthProvider('admin', 'claude'));
assert.equal(movedClaudeUrl.origin, 'http://localhost:3100');
assert.equal(new URL((await getPendingOAuthConnection('admin', movedClaudeUrl.searchParams.get('state'))).url).searchParams.get('redirect_uri'), 'https://platform.claude.com/oauth/code/callback', 'the bundled Claude client keeps its registered callback when the app moves');
process.env.DEVONE_AI_CLAUDE_CLIENT_ID = 'separately-registered-client';
const registeredClaudeUrl = new URL(await connectOAuthProvider('admin', 'claude'));
assert.equal(registeredClaudeUrl.searchParams.get('redirect_uri'), `http://localhost:3100/api/ai/oauth/${providers[0].id}/callback`);
process.env.DEVONE_APP_URL = 'http://localhost:3000';
assert.equal(providers.length, 1, 'built-in defaults reuse the provider');
await assert.rejects(connectOAuthProvider('admin', 'openai'), /OAuth/);
delete process.env.DEVONE_AI_CODEX_CLIENT_ID;
process.env.DEVONE_AI_CODEX_AUTHORIZE_URL = 'https://8.8.8.8/authorize';
process.env.DEVONE_AI_CODEX_TOKEN_URL = 'https://8.8.8.8/token';
delete process.env.DEVONE_AI_CODEX_REDIRECT_URI;
const codexUrl = new URL(await connectOAuthProvider('admin', 'codex'));
assert.equal(codexUrl.searchParams.get('client_id'), 'app_EMoamEEZ73f0CkXaXp7hrann');
assert.equal(codexUrl.searchParams.get('redirect_uri'), 'http://localhost:1455/auth/callback');
assert.equal(loopbackStarts, 1, 'the callback listener must start before browser authorization');
assert.equal(codexUrl.searchParams.get('codex_cli_simplified_flow'), 'true');
process.env.DEVONE_APP_URL = 'https://remote.example';
const remoteCodexUrl = new URL(await connectOAuthProvider('admin', 'codex'));
assert.equal(remoteCodexUrl.origin, 'https://remote.example');
assert.equal(remoteCodexUrl.pathname, '/router/connect');
assert.equal(deviceRequests, 1);
assert.equal(loopbackStarts, 1, 'hosted Codex sign-in must not open a server socket');
const deviceDetails = await getPendingOAuthConnection('admin', remoteCodexUrl.searchParams.get('state'));
assert.equal(deviceDetails.flow, 'device');
assert.equal(deviceDetails.userCode, 'ABCD-1234');
assert.ok(!JSON.stringify(deviceDetails).includes('private-device-id'), 'the polling credential must remain on the server');
process.env.DEVONE_APP_URL = 'http://localhost:3000';
process.env.DEVONE_AI_CODEX_REDIRECT_URI = 'http://localhost:1455/other';
await assert.rejects(connectOAuthProvider('admin', 'codex'), /callback/);
assert.equal(loopbackStarts, 1, 'invalid native callbacks must not start a listener');
process.env.DEVONE_AI_CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const finalCodexUrl = new URL(await connectOAuthProvider('admin', 'codex'));
const oauthPrimitives = await import('../src/lib/ai-router/oauth.ts');
let exchanges = 0;
let expectedClient = 'app_EMoamEEZ73f0CkXaXp7hrann';
let expectedCode = 'one-time-code';
let expectedRedirect = 'http://localhost:1455/auth/callback';
const idToken = 'header.' + Buffer.from(JSON.stringify({ email: 'test@example.org', 'https://api.openai.com/auth': { chatgpt_account_id: 'workspace-1' } })).toString('base64url') + '.signature';
mock.module('../src/lib/ai-router/oauth.ts', () => ({ ...oauthPrimitives, exchangeProviderCode: async (config, code, redirectUri, verifier) => {
  exchanges++;
  assert.equal(config.clientId, expectedClient);
  assert.equal(code, expectedCode);
  assert.equal(redirectUri, expectedRedirect);
  assert.ok(typeof verifier === 'string' && verifier.length > 10);
  return { accessToken: 'codex-access', refreshToken: 'codex-refresh', idToken, expiresAt: new Date(Date.now() + 3600_000) };
} }));
const codexProvider = providers.find(provider => provider.providerType === 'codex');
const state = finalCodexUrl.searchParams.get('state');
await assert.rejects(finishProviderOAuth('other-admin', codexProvider.id, state, 'one-time-code'), /expired/);
assert.equal(exchanges, 0, 'a different administrator cannot claim another user\'s OAuth state');
await finishProviderOAuth('admin', codexProvider.id, state, 'one-time-code');
assert.equal(exchanges, 1);
assert.equal(accounts.length, 1);
assert.equal(accounts[0].providerSpecificData.chatgptAccountId, 'workspace-1');
assert.equal(accounts[0].name, 'test@example.org');
assert.notEqual(accounts[0].encryptedAccessToken, 'codex-access');
assert.notEqual(accounts[0].encryptedRefreshToken, 'codex-refresh');
const { decryptSecret, getEncryptionKey } = await import('../src/lib/encryption/secrets.ts');
assert.equal(decryptSecret(accounts[0].encryptedAccessToken, getEncryptionKey()), 'codex-access');
await assert.rejects(finishProviderOAuth('admin', codexProvider.id, state, 'one-time-code'), /expired|already used/);
assert.equal(exchanges, 1, 'replaying a consumed callback cannot exchange the grant again');

process.env.DEVONE_APP_URL = 'https://dev-one.bantaybenta.store';
const hosted = new URL(await connectOAuthProvider('admin', 'codex'));
const hostedState = hosted.searchParams.get('state');
await assert.rejects(completeHostedOAuth('other-admin', hostedState), /expired/);
const hostedSession = sessions.find(session => session.stateHash === createHash('sha256').update(hostedState).digest('hex'));
assert.ok(!hostedSession.encryptedCodeVerifier.includes('private-device-id'));
const originalExpiry = hostedSession.expiresAt;
hostedSession.expiresAt = new Date(0);
await assert.rejects(completeHostedOAuth('admin', hostedState), /expired/);
hostedSession.expiresAt = originalExpiry;
process.env.DEVONE_AI_CODEX_TOKEN_URL = 'https://8.8.4.4/token';
await assert.rejects(getPendingOAuthConnection('admin', hostedState), /configuration changed/);
process.env.DEVONE_AI_CODEX_TOKEN_URL = 'https://8.8.8.8/token';
assert.equal(await completeHostedOAuth('admin', hostedState), false);
assert.equal(exchanges, 1, 'pending device approval must not exchange a token');
expectedCode = 'device-grant';
expectedRedirect = 'https://8.8.8.8/deviceauth/callback';
devicePending = false;
const completed = await Promise.allSettled([completeHostedOAuth('admin', hostedState), completeHostedOAuth('admin', hostedState)]);
assert.equal(completed.filter(result => result.status === 'fulfilled' && result.value).length, 1);
assert.equal(exchanges, 2, 'concurrent device completions must exchange a grant only once');
assert.equal(accounts.length, 2);
await assert.rejects(completeHostedOAuth('admin', hostedState), /expired|already used/);

delete process.env.DEVONE_AI_CLAUDE_CLIENT_ID;
const hostedClaude = new URL(await connectOAuthProvider('admin', 'claude'));
const claudeState = hostedClaude.searchParams.get('state');
assert.equal(hostedClaude.origin, 'https://dev-one.bantaybenta.store');
assert.equal(hostedClaude.pathname, '/router/connect');
await assert.rejects(completeHostedOAuth('admin', claudeState, 'grant#wrong-state'), /code|state/);
assert.equal(exchanges, 2);
expectedClient = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
expectedCode = 'claude-grant';
expectedRedirect = 'https://platform.claude.com/oauth/code/callback';
assert.equal(await completeHostedOAuth('admin', claudeState, `claude-grant#${claudeState}`), true);
assert.equal(accounts.length, 3);
await assert.rejects(completeHostedOAuth('admin', claudeState, `claude-grant#${claudeState}`), /expired|already used/);
process.env.DEVONE_AI_CLAUDE_REDIRECT_URI = 'https://dev-one.bantaybenta.store/callback';
await assert.rejects(connectOAuthProvider('admin', 'claude'), /registered code callback/);
process.env.DEVONE_AI_CODEX_REDIRECT_URI = 'https://dev-one.bantaybenta.store/callback';
await assert.rejects(connectOAuthProvider('admin', 'codex'), /registered callback/);
console.log('Hosted Claude/Codex checks passed: registered callback, no remote listener, encrypted device state, user binding, pending approval and single-use grants');
console.log('Codex PKCE completion checks passed: user binding, one-time claim, workspace metadata and encrypted credentials');
console.log('Direct OAuth onboarding, administrator authorization and provider reuse checks passed');
