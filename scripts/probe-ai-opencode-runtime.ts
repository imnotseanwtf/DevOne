import assert from 'node:assert/strict';
import { forwardChatCompletion } from '../src/lib/ai-router/forward';
import type { RouteTarget } from '../src/lib/ai-router/routing';

// Explicit live probe: no database, account credentials or project content are used.
const target: RouteTarget = {
  provider: {
    id: 'opencode-live-probe', name: 'OpenCode Free', providerType: 'opencode',
    baseUrl: 'https://opencode.ai/zen/v1', models: ['big-pickle'],
    priority: 0, enabled: true, cooldownUntil: null, authType: 'none', format: 'openai'
  },
  model: 'big-pickle'
};
const started = Date.now();
const response = await forwardChatCompletion({
  body: {
    model: 'big-pickle', max_tokens: 512, stream: false,
    messages: [{ role: 'user', content: 'Reply with exactly DEVONE_OK. Do not use any tools.' }]
  },
  targets: [target], apiKeyFor: () => null,
  fetchImpl: async () => { throw new Error('Live probe must use the installed runtime'); }
});
const body = await response.json();
assert.equal(response.status, 200, JSON.stringify(body));
assert.equal(body.choices?.[0]?.message?.content?.trim(), 'DEVONE_OK');
console.log(JSON.stringify({ reply: body.choices[0].message.content, elapsedMs: Date.now() - started, usage: body.usage }));
