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
process.env.DEVONE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.DEVONE_APP_URL = 'http://localhost:3000';
process.env.DEVONE_AI_CLAUDE_CLIENT_ID = 'local-installed-client';
process.env.DEVONE_AI_CLAUDE_AUTHORIZE_URL = 'https://8.8.8.8/authorize';
process.env.DEVONE_AI_CLAUDE_TOKEN_URL = 'https://8.8.8.8/token';
process.env.DEVONE_AI_CLAUDE_BASE_URL = 'https://8.8.8.8/v1';
// Exercises the native loopback route without trusting callback URLs from browser input.
process.env.DEVONE_AI_CLAUDE_REDIRECT_URI = 'http://localhost:3000/callback';
const { connectOAuthProvider, finishProviderOAuth } = await import('../src/features/ai-router/oauth-service.ts');
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
assert.equal(nativeClaudeUrl.searchParams.get('client_id'), '9d1c250a-e61b-44d9-88ed-5944d1962f5e');
assert.equal(nativeClaudeUrl.searchParams.get('redirect_uri'), 'http://localhost:3000/callback');
process.env.DEVONE_APP_URL = 'http://localhost:3100';
const movedClaudeUrl = new URL(await connectOAuthProvider('admin', 'claude'));
assert.equal(movedClaudeUrl.searchParams.get('redirect_uri'), 'http://localhost:3100/callback', 'Claude uses the configured app port');
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
await assert.rejects(connectOAuthProvider('admin', 'codex'), /local/);
process.env.DEVONE_APP_URL = 'http://localhost:3000';
process.env.DEVONE_AI_CODEX_REDIRECT_URI = 'http://localhost:1455/other';
await assert.rejects(connectOAuthProvider('admin', 'codex'), /callback address/);
assert.equal(loopbackStarts, 1, 'invalid native callbacks must not start a listener');
process.env.DEVONE_AI_CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const oauthPrimitives = await import('../src/lib/ai-router/oauth.ts');
let exchanges = 0;
const idToken = 'header.' + Buffer.from(JSON.stringify({ email: 'test@example.org', 'https://api.openai.com/auth': { chatgpt_account_id: 'workspace-1' } })).toString('base64url') + '.signature';
mock.module('../src/lib/ai-router/oauth.ts', () => ({ ...oauthPrimitives, exchangeProviderCode: async (config, code, redirectUri, verifier) => {
  exchanges++;
  assert.equal(config.clientId, 'app_EMoamEEZ73f0CkXaXp7hrann');
  assert.equal(code, 'one-time-code');
  assert.equal(redirectUri, 'http://localhost:1455/auth/callback');
  assert.ok(typeof verifier === 'string' && verifier.length > 32);
  return { accessToken: 'codex-access', refreshToken: 'codex-refresh', idToken, expiresAt: new Date(Date.now() + 3600_000) };
} }));
const codexProvider = providers.find(provider => provider.providerType === 'codex');
const state = codexUrl.searchParams.get('state');
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
console.log('Codex PKCE completion checks passed: user binding, one-time claim, workspace metadata and encrypted credentials');
console.log('Direct OAuth onboarding, administrator authorization and provider reuse checks passed');
