import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forwardChatCompletion, type ForwardOutcome } from '../src/lib/ai-router/forward';
import type { RouteTarget } from '../src/lib/ai-router/routing';
import { translateRequest } from '../src/lib/ai-router/translation';

// A real child process verifies stdin EOF, cancellation, environment isolation and cleanup.
// Only the external model is replaced; requests still pass through the complete gateway.
const directory = await mkdtemp(join(tmpdir(), 'devone-runtime-check-'));
const executable = join(directory, 'opencode');
const statePath = join(directory, 'child.json');
await writeFile(executable, `#!/usr/bin/env node
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
assert.equal(config.permission, 'ask');
assert.equal(config.share, 'disabled');
assert.equal(config.autoupdate, false);
assert.deepEqual(config.enabled_providers, ['opencode']);
assert.equal(process.env.DATABASE_URL, undefined);
assert.equal(process.env.DEVONE_ENCRYPTION_KEY, undefined);
assert.equal(process.env.AWS_SECRET_ACCESS_KEY, undefined);
assert.equal(process.env.OPENCODE_API_KEY, undefined);
assert.equal(process.argv.includes('--auto'), false);
assert.ok(process.argv.includes('--pure'));
assert.ok(process.env.XDG_DATA_HOME.startsWith(process.env.OPENCODE_TEST_HOME));
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { messages } = JSON.parse(input);
writeFileSync(${JSON.stringify(statePath)}, JSON.stringify({ pid: process.pid, cwd: process.cwd(), root: process.env.OPENCODE_TEST_HOME, messages, maxTokens: process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX }));
const message = messages.at(-1).content;
const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
if (message === 'stall') { setInterval(() => {}, 1000); }
else if (message === 'reject') {
  emit({ type: 'error', error: { name: 'APIError', data: { message: 'Free tier rejected', statusCode: 403 } } });
  process.exitCode = 1;
} else if (message === 'crash') { process.exitCode = 1; }
else if (message === 'oversized') { process.stdout.write('x'.repeat(2 * 1024 * 1024)); }
else if (message === 'malformed-error') { emit({ type: 'error', error: 'invalid' }); }
else if (message === 'malformed-part') { emit({ type: 'text', part: 'invalid' }); }
else {
  emit({ type: 'text', part: { text: 'Hello from OpenCode' } });
  if (message !== 'incomplete') emit({ type: 'step_finish', part: { reason: 'stop', tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 4 } } } });
}
`, { mode: 0o700 });

const previous = { ...process.env };
delete process.env.DEVONE_AI_OPENCODE_RUNTIME;
process.env.DEVONE_AI_OPENCODE_BIN = executable;
process.env.DATABASE_URL = 'test-secret-do-not-inherit';
process.env.DEVONE_ENCRYPTION_KEY = 'test-secret-do-not-inherit';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-do-not-inherit';
process.env.OPENCODE_API_KEY = 'test-secret-do-not-inherit';

const target: RouteTarget = {
  provider: {
    id: 'oc-runtime', name: 'OpenCode Free', providerType: 'opencode',
    baseUrl: 'https://opencode.ai/zen/v1', models: ['big-pickle'],
    priority: 0, enabled: true, cooldownUntil: null, authType: 'none', format: 'openai'
  },
  model: 'big-pickle', connectionId: 'runtime-account'
};
const body = {
  model: 'big-pickle', max_tokens: 128,
  messages: [{ role: 'system', content: 'Be concise' }, { role: 'user', content: 'Hello' }]
};
const directHttp: typeof fetch = async () => Response.json(
  { error: { message: 'The runtime must replace direct inference HTTP' } }, { status: 403 }
);
const request = (content: string, signal?: AbortSignal) => forwardChatCompletion({
  body: { ...body, messages: [{ role: 'user', content }] }, targets: [target],
  apiKeyFor: () => null, fetchImpl: directHttp, signal, timeoutMs: 5_000
});
try {
  for (const sourceFormat of ['openai', 'claude', 'openai-responses'] as const) {
    for (const stream of [false, true]) {
      let outcome: ForwardOutcome | undefined;
      const response = await forwardChatCompletion({
        body: translateRequest({ ...body, stream }, 'openai', sourceFormat, 'big-pickle'),
        targets: [target], sourceFormat, apiKeyFor: () => null, fetchImpl: directHttp,
        timeoutMs: 5_000, onFinish: (value) => { outcome = value; }
      });
      assert.equal(response.status, 200, 'runtime mode must use the child process instead of direct inference HTTP');
      assert.match(response.headers.get('content-type')!, stream ? /text\/event-stream/ : /application\/json/);
      assert.match(await response.text(), /Hello from OpenCode/);
      assert.deepEqual(outcome?.usage, { promptTokens: 17, completionTokens: 7 });
      const child = JSON.parse(await readFile(statePath, 'utf8'));
      assert.deepEqual(child.messages, body.messages, 'text history and roles must survive transcript preparation');
      assert.equal(child.maxTokens, '128');
      await assert.rejects(stat(child.root), { code: 'ENOENT' }, 'temporary sessions must be removed');
    }
  }

  for (const content of ['incomplete', 'crash', 'oversized', 'malformed-error', 'malformed-part']) {
    const response = await request(content);
    assert.equal(response.status, 502, `${content} output cannot count as a successful reply`);
  }
  const rejected = await request('reject');
  assert.equal(rejected.status, 403);
  assert.match(await rejected.text(), /Free tier rejected/);

  for (const unsupported of [
    { tools: [{ type: 'function', function: { name: 'bash' } }] },
    { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/image.png' } }] }] },
    { temperature: 0.5 }, { max_tokens: 0 }, { max_tokens: 1.5 }
  ]) {
    const response = await forwardChatCompletion({
      body: { ...body, ...unsupported }, targets: [target], apiKeyFor: () => null, fetchImpl: directHttp
    });
    assert.equal(response.status, 400, 'unsupported inputs must be rejected explicitly');
  }

  const stalled = await forwardChatCompletion({
    body: { ...body, messages: [{ role: 'user', content: 'stall' }] },
    targets: [target], apiKeyFor: () => null, fetchImpl: directHttp, timeoutMs: 500
  });
  assert.equal(stalled.status, 504, 'a stalled process must obey the gateway timeout');
  const timedOutChild = JSON.parse(await readFile(statePath, 'utf8'));
  assert.throws(() => process.kill(timedOutChild.pid, 0), { code: 'ESRCH' });
  await assert.rejects(stat(timedOutChild.root), { code: 'ENOENT' });

  await rm(statePath);
  const controller = new AbortController();
  const running = request('stall', controller.signal);
  let child: { pid: number; root: string } | undefined;
  for (let attempt = 0; attempt < 100 && !child; attempt++) {
    child = await readFile(statePath, 'utf8').then(JSON.parse).catch(() => undefined);
    if (!child) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(child, 'child must start before exercising cancellation');
  controller.abort();
  assert.equal((await running).status, 499);
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' }, 'client cancellation must kill the process');
  await assert.rejects(stat(child.root), { code: 'ENOENT' });
  assert.equal((await request('Hello', controller.signal)).status, 499);

  process.env.DEVONE_AI_OPENCODE_BIN = join(directory, 'missing');
  const missing = await request('Hello');
  assert.equal(missing.status, 503, 'a missing executable must produce an actionable setup error');
  assert.match(await missing.text(), /executable|binary/i);
  console.log('OpenCode runtime checks passed: real child, isolated environment, text formats, errors, timeout and cleanup');
} finally {
  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
  Object.assign(process.env, previous);
  await rm(directory, { recursive: true, force: true });
}
