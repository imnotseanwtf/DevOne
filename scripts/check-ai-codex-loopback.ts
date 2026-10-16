import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse, RequestListener } from 'node:http';
const loopback = await import('../src/features/ai-router/codex-loopback').catch(() => null);
assert.ok(loopback, 'Codex needs its native loopback callback relay');
const { createHash } = await import('node:crypto');
const state = 'valid-state';
const hash = createHash('sha256').update(state).digest('hex');
let session = { providerId: 'codex-provider', provider: { providerType: 'codex' }, redirectUri: 'http://localhost:1455/auth/callback', expiresAt: new Date(Date.now() + 60_000) };
const server = loopback.createCodexLoopbackServer('http://localhost:3000', async (stateHash) => stateHash === hash ? session : null);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
async function callback(query: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${base}/auth/callback?${query}`, { redirect: 'manual', ...options });
}
try {
  let malformedStatus = 0;
  const handler = server.listeners('request')[0] as RequestListener;
  await assert.doesNotReject(async () => {
    await handler({ method: 'GET', url: 'http://[', headers: { host: 'localhost:1455' } } as IncomingMessage, { setHeader() {}, writeHead(status: number) { malformedStatus = status; }, end() {} } as unknown as ServerResponse);
  }, 'Malformed absolute request targets must not reject the async server handler');
  assert.equal(malformedStatus, 400);
  const accepted = await callback(`state=${state}&code=one-time-code`, { headers: { host: 'localhost:1455' } });
  assert.equal(accepted.status, 302);
  assert.equal(accepted.headers.get('location'), 'http://localhost:3000/api/ai/oauth/codex-provider/callback?state=valid-state&code=one-time-code');
  assert.equal(accepted.headers.get('cache-control'), 'no-store');
  assert.equal(accepted.headers.get('referrer-policy'), 'no-referrer');
  for (const query of ['state=unknown&code=x', 'code=x', `state=${state}`, `state=${state}&code=${'x'.repeat(10001)}`]) assert.equal((await callback(query, { headers: { host: 'localhost:1455' } })).status, 400);
  assert.equal((await callback(`state=${state}&code=x`, { headers: { host: 'attacker.example:1455' } })).status, 400);
  assert.equal((await callback(`state=${state}&code=x`, { method: 'POST', headers: { host: 'localhost:1455' } })).status, 404);
  assert.equal((await fetch(`${base}/other`, { headers: { host: 'localhost:1455' } })).status, 404);
  const cancelled = await callback(`state=${state}&error=access_denied`, { headers: { host: 'localhost:1455' } });
  assert.equal(cancelled.status, 302);
  assert.equal(new URL(cancelled.headers.get('location')!).searchParams.get('error'), 'access_denied');
  session = { ...session, expiresAt: new Date(Date.now() - 1) };
  assert.equal((await callback(`state=${state}&code=x`, { headers: { host: 'localhost:1455' } })).status, 400);
  session = { ...session, expiresAt: new Date(Date.now() + 60_000), provider: { providerType: 'claude' } };
  assert.equal((await callback(`state=${state}&code=x`, { headers: { host: 'localhost:1455' } })).status, 400);
  session = { ...session, provider: { providerType: 'codex' }, redirectUri: 'http://localhost:3000/callback' };
  assert.equal((await callback(`state=${state}&code=x`, { headers: { host: 'localhost:1455' } })).status, 400);
  assert.throws(() => loopback.createCodexLoopbackServer('https://remote.example', async () => null), /local/);
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
console.log('Codex callback relay checks passed: valid state, expiry, provider binding, local host and cancellation');
const { createServer } = await import('node:http');
const busy = createServer();
const ownsPort = await new Promise<boolean>((resolve, reject) => { busy.once('error', (error: NodeJS.ErrnoException) => error.code === 'EADDRINUSE' ? resolve(false) : reject(error)); busy.listen(1455, '127.0.0.1', () => resolve(true)); });
try {
  await assert.rejects(loopback.ensureCodexLoopbackListener('http://localhost:3000'), /port 1455/);
} finally {
  if (ownsPort) await new Promise<void>((resolve) => busy.close(() => resolve()));
}
console.log('Codex occupied callback port fails safely without closing the other listener');
