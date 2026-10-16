import { MAX_TOOL_ROUNDS, PLAN_TOOLS, describeToolCall, parseToolArgs } from '@/lib/docs-chat/plan';

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

/**
 * Lets the model call the planning tools until it answers in words. Returns null
 * when the very first call fails, which usually means the model has no tool
 * support, so the caller can fall back to a plain answer.
 */
export async function runPlanTools({
  messages,
  complete,
  run
}: {
  messages: { role: string; content: string }[];
  complete: (body: Record<string, unknown>) => Promise<Response>;
  run: (name: string, args: Record<string, string>) => Promise<string>;
}): Promise<{ content: string; used: string[] } | null> {
  const conversation: Record<string, unknown>[] = [...messages];
  const used: string[] = [];
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // The last round offers no tools, which makes the model answer with what it has.
    const response = await complete({
      stream: false,
      messages: conversation,
      ...(round < MAX_TOOL_ROUNDS ? { tools: PLAN_TOOLS } : {})
    }).catch(() => null);
    const body = response?.ok
      ? ((await response.json().catch(() => null)) as {
          choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
        } | null)
      : null;
    const message = body?.choices?.[0]?.message;
    if (!message) {
      if (round === 0) return null;
      return { content: 'The assistant stopped before it could answer. Try again.', used };
    }
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) return { content: message.content ?? '', used };

    conversation.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
    for (const call of calls) {
      const args = parseToolArgs(call.function.arguments);
      used.push(describeToolCall(call.function.name, args));
      conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        content: await run(call.function.name, args)
      });
    }
  }
  return { content: 'The assistant used too many lookups. Try again.', used };
}
