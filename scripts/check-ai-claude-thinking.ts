import assert from 'node:assert/strict';
import { forwardChatCompletion, type ForwardOutcome } from '../src/lib/ai-router/forward';
import { translateRequest } from '../src/lib/ai-router/translation';
import type { RouteTarget } from '../src/lib/ai-router/routing';

const target: RouteTarget = {
  provider: { id: 'claude', name: 'Claude', providerType: 'claude', format: 'claude', baseUrl: 'https://example.com/v1',
    models: ['m'], enabled: true, priority: 0, cooldownUntil: null },
  model: 'm'
};
const request = { model: 'm', max_tokens: 2048, messages: [{ role: 'user', content: 'Hello' }] };
const answer = {
  id: 'msg-thinking', type: 'message', role: 'assistant', model: 'm',
  content: [
    { type: 'thinking', thinking: 'Consider carefully.', signature: 'opaque-signature' },
    { type: 'redacted_thinking', data: 'opaque-redacted' },
    { type: 'text', text: 'Hello world', citations: null },
    { type: 'tool_use', id: 'call-1', name: 'clock', input: { zone: 'UTC' } }
  ],
  stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 12, output_tokens: 9 }
};
const events = [
  { type: 'message_start', message: { ...answer, content: [], stop_reason: null, usage: { input_tokens: 12, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'Consider ', signature: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'carefully.' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'opaque-' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signature' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: answer.content[1] },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'text', text: 'Hello ', citations: null } },
  { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'world' } },
  { type: 'content_block_stop', index: 2 },
  { type: 'content_block_start', index: 3, content_block: { type: 'tool_use', id: 'call-1', name: 'clock', input: {} } },
  { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"zone":' } },
  { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '"UTC"}' } },
  { type: 'content_block_stop', index: 3 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 9 } },
  { type: 'message_stop' }
];
function frames(values: unknown[]): string {
  return values.map(value => `data: ${JSON.stringify(value)}\n\n`).join('');
}
function sse(text: string): Response {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    const bytes = new TextEncoder().encode(text);
    for (let i = 0; i < bytes.length; i += 4096) controller.enqueue(bytes.slice(i, i + 4096));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}

for (const sourceFormat of ['openai', 'openai-responses', 'claude'] as const) {
  for (const upstreamSse of [false, true]) {
    for (const stream of [false, true]) {
      if (stream && !upstreamSse) continue; // The gateway's JSON-upstream contract returns JSON.
      let outcome: ForwardOutcome | undefined;
      let failures = 0;
      const response = await forwardChatCompletion({
        body: translateRequest({ ...request, stream }, 'openai', sourceFormat, 'm'), sourceFormat,
        targets: [target], apiKeyFor: () => null,
        fetchImpl: async () => upstreamSse ? sse(frames(events)) : Response.json(answer),
        onFailure: () => { failures++; }, onFinish: value => { outcome = value; }
      });
      assert.equal(response.status, 200, `${sourceFormat}, upstreamSse=${upstreamSse}, stream=${stream}: thinking is valid response content`);
      const body = await response.text();
      assert.ok(!body.includes('upstream_error'));
      assert.equal(failures, 0, 'valid thinking must not mark the account as failed or trigger cooldown');
      assert.deepEqual(outcome?.usage, { promptTokens: 12, completionTokens: 9 });
      if (sourceFormat === 'claude') {
        if (stream) assert.equal(body, frames(events), 'native SSE must preserve signed and redacted blocks');
        else assert.deepEqual(JSON.parse(body), answer, 'native JSON and aggregated SSE must preserve block order, signatures and opaque data');
      } else {
        assert.ok(!body.includes('opaque-signature'));
        assert.ok(!body.includes('opaque-redacted'));
        if (!stream) {
          const result = JSON.parse(body);
          if (sourceFormat === 'openai') {
            assert.equal(result.choices[0].message.content, 'Hello world');
            assert.equal(result.choices[0].message.reasoning_content, 'Consider carefully.');
            assert.equal(result.choices[0].finish_reason, 'tool_calls');
            assert.equal(result.choices[0].message.tool_calls[0].function.arguments, '{"zone":"UTC"}');
          } else {
            assert.equal(result.output.find((item: { type: string }) => item.type === 'reasoning').summary[0].text, 'Consider carefully.');
            assert.equal(result.output.find((item: { type: string }) => item.type === 'message').content[0].text, 'Hello world');
          }
        } else {
          assert.ok(body.includes('carefully.'));
          assert.ok(body.includes('world'));
        }
      }
    }
  }
}

const longEvents = [...events.slice(0, 2), ...Array.from({ length: 6 }, () => ({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'x'.repeat(200_000) } })), ...events.slice(2)];
const long = await forwardChatCompletion({ body: { ...request, stream: true }, targets: [target], apiKeyFor: () => null, fetchImpl: async () => sse(frames(longEvents)) });
assert.equal(long.status, 200, 'reasoning output must not fill the metadata-only prefetch buffer');
assert.ok(!(await long.text()).includes('upstream_error'));

for (const content of [[{ type: 'thinking', thinking: 123 }], [{ type: 'redacted_thinking', data: 123 }]]) {
  for (const stream of [false, true]) {
    const response = await forwardChatCompletion({ body: request, targets: [target], apiKeyFor: () => null,
      fetchImpl: async () => stream ? sse(frames([events[0], { type: 'content_block_start', index: 0, content_block: content[0] }, ...events.slice(-2)])) : Response.json({ ...answer, content }) });
    assert.equal(response.status, 502, 'malformed thinking remains an upstream error');
  }
}
const malformedNative = await forwardChatCompletion({ body: translateRequest(request, 'openai', 'claude', 'm'), sourceFormat: 'claude', targets: [target], apiKeyFor: () => null,
  fetchImpl: async () => sse(frames([events[0], { type: 'message_delta', delta: null, usage: {} }, { type: 'message_stop' }])) });
assert.equal(malformedNative.status, 502, 'malformed upstream native frames must not be blamed on the caller');
console.log('Claude thinking checks passed: JSON/SSE, Chat/Responses/native clients, signed native blocks, tools, usage and cooldown avoidance');
