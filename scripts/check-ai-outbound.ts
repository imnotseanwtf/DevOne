import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { safeGatewayFetch } from '../src/lib/ai-router/outbound';

let requests = 0;
const server = createServer((request, response) => {
  requests++;
  if (request.url === '/redirect') {
    response.writeHead(302, { location: '/echo' });
    response.end();
  } else if (request.url === '/gzip') {
    response.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
    response.end(gzipSync('{"ok":true}'));
  } else if (request.url === '/stall') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.flushHeaders();
  } else {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ body, auth: request.headers.authorization })); });
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const host = `devone-pinned.invalid:${address.port}`;
const previous = process.env.DEVONE_AI_ALLOWED_HOSTS;
process.env.DEVONE_AI_ALLOWED_HOSTS = host;
let resolutions = 0;
const resolveHost = async () => { resolutions++; return ['127.0.0.1']; };
try {
  const response = await safeGatewayFetch(`http://${host}/echo`, { method: 'POST', headers: { authorization: 'Bearer test-only-token' }, body: '{"hello":1}' }, resolveHost);
  assert.deepEqual(await response.json(), { body: '{"hello":1}', auth: 'Bearer test-only-token' });
  assert.equal(resolutions, 1, 'the socket reuses the validated address without a second DNS lookup');
  const before = requests;
  await assert.rejects(safeGatewayFetch(`http://${host}/redirect`, {}, resolveHost), /redirects/);
  assert.equal(requests, before + 1, 'redirect must not forward a credential to a second destination');
  const compressed = await safeGatewayFetch(`http://${host}/gzip`, {}, resolveHost);
  assert.deepEqual(await compressed.json(), { ok: true });
  const controller = new AbortController();
  const stalled = await safeGatewayFetch(`http://${host}/stall`, { signal: controller.signal }, resolveHost);
  const reading = stalled.text();
  controller.abort();
  await assert.rejects(reading);
  console.log('AI outbound pinning, redirect, compression and cancellation checks passed');
} finally {
  if (previous === undefined) delete process.env.DEVONE_AI_ALLOWED_HOSTS;
  else process.env.DEVONE_AI_ALLOWED_HOSTS = previous;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
