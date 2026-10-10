import assert from 'node:assert/strict';
import { selectConnections } from '../src/lib/ai-router/selection';
import {
  assertGatewayUrl,
  compressToolMessages,
  readGatewayBody,
  validOAuthSession
} from '../src/lib/ai-router/security';

const resolve = async () => ['127.0.0.1'];
await assert.rejects(assertGatewayUrl('http://localhost:11434/v1', [], resolve));
await assertGatewayUrl('http://localhost:11434/v1', ['localhost:11434'], resolve);
await assert.rejects(assertGatewayUrl('http://169.254.169.254/latest', ['169.254.169.254'], resolve));
await assert.rejects(assertGatewayUrl('https://private.example', [], resolve));
await assert.rejects(assertGatewayUrl('http://[::ffff:a9fe:a9fe]/', ['[::ffff:a9fe:a9fe]'], async () => ['::ffff:a9fe:a9fe']));
await assertGatewayUrl('https://public.example/v1', [], async () => ['8.8.8.8']);

assert.deepEqual(await readGatewayBody(new Request('https://devone.test', { method: 'POST', body: '{"model":"m"}' })), { model: 'm' });
await assert.rejects(readGatewayBody(new Request('https://devone.test', { method: 'POST', body: 'not json' })), { status: 400 });
await assert.rejects(readGatewayBody(new Request('https://devone.test', { method: 'POST', body: 'x'.repeat(101) }), 100), { status: 413 });
await assert.rejects(readGatewayBody(new Request('https://devone.test', { method: 'POST', body: '{}', headers: { 'content-length': '500' } }), 100), { status: 413 });

const original = { model: 'm', messages: [{ role: 'user', content: 'keep the whole question' }, { role: 'tool', tool_call_id: 'call-1', content: 'x'.repeat(200) }] };
const compressed = compressToolMessages(original, 100);
assert.equal(compressed.body.messages[0].content, original.messages[0].content);
assert.equal(compressed.body.messages[1].tool_call_id, 'call-1');
assert.ok(String(compressed.body.messages[1].content).length <= 100);
assert.ok(compressed.savedChars > 0);
assert.equal(original.messages[1].content.length, 200);
assert.deepEqual(compressToolMessages(original, 300).body, original);
const nativeClaude = { model: 'm', thinking: { type: 'enabled', budget_tokens: 1000 }, messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'x'.repeat(200), is_error: true }] }] };
const shortenedClaude = compressToolMessages(nativeClaude, 100);
assert.ok(shortenedClaude.savedChars > 0);
assert.deepEqual(shortenedClaude.body.thinking, nativeClaude.thinking);
assert.equal(shortenedClaude.body.messages[0].content[0].tool_use_id, 'tool-1');
assert.equal(shortenedClaude.body.messages[0].content[0].is_error, true);
const nativeResponses = { model: 'm', reasoning: { effort: 'low' }, input: [{ type: 'function_call_output', call_id: 'tool-1', output: 'x'.repeat(200) }] };
const shortenedResponses = compressToolMessages(nativeResponses, 100);
assert.ok(shortenedResponses.savedChars > 0);
assert.deepEqual(shortenedResponses.body.reasoning, nativeResponses.reasoning);
assert.equal(shortenedResponses.body.input[0].call_id, 'tool-1');

const now = new Date('2026-10-08T00:00:00Z');
const session = { providerId: 'p', userId: 'u', stateHash: 'hash', expiresAt: new Date(now.getTime() + 1000) };
assert.equal(validOAuthSession(session, 'p', 'u', 'hash', now), true);
assert.equal(validOAuthSession(session, 'other', 'u', 'hash', now), false);
assert.equal(validOAuthSession(session, 'p', 'other', 'hash', now), false);
assert.equal(validOAuthSession(session, 'p', 'u', 'wrong', now), false);
assert.equal(validOAuthSession(session, 'p', 'u', 'hash', new Date(now.getTime() + 1000)), false);
console.log('AI gateway security and settings checks passed');

const accounts = [
  { id: 'a', priority: 20, isActive: true, allowedModels: [], rateLimitedUntil: null, modelLocks: {} },
  { id: 'b', priority: 10, isActive: true, allowedModels: ['m'], rateLimitedUntil: null, modelLocks: {} },
  { id: 'c', priority: 1, isActive: true, allowedModels: [], rateLimitedUntil: new Date(now.getTime() + 1000), modelLocks: {} },
  { id: 'd', priority: 1, isActive: false, allowedModels: [], rateLimitedUntil: null, modelLocks: {} },
  { id: 'e', priority: 1, isActive: true, allowedModels: [], rateLimitedUntil: null, modelLocks: { m: new Date(now.getTime() + 1000).toISOString() } }
];
assert.deepEqual(selectConnections(accounts, 'm', new Set(), now).map((account) => account.id), ['b', 'a']);
assert.deepEqual(selectConnections(accounts, 'm', new Set(['b']), now).map((account) => account.id), ['a']);
assert.deepEqual(selectConnections(accounts, 'other', new Set(), now).map((account) => account.id), ['e', 'a']);
assert.deepEqual(selectConnections(accounts, 'm', new Set(), new Date(now.getTime() + 2000)).map((account) => account.id), ['c', 'e', 'b', 'a']);
console.log('AI account selection checks passed');
