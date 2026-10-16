import assert from 'node:assert/strict';
import { runPlanTools } from '../src/features/docs-chat/plan-loop';
import { buildPlanMessages } from '../src/lib/docs-chat/plan';
import { PLAN_LANG, splitAnswer } from '../src/lib/docs-chat/proposal';

/** A scripted stand-in for the AI router: each call returns the next prepared message. */
function fakeRouter(script: Record<string, unknown>[]) {
  const requests: Record<string, unknown>[] = [];
  const complete = async (body: Record<string, unknown>) => {
    requests.push(JSON.parse(JSON.stringify(body)));
    const next = script[requests.length - 1];
    return next
      ? Response.json({ choices: [{ message: next }] })
      : new Response('{}', { status: 500 });
  };
  return { complete, requests };
}

const call = (id: string, name: string, args: object) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) }
});

const start = buildPlanMessages(
  'Demo',
  [{ role: 'user', content: 'I want to add SSO login' }],
  { branch: 'acme/app @ main', toolsAvailable: true }
);

// 1. The model looks things up with two tools, then asks ONE question.
{
  const router = fakeRouter([
    {
      content: null,
      tool_calls: [
        call('1', 'search_docs', { query: 'login auth' }),
        call('2', 'read_file', { path: 'src/lib/auth/session.ts' })
      ]
    },
    { content: 'Sessions use cookies today. Which provider?\nA) Google\nB) Okta (my pick)' }
  ]);
  const ran: string[] = [];
  const result = await runPlanTools({
    messages: start,
    complete: router.complete,
    run: async (name, args) => {
      ran.push(`${name}(${JSON.stringify(args)})`);
      return name === 'read_file' ? 'export const session = cookie()' : '### Auth\nCookie sessions';
    }
  });
  console.log('--- Turn 1: tools used:', result?.used);
  console.log(result?.content, '\n');
  assert.deepEqual(result?.used, ['search docs: login auth', 'read file: src/lib/auth/session.ts']);
  assert.match(result?.content ?? '', /Which provider/);
  assert.equal(ran.length, 2);
  // Tool results were sent back to the model with the matching call ids.
  const second = router.requests[1].messages as { role: string; tool_call_id?: string }[];
  assert.deepEqual(
    second.filter((m) => m.role === 'tool').map((m) => m.tool_call_id),
    ['1', '2']
  );
  assert.ok(router.requests[0].tools, 'tools are offered');
}

// 2. After the answers the model writes the plan; the page can be saved from it.
{
  const plan =
    '# Add SSO login\n\n## Goal\nLet staff sign in with Okta.\n\n## Checklist\n### Phase 1\n- [ ] Add provider config in src/lib/auth/oauth.ts\n- [ ] Add callback route';
  const router = fakeRouter([
    { content: `Going with Okta.\n\n\`\`\`\`${PLAN_LANG}\n${plan}\n\`\`\`\`` }
  ]);
  const result = await runPlanTools({
    messages: [...start, { role: 'user', content: 'B, write the plan' }],
    complete: router.complete,
    run: async () => ''
  });
  const parsed = splitAnswer(result?.content ?? '', PLAN_LANG);
  console.log('--- Turn 2: plan page body ---\n' + parsed.proposal, '\n');
  assert.equal(parsed.proposal, plan);
  assert.equal((parsed.proposal?.match(/^- \[ \]/gm) ?? []).length, 2);
}

// 3. A tool that fails is reported to the model, not thrown.
{
  const router = fakeRouter([
    { content: null, tool_calls: [call('9', 'read_file', { path: 'nope' })] },
    { content: 'That file does not exist, so I will treat it as an open question.' }
  ]);
  const result = await runPlanTools({
    messages: start,
    complete: router.complete,
    run: async () => 'Error: not found'
  });
  assert.match(result?.content ?? '', /open question/);
}

// 4. A model without tool support (first call fails) hands back to the caller for a plain answer.
assert.equal(
  await runPlanTools({ messages: start, complete: fakeRouter([]).complete, run: async () => '' }),
  null
);

// 5. A model that never stops calling tools is cut off, and the last round offers no tools.
{
  const endless = Array.from({ length: 20 }, (_, i) => ({
    content: null,
    tool_calls: [call(String(i), 'list_branches', {})]
  }));
  const router = fakeRouter(endless);
  const result = await runPlanTools({ messages: start, complete: router.complete, run: async () => 'x' });
  assert.match(result?.content ?? '', /too many lookups/);
  assert.equal(router.requests.length, 7);
  assert.equal(router.requests.at(-1)?.tools, undefined);
}

console.log('Plan loop checks passed');
