import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { createHash } from 'node:crypto';

// Keep real onboarding/authorization code; replace only database and audit I/O.
let providers = [];
let sessions = [];
const database = {
  user: { findUnique: async ({ where }) => ({ role: where.id === 'admin' ? 'ADMIN' : 'MEMBER' }) },
  aiProvider: {
    findMany: async ({ where } = {}) => providers.filter(provider => !where || (where.NOT ? provider.id !== where.NOT.id : provider.providerType === where.providerType)),
    findUnique: async ({ where }) => providers.find(provider => provider.id === where.id) ?? null,
    create: async ({ data }) => { const row = { id: `provider-${providers.length}`, ...data }; providers.push(row); return row; }
  },
  aiOAuthSession: {
    deleteMany: async () => { sessions = []; return { count: 0 }; },
    create: async ({ data }) => { sessions.push(data); return data; }
  },
  $executeRaw: async () => 1,
  $transaction: async work => work(database)
};
mock.module('../src/lib/db/prisma.ts', () => ({ getPrisma: () => database }));
mock.module('../src/lib/audit/record.ts', () => ({ recordAudit: async () => undefined }));
process.env.DEVONE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.DEVONE_APP_URL = 'http://localhost:3000';
process.env.DEVONE_AI_CLAUDE_CLIENT_ID = 'local-installed-client';
process.env.DEVONE_AI_CLAUDE_AUTHORIZE_URL = 'https://8.8.8.8/authorize';
process.env.DEVONE_AI_CLAUDE_TOKEN_URL = 'https://8.8.8.8/token';
process.env.DEVONE_AI_CLAUDE_BASE_URL = 'https://8.8.8.8/v1';
// Exercises the native loopback route without trusting callback URLs from browser input.
process.env.DEVONE_AI_CLAUDE_REDIRECT_URI = 'http://localhost:3000/callback';
const { connectOAuthProvider } = await import('../src/features/ai-router/oauth-service.ts');
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
await assert.rejects(connectOAuthProvider('admin', 'claude'), /not configured/);
assert.equal(providers.length, 1, 'missing OAuth configuration must not create providers');
await assert.rejects(connectOAuthProvider('admin', 'openai'), /OAuth/);
console.log('Direct OAuth onboarding, administrator authorization and provider reuse checks passed');
