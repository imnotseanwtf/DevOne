import assert from 'node:assert/strict';
import { forwardChatCompletion, type ForwardOutcome } from '../src/lib/ai-router/forward';
import type { RouteTarget } from '../src/lib/ai-router/routing';

const target = (id: string, extra = {}): RouteTarget => ({
  provider: { id, name: id, baseUrl: `https://${id}.example/v1`, models: ['m'], priority: 0, enabled: true, cooldownUntil: null, ...extra },
  model: 'm'
});
const encoder = new TextEncoder();
function sse(text: string, split = 7): Response {
  const bytes = encoder.encode(text);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
const chatBody = { model: 'm', messages: [{ role: 'user', content: 'Hello' }] };

// 9Router's Claude Code system block is required by consumer OAuth inference.
const claudeCodePrompt = "You are Claude Code, Anthropic's official CLI for Claude.";
for (const system of [undefined, 'Be concise', [{ type: 'text', text: 'Be concise', cache_control: { type: 'ephemeral' } }], [{ type: 'text', text: claudeCodePrompt }, { type: 'text', text: 'Be concise' }]]) {
  const body = { model: 'm', max_tokens: 8, messages: [{ role: 'user', content: 'Hello' }], tools: [{ name: 'weather', input_schema: { type: 'object' } }], ...(system === undefined ? {} : { system }) };
  const original = structuredClone(body);
  let sent: Record<string, unknown> | undefined;
  const response = await forwardChatCompletion({ body, sourceFormat: 'claude', targets: [target('claude-oauth', { providerType: 'claude', format: 'claude' })], apiKeyFor: () => null,
    credentialFor: async () => ({ id: 'oauth-account', providerId: 'claude-oauth', authType: 'oauth', accessToken: 'test-token' }),
    fetchImpl: (async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      const blocks = sent?.system as { type: string; text: string }[] | undefined;
      if (!Array.isArray(blocks) || !blocks.some((block) => block.type === 'text' && block.text === claudeCodePrompt)) return Response.json({ error: { type: 'rate_limit_error', message: 'Error' } }, { status: 429 });
      return Response.json({ id: 'msg', model: 'm', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
    }) as typeof fetch });
  assert.equal(response.status, 200, 'OAuth inference must include the 9Router Claude Code system block');
  const expected = system === undefined ? [] : typeof system === 'string' ? [{ type: 'text', text: system }] : system;
  assert.deepEqual(sent?.system, expected.some((block) => block.text === claudeCodePrompt) ? expected : [{ type: 'text', text: claudeCodePrompt }, ...expected]);
  assert.deepEqual(sent?.messages, body.messages);
  assert.deepEqual(sent?.tools, body.tools);
  assert.deepEqual(body, original, 'request preparation must not mutate the caller payload');
}

// Native Claude OAuth needs its beta header; API-key and custom transports keep their auth.
for (const [providerType, authType] of [['claude', 'oauth'], ['claude', 'access_token'], ['claude', 'api_key'], ['anthropic', 'api_key'], ['custom', 'oauth']] as const) {
  let sentHeaders: Headers | undefined, sentBody: Record<string, unknown> | undefined;
  const response = await forwardChatCompletion({ body: chatBody, targets: [target('claude-auth', { providerType, format: 'claude', headers: { 'anthropic-beta': 'other-beta' } })], apiKeyFor: () => null,
    credentialFor: async () => ({ id: 'account', providerId: 'claude-auth', authType, accessToken: 'test-token', apiKey: 'test-key' }),
    fetchImpl: (async (_url, init) => { sentHeaders = new Headers(init?.headers); sentBody = JSON.parse(String(init?.body)); return Response.json({ id: 'msg', model: 'm', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }); }) as typeof fetch });
  assert.equal(response.status, 200);
  const oauth = providerType === 'claude' && authType !== 'api_key';
  assert.deepEqual(sentBody?.system, oauth ? [{ type: 'text', text: claudeCodePrompt }] : undefined, 'the identity block applies only to native Claude token authentication');
  assert.equal(sentHeaders?.get('anthropic-beta'), oauth ? 'other-beta, oauth-2025-04-20' : 'other-beta');
  assert.equal(sentHeaders?.get(authType === 'api_key' ? 'x-api-key' : 'authorization'), authType === 'api_key' ? 'test-key' : 'Bearer test-token');
}

// HTTP 200 error frames must permit fallback before any output is committed.
{
  const response = await forwardChatCompletion({ body: { ...chatBody, stream: true }, targets: [target('a'), target('b')], apiKeyFor: () => null,
    fetchImpl: (async (url) => String(url).includes('a.example')
      ? sse('event: error\r\ndata: {"error":{"type":"overloaded_error","message":"Busy"}}\r\n\r\n')
      : sse('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n')) as typeof fetch });
  assert.equal(response.headers.get('x-devone-provider'), 'b', 'HTTP200 upstream errors must fall back');
  assert.match(await response.text(), /OK/);
}

// Headers alone are not an answer: a body that never emits bytes times out.
{
  let cancelled = false;
  const response = await forwardChatCompletion({ body: chatBody, targets: [target('a'), target('b')], apiKeyFor: () => null, timeoutMs: 15,
    fetchImpl: (async (url) => String(url).includes('a.example')
      ? new Response(new ReadableStream({ cancel() { cancelled = true; } }))
      : Response.json({ choices: [] })) as typeof fetch });
  assert.equal(response.headers.get('x-devone-provider'), 'b');
  assert.equal(cancelled, true);
}

const { translateRequest, translateResponse } = await import('../src/lib/ai-router/translation');
const fixture = { model: 'm', messages: [
  { role: 'system', content: 'Be precise' },
  { role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] },
  { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'weather', arguments: '{"city":"Manila"}' } }] },
  { role: 'tool', tool_call_id: 'call_1', content: 'Sunny' }
], tools: [{ type: 'function', function: { name: 'weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }], max_tokens: 80 };
const claude = translateRequest(fixture, 'openai', 'claude', 'native');
assert.deepEqual(claude.system, [{ type: 'text', text: 'Be precise' }]);
assert.equal(claude.model, 'native');
assert.equal(claude.max_tokens, 80);
assert.deepEqual((claude.messages as Record<string, unknown>[])[1].content, [{ type: 'tool_use', id: 'call_1', name: 'weather', input: { city: 'Manila' } }]);
assert.deepEqual((claude.messages as Record<string, unknown>[])[2].content, [{ type: 'tool_result', tool_use_id: 'call_1', content: [{ type: 'text', text: 'Sunny' }] }]);
const responses = translateRequest(fixture, 'openai', 'openai-responses', 'native');
assert.ok((responses.input as Record<string, unknown>[]).some((item) => item.type === 'function_call' && item.call_id === 'call_1' && item.arguments === '{"city":"Manila"}'));
assert.deepEqual(translateRequest(claude, 'claude', 'openai', 'm').messages, fixture.messages.map((message) => message.role === 'assistant' ? { ...message, content: null } : message));
assert.throws(() => translateRequest({ ...chatBody, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'x', format: 'wav' } }] }] }, 'openai', 'claude', 'm'), /Unsupported/);
assert.throws(() => translateRequest({ ...chatBody, response_format: { type: 'json_schema' } }, 'openai', 'claude', 'm'), /Unsupported/);
const answer = translateResponse({ id: 'msg_1', model: 'm', content: [{ type: 'text', text: 'Done' }, { type: 'tool_use', id: 'call_2', name: 'weather', input: { city: 'Manila' } }], stop_reason: 'tool_use', usage: { input_tokens: 7, output_tokens: 3 } }, 'claude', 'openai');
assert.equal(((answer.choices as Record<string, unknown>[])[0]).finish_reason, 'tool_calls');
assert.deepEqual(answer.usage, { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });

// Arbitrary UTF8/event boundaries, EOF residual and partial tool JSON survive.
{
  let outcome: ForwardOutcome | undefined;
  const events = [
    { type: 'message_start', message: { id: 'msg_1', model: 'm', usage: { input_tokens: 7, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'weather', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"city":' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"Manila🌤"}' } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } },
    { type: 'message_stop' }
  ];
  const response = await forwardChatCompletion({ body: { ...chatBody, stream: true }, targets: [target('claude', { format: 'claude' })], apiKeyFor: () => 'key', fetchImpl: (async () => sse(events.map((event) => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}`).join('\r\n\r\n'), 1)) as typeof fetch, onFinish(value) { outcome = value; } });
  const text = await response.text();
  const frames = text.split('\n').filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6)));
  const argumentsText = frames.flatMap((frame) => frame.choices ?? []).flatMap((choice) => choice.delta?.tool_calls ?? []).map((tool) => tool.function?.arguments ?? '').join('');
  assert.equal(argumentsText, '{"city":"Manila🌤"}');
  assert.equal(text.match(/\[DONE\]/g)?.length, 1);
  assert.deepEqual(outcome?.usage, { promptTokens: 7, completionTokens: 3 });
}

// A failed token refresh must fall back instead of being classified as client cancellation.
{
  let refreshes = 0;
  const failures: string[] = [];
  const response = await forwardChatCompletion({ body: chatBody, targets: [target('a'), target('b')], apiKeyFor: () => null,
    credentialFor: async (route) => ({ id: route.provider.id, providerId: route.provider.id, authType: 'oauth', accessToken: 'secret' }),
    refreshCredential: async () => { refreshes++; return null; }, onFailure: (failure) => { failures.push(failure.error); },
    fetchImpl: (async (url) => String(url).includes('a.example') ? Response.json({ error: { message: 'Expired' } }, { status: 401 }) : Response.json({ choices: [] })) as typeof fetch });
  assert.equal(response.headers.get('x-devone-provider'), 'b');
  assert.equal(refreshes, 1);
  assert.deepEqual(failures, ['Expired']);
}

// A no-argument Claude tool still has valid JSON arguments for a nonstream client.
{
  const events = [
    { type: 'message_start', message: { id: 'msg_empty', model: 'm', usage: { input_tokens: 2, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'empty', name: 'clock', input: {} } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' }
  ];
  const response = await forwardChatCompletion({ body: chatBody, sourceFormat: 'openai', targets: [target('a', { format: 'claude', forceStream: true })], apiKeyFor: () => null,
    fetchImpl: (async () => sse(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''))) as typeof fetch });
  const body = await response.json();
  assert.equal(body.choices[0].message.tool_calls[0].function.arguments, '{}');
}

// Once text was committed, a late upstream error is normalized and is never healthy usage.
{
  let outcome: ForwardOutcome | undefined;
  const failures: number[] = [];
  const response = await forwardChatCompletion({ body: { ...chatBody, stream: true }, targets: [target('a'), target('b')], apiKeyFor: () => 'sensitive-key',
    fetchImpl: (async () => sse('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\nevent: error\ndata: {"error":{"status":429,"message":"sensitive-key blocked"}}\n\n')) as typeof fetch,
    onFailure: (value) => { failures.push(value.status); }, onFinish: (value) => { outcome = value; } });
  const text = await response.text();
  assert.match(text, /Hi/); assert.match(text, /\[redacted\]/); assert.ok(!text.includes('sensitive-key'));
  assert.equal(text.match(/\[DONE\]/g)?.length, 1);
  assert.equal(outcome?.status, 429); assert.equal(outcome?.attempts, 1); assert.deepEqual(failures, [429]);
}

// Native Responses SSE converts tool IDs, argument fragments, finish reason and usage.
{
  const events = [
    { type: 'response.created', response: { id: 'resp_1', model: 'm' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_9', name: 'clock', arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{' },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '}' },
    { type: 'response.completed', response: { id: 'resp_1', model: 'm', status: 'completed', output: [], usage: { input_tokens: 11, output_tokens: 2 } } }
  ];
  const response = await forwardChatCompletion({ body: { ...chatBody, stream: true }, targets: [target('r', { format: 'openai-responses' })], apiKeyFor: () => null,
    fetchImpl: (async () => sse(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), 3)) as typeof fetch });
  const text = await response.text(); assert.match(text, /call_9/); assert.match(text, /tool_calls/); assert.match(text, /"prompt_tokens":11/);
  assert.equal(text.match(/\[DONE\]/g)?.length, 1);
}

// OAuth refresh uses the replacement token once and suppresses duplicate account/model attempts.
{
  let requests = 0, refreshes = 0;
  const auth: (string | null)[] = [];
  const response = await forwardChatCompletion({ body: chatBody, targets: [target('a'), target('a'), target('b')], apiKeyFor: () => null,
    credentialFor: async (route) => ({ id: route.provider.id, providerId: route.provider.id, authType: 'oauth', accessToken: 'old-token' }),
    refreshCredential: async (_route, failed) => { assert.equal(failed, 'old-token'); refreshes++; return { id: 'a', providerId: 'a', authType: 'oauth', accessToken: 'new-token' }; },
    fetchImpl: (async (_url, init) => { requests++; auth.push(new Headers(init?.headers).get('authorization')); return requests < 3 ? Response.json({ error: { message: 'Denied' } }, { status: 401 }) : Response.json({ choices: [] }); }) as typeof fetch });
  assert.equal(response.headers.get('x-devone-provider'), 'b'); assert.equal(refreshes, 1);
  assert.deepEqual(auth, ['Bearer old-token', 'Bearer new-token', 'Bearer old-token']);
}

// Malformed requests return 400 immediately without trying another account.
{
  let requests = 0;
  const response = await forwardChatCompletion({ body: chatBody, targets: [target('a'), target('b')], apiKeyFor: () => null,
    fetchImpl: (async () => { requests++; return Response.json({ error: { message: 'Invalid input' } }, { status: 400 }); }) as typeof fetch });
  assert.equal(response.status, 400); assert.equal(requests, 1);
}

// Stream idle timeout cancels an upstream body and reports a failed completion.
{
  let cancelled = false, outcome: ForwardOutcome | undefined;
  const response = await forwardChatCompletion({ body: { ...chatBody, stream: true }, targets: [target('a')], apiKeyFor: () => null, timeoutMs: 15,
    fetchImpl: (async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch,
    onFinish: (value) => { outcome = value; } });
  assert.match(await response.text(), /timed out/); assert.equal(cancelled, true); assert.equal(outcome?.status, 504);
}

// Cancelling the client body aborts the fetch and cancels the upstream reader.
{
  let aborted = false, cancelled = false, outcome: ForwardOutcome | undefined;
  const response = await forwardChatCompletion({ body: { ...chatBody, stream: true }, targets: [target('a')], apiKeyFor: () => null,
    fetchImpl: (async (_url, init) => { init?.signal?.addEventListener('abort', () => { aborted = true; }); return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }); }) as typeof fetch,
    onFinish: (value) => { outcome = value; } });
  await response.body!.cancel(); assert.equal(aborted, true); assert.equal(cancelled, true); assert.equal(outcome?.status, 499);
}

// Native clients receive native streaming events, not an OpenAI envelope.
for (const sourceFormat of ['claude', 'openai-responses'] as const) {
  const body = sourceFormat === 'claude' ? { model: 'm', max_tokens: 20, stream: true, messages: [{ role: 'user', content: 'Hello' }] } : { model: 'm', stream: true, input: 'Hello' };
  const response = await forwardChatCompletion({ body, sourceFormat, targets: [target('a')], apiKeyFor: () => null,
    fetchImpl: (async () => sse('data: {"id":"reply_1","model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\ndata: [DONE]\n\n')) as typeof fetch });
  const text = await response.text(); assert.match(text, sourceFormat === 'claude' ? /event: message_stop/ : /event: response.completed/); assert.match(text, /Hello/);
}

// Even an HTTP200 authentication error can refresh once before an answer is committed.
{
  let requests = 0, refreshes = 0;
  const response = await forwardChatCompletion({ body: { ...chatBody, stream: true }, targets: [target('a')], apiKeyFor: () => null,
    credentialFor: async () => ({ id: 'a', providerId: 'a', authType: 'oauth', accessToken: 'old' }),
    refreshCredential: async () => { refreshes++; return { id: 'a', providerId: 'a', authType: 'oauth', accessToken: 'new' }; },
    fetchImpl: (async () => { requests++; return requests === 1 ? sse('event: error\ndata: {"error":{"type":"authentication_error","message":"Expired"}}\n\n') : sse('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n'); }) as typeof fetch });
  assert.match(await response.text(), /OK/); assert.equal(refreshes, 1); assert.equal(requests, 2);
}

// Response content that cannot survive cross-protocol conversion fails instead of disappearing.
assert.throws(() => translateResponse({ id: 'r', model: 'm', content: [{ type: 'text', text: 'Claim', citations: [{ url: 'https://example.com' }] }], stop_reason: 'end_turn' }, 'claude', 'openai'), /Unsupported/);

// Responses function results containing images retain the native image_url field.
{
  const translated = translateRequest({ ...chatBody, messages: [{ role: 'tool', tool_call_id: 'c', content: [{ type: 'image_url', image_url: { url: 'https://example.com/image.png' } }] }] }, 'openai', 'openai-responses', 'm');
  assert.deepEqual((translated.input as Record<string, unknown>[])[0].output, [{ type: 'input_image', image_url: 'https://example.com/image.png' }]);
}

// Invalid native response structure is an upstream failure, so the next account may answer.
{
  const failures: number[] = [];
  const response = await forwardChatCompletion({ body: chatBody, targets: [target('a', { format: 'claude' }), target('b')], apiKeyFor: () => null,
    fetchImpl: (async (url) => String(url).includes('a.example') ? Response.json({ content: 'invalid', model: 'm' }) : Response.json({ choices: [] })) as typeof fetch,
    onFailure: (value) => { failures.push(value.status); } });
  assert.equal(response.headers.get('x-devone-provider'), 'b'); assert.deepEqual(failures, [502]);
}

// Codex uses its Responses contract and account header without adopting a first-party identity.
{
  let sentBody: Record<string, unknown> | undefined, sentHeaders: Headers | undefined;
  const response = await forwardChatCompletion({ body: { model: 'm', messages: [{ role: 'system', content: 'Be precise' }, { role: 'user', content: 'Hello' }] }, targets: [target('cx', { providerType: 'codex', format: 'openai-responses' })], apiKeyFor: () => null,
    credentialFor: async () => ({ id: 'cx', providerId: 'cx', authType: 'oauth', accessToken: 'codex-token', providerSpecificData: { chatgptAccountId: 'account-7' } }),
    fetchImpl: (async (_url, init) => { sentBody = JSON.parse(String(init?.body)); sentHeaders = new Headers(init?.headers); return sse('event: response.completed\ndata: {"type":"response.completed","response":{"id":"r","model":"m","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"OK","annotations":[]}]}],"usage":{"input_tokens":3,"output_tokens":1}}}\n\n'); }) as typeof fetch });
  assert.equal(response.status, 200); assert.equal(sentBody?.store, false); assert.equal(sentBody?.stream, true);
  assert.equal(sentBody?.instructions, 'You are a helpful assistant.');
  assert.equal((sentBody?.input as Record<string, unknown>[])[0].role, 'developer');
  assert.equal(sentHeaders?.get('chatgpt-account-id'), 'account-7'); assert.equal(sentHeaders?.get('authorization'), 'Bearer codex-token');
  assert.equal(sentHeaders?.get('originator'), 'codex_cli_rs'); assert.equal(sentHeaders?.get('user-agent'), 'codex_cli_rs/0.159.0');
  assert.equal(sentHeaders?.get('session_id'), 'cx');
  assert.equal(sentHeaders?.get('x-openai-internal-codex-responses-lite'), null);
  assert.equal((await response.json()).choices[0].message.content, 'OK');
}
// Current Sol/Luna models use Codex Responses Lite: instructions and tools move into input.
{
  const body = { model: 'gpt-6.1-sol', input: 'Hello', instructions: 'Be concise', tools: [{ type: 'function', name: 'weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }], include: ['reasoning.encrypted_content'] };
  const original = structuredClone(body);
  let sent: Record<string, unknown> | undefined, headers: Headers | undefined;
  const route = { ...target('codex-lite', { providerType: 'codex', format: 'openai-responses' }), model: 'gpt-6.1-sol' };
  const response = await forwardChatCompletion({ body, sourceFormat: 'openai-responses', targets: [route], apiKeyFor: () => null,
    credentialFor: async () => ({ id: 'lite-account', providerId: 'codex-lite', authType: 'oauth', accessToken: 'lite-token' }),
    fetchImpl: (async (_url, init) => { sent = JSON.parse(String(init?.body)); headers = new Headers(init?.headers); return sse('event: response.completed\ndata: {"type":"response.completed","response":{"id":"reply","model":"gpt-6.1-sol","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"OK","annotations":[]}]}],"usage":{"input_tokens":1,"output_tokens":1}}}\n\n'); }) as typeof fetch });
  assert.equal(response.status, 200);
  assert.equal(headers?.get('x-openai-internal-codex-responses-lite'), 'true');
  assert.equal(headers?.get('session_id'), 'lite-account');
  assert.equal(sent?.instructions, ''); assert.equal(sent?.tools, null);
  assert.deepEqual((sent?.input as unknown[]).slice(0,2), [{ type: 'additional_tools', role: 'developer', tools: body.tools }, { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Be concise' }] }]);
  assert.deepEqual((sent?.input as unknown[]).at(-1), { role: 'user', content: [{ type: 'input_text', text: 'Hello' }] });
  assert.deepEqual(sent?.include, body.include);
  assert.equal((sent?.reasoning as Record<string, unknown>)?.context, 'all_turns');
  assert.equal(sent?.store, false); assert.equal(sent?.stream, true);
  assert.deepEqual(body, original, 'Lite preparation must not mutate caller instructions/tools/input');
}
// A native Lite prefix and additional top-level tools must both survive preparation.
{
  const existing = { type: 'function', name: 'existing_tool', parameters: { type: 'object' } };
  const added = { type: 'function', name: 'new_tool', parameters: { type: 'object' } };
  const body = { model: 'gpt-6.1-sol', instructions: '', input: [{ type: 'additional_tools', role: 'developer', tools: [existing] }, { role: 'user', content: 'Hello' }], tools: [added] };
  const original = structuredClone(body);
  let sent: Record<string, unknown> | undefined;
  const route = { ...target('codex-lite', { providerType: 'codex', format: 'openai-responses' }), model: 'gpt-6.1-sol' };
  const response = await forwardChatCompletion({ body, sourceFormat: 'openai-responses', targets: [route], apiKeyFor: () => null,
    fetchImpl: (async (_url, init) => { sent = JSON.parse(String(init?.body)); return sse('event: response.completed\ndata: {"type":"response.completed","response":{"id":"reply","model":"gpt-6.1-sol","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1}}}\n\n'); }) as typeof fetch });
  assert.equal(response.status, 200);
  const prefixes = (sent?.input as Record<string, unknown>[]).filter((item) => item.type === 'additional_tools');
  assert.equal(prefixes.length, 1);
  assert.deepEqual(prefixes[0].tools, [existing, added]);
  assert.equal(sent?.tools, null);
  assert.deepEqual(body, original);
}
for (const option of ['temperature', 'top_p', 'max_output_tokens', 'store', 'tools']) {
  let fetched = false;
  const response = await forwardChatCompletion({ body: { model: 'm', input: 'Hello', [option]: option === 'store' ? true : option === 'tools' ? [{ type: 'web_search' }] : 1 }, sourceFormat: 'openai-responses', targets: [target('cx', { providerType: 'codex', format: 'openai-responses' })], apiKeyFor: () => null,
    fetchImpl: (async () => { fetched = true; return Response.json({}); }) as typeof fetch });
  assert.equal(response.status, 400, option); assert.equal(fetched, false, option);
}

// A rate-limited account cannot be retried with a different model during the same request.
{
  let requests = 0;
  const response = await forwardChatCompletion({ body: chatBody, targets: [target('a'), { ...target('a'), model: 'another' }, target('b')], apiKeyFor: () => null,
    fetchImpl: (async (url) => { requests++; return String(url).includes('a.example') ? Response.json({ error: { message: 'Limited' } }, { status: 429 }) : Response.json({ choices: [] }); }) as typeof fetch });
  assert.equal(response.headers.get('x-devone-provider'), 'b'); assert.equal(requests, 2);
}

// Normal Codex output may begin with hidden reasoning and visible reasoning summaries.
const reasoningEvents = [
  { type: 'response.created', sequence_number: 0, response: { id: 'resp_reason', model: 'm' } },
  { type: 'response.output_item.added', sequence_number: 1, output_index: 0, item: { id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'opaque-signature' } },
  { type: 'response.reasoning_summary_part.added', sequence_number: 2, output_index: 0, item_id: 'rs_1', summary_index: 0, part: { type: 'summary_text', text: '' } },
  { type: 'response.reasoning_summary_text.delta', sequence_number: 3, output_index: 0, item_id: 'rs_1', summary_index: 0, delta: 'Consider carefully.' },
  { type: 'response.output_text.delta', sequence_number: 3, output_index: 1, item_id: 'msg_1', content_index: 0, delta: 'OK' },
  { type: 'response.completed', sequence_number: 4, response: { id: 'resp_reason', model: 'm', status: 'completed', output: [{ id: 'rs_1', type: 'reasoning', summary: [{ type: 'summary_text', text: 'Consider carefully.' }], encrypted_content: 'opaque-signature' }, { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }], usage: { input_tokens: 8, output_tokens: 4 } } }
];
for (const stream of [false, true]) {
  const response = await forwardChatCompletion({ body: { ...chatBody, stream }, targets: [target('cx', { providerType: 'codex', format: 'openai-responses' })], apiKeyFor: () => null,
    fetchImpl: (async () => sse(reasoningEvents.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))) as typeof fetch });
  assert.equal(response.status, 200);
  if (stream) { const text = await response.text(); assert.match(text, /"reasoning_content":"Consider carefully\./); assert.match(text, /"content":"OK"/); assert.ok(!text.includes('upstream_error')); }
  else { const body = await response.json(); assert.equal(body.choices[0].message.reasoning_content, 'Consider carefully.'); assert.equal(body.choices[0].message.content, 'OK'); }
}
// Native Responses clients retain original reasoning/opaque fields and event sequence metadata.
{
  const text = reasoningEvents.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  let outcome: ForwardOutcome | undefined;
  const response = await forwardChatCompletion({ body: { model: 'm', input: 'Hello', stream: true }, sourceFormat: 'openai-responses', targets: [target('cx', { providerType: 'codex', format: 'openai-responses' })], apiKeyFor: () => null,
    fetchImpl: (async () => sse(text, 1)) as typeof fetch, onFinish: (value) => { outcome = value; } });
  assert.equal(await response.text(), text); assert.deepEqual(outcome?.usage, { promptTokens: 8, completionTokens: 4 }); assert.equal(outcome?.status, 200);
}

// Chat reasoning cannot be represented in Claude SSE: reject before emitting a healthy envelope.
const { ClientStreamTranslator } = await import('../src/lib/ai-router/streaming');
const streamChunk = (delta: Record<string, unknown>) => ({ id: 'ordered_reply', model: 'm', choices: [{ index: 0, delta, finish_reason: null }] });
{
  const translator = new ClientStreamTranslator('claude');
  assert.throws(() => translator.accept(streamChunk({ reasoning_content: 'Preserve this reasoning' })), /Unsupported.*reasoning/);
  const response = await forwardChatCompletion({ body: { model: 'm', max_tokens: 20, messages: [{ role: 'user', content: 'Hello' }], stream: true }, sourceFormat: 'claude', targets: [target('a')], apiKeyFor: () => null,
    fetchImpl: (async () => sse('data: {"choices":[{"delta":{"reasoning_content":"Preserve reasoning","content":"Answer"}}]}\n\ndata: [DONE]\n\n')) as typeof fetch });
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('message_stop'));
}

// Responses terminal output keeps exactly the emitted output_index order, including reasoning.
for (const order of [['tool', 'text'], ['text', 'tool'], ['tool', 'reasoning', 'text'], ['reasoning', 'tool', 'text'], ['text', 'reasoning', 'tool']]) {
  const translator = new ClientStreamTranslator('openai-responses');
  const deltas: Record<string, unknown> = {
    tool: { tool_calls: [{ index: 0, id: 'call_order', type: 'function', function: { name: 'clock', arguments: '{}' } }] },
    text: { content: 'Answer' }, reasoning: { reasoning_content: 'Reasoning' }
  };
  const bytes = order.flatMap((kind) => translator.accept(streamChunk(deltas[kind] as Record<string, unknown>))).concat(translator.accept('DONE'));
  const frames = bytes.map((value) => new TextDecoder().decode(value)).join('').split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
  const added = frames.filter((frame) => frame.type === 'response.output_item.added');
  const terminal = frames.find((frame) => frame.type === 'response.completed').response;
  const expected = order.map((kind) => kind === 'tool' ? 'function_call' : kind === 'text' ? 'message' : 'reasoning');
  assert.deepEqual(added.map((frame) => frame.output_index), order.map((_kind, index) => index));
  assert.deepEqual(added.map((frame) => frame.item.type), expected);
  assert.deepEqual(terminal.output.map((item: Record<string, unknown>) => item.type), expected);
  assert.deepEqual(terminal.output.map((item: Record<string, unknown>) => item.id), added.map((frame) => frame.item.id));
  const done = frames.filter((frame) => frame.type === 'response.output_item.done');
  assert.deepEqual(terminal.output, done.map((frame) => frame.item));
}

console.log('AI protocol checks passed');
