import { createHash } from 'node:crypto';
import { ProtocolError, type JsonObject } from './translation';

const compatibilityTools = ['bash', 'glob', 'grep', 'read'];

/** OpenCode's public catalog includes paid models and non-chat endpoints. */
export function openCodeFreeModels(models: string[]): string[] {
  return models.filter(
    (model) =>
      (model === 'big-pickle' || model.endsWith('-free')) &&
      !model.startsWith('jev-') &&
      !model.includes('-contributor-free')
  );
}

function identifier(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 26)}`;
}

function renameFunction(record: JsonObject, names: Map<string, string>): void {
  const fn = record.function as JsonObject | undefined;
  if (fn && typeof fn.name === 'string' && names.has(fn.name)) fn.name = names.get(fn.name);
}

/** Match the public OpenCode transport, retaining one session across retries. */
export function prepareOpenCodeRequest(
  body: JsonObject,
  accountId: string
): {
  body: JsonObject;
  headers: Record<string, string>;
  restore: (payload: JsonObject) => JsonObject;
  finishRestore: () => JsonObject | null;
} {
  const names = new Map<string, string>(),
    restoreNames = new Map<string, string>();
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const present = new Set<string>();
  for (const tool of tools) {
    const name = (tool as { function?: { name?: unknown } })?.function?.name;
    if (typeof name !== 'string' || !compatibilityTools.includes(name.toLowerCase())) continue;
    const canonical = name.toLowerCase();
    if (present.has(canonical)) throw new ProtocolError('Duplicate OpenCode tool names');
    present.add(canonical);
    names.set(name, canonical);
    restoreNames.set(canonical, name);
  }
  const prepared = structuredClone(body);
  for (const tool of (prepared.tools as JsonObject[] | undefined) ?? [])
    renameFunction(tool, names);
  if (prepared.tool_choice && typeof prepared.tool_choice === 'object')
    renameFunction(prepared.tool_choice as JsonObject, names);
  for (const message of (prepared.messages as JsonObject[] | undefined) ?? [])
    for (const call of (message.tool_calls as JsonObject[] | undefined) ?? [])
      renameFunction(call, names);
  const allowed = new Set(
    tools.map((tool) => {
      const name = (tool as { function?: { name?: string } }).function?.name ?? '';
      return names.get(name) ?? name;
    })
  );
  const pending = new Map<string, JsonObject>();
  const emitted = new Set<string>();
  function restoredName(name: string): string {
    if (!allowed.has(name))
      throw new ProtocolError('Upstream called an undeclared OpenCode tool', 502);
    return restoreNames.get(name) ?? name;
  }
  function restore(payload: JsonObject): JsonObject {
    const result = structuredClone(payload);
    for (const choice of (result.choices as JsonObject[] | undefined) ?? []) {
      const message = choice.message as JsonObject | undefined;
      for (const call of (message?.tool_calls as JsonObject[] | undefined) ?? []) {
        const fn = call.function as JsonObject;
        fn.name = restoredName(String(fn.name ?? ''));
      }
      const delta = choice.delta as JsonObject | undefined;
      if (!delta) continue;
      const calls: JsonObject[] = [];
      for (const call of (delta.tool_calls as JsonObject[] | undefined) ?? []) {
        const key = `${String(choice.index ?? 0)}:${String(call.index ?? 0)}`;
        const fn = (call.function as JsonObject | undefined) ?? {};
        if (emitted.has(key)) {
          if (fn.name) throw new ProtocolError('Upstream changed an OpenCode tool name', 502);
          calls.push(call);
          continue;
        }
        const prior = pending.get(key) ?? {
          index: call.index ?? 0,
          function: { name: '', arguments: '' }
        };
        const priorFn = prior.function as JsonObject;
        if (call.id) prior.id = call.id;
        if (call.type) prior.type = call.type;
        priorFn.name = String(priorFn.name) + String(fn.name ?? '');
        priorFn.arguments = String(priorFn.arguments) + String(fn.arguments ?? '');
        if (JSON.stringify(prior).length > 1024 * 1024 || pending.size > 128)
          throw new ProtocolError('Upstream OpenCode tool too large', 502);
        const name = String(priorFn.name);
        const candidates = [...allowed].filter((candidate) => candidate.startsWith(name));
        if (!candidates.length)
          throw new ProtocolError('Upstream called an undeclared OpenCode tool', 502);
        pending.set(key, prior);
        if (allowed.has(name) && candidates.length === 1) {
          priorFn.name = restoredName(name);
          calls.push(prior);
          pending.delete(key);
          emitted.add(key);
        }
      }
      if (choice.finish_reason != null) {
        for (const [key, call] of pending) {
          if (!key.startsWith(`${String(choice.index ?? 0)}:`)) continue;
          const fn = call.function as JsonObject;
          fn.name = restoredName(String(fn.name));
          calls.push(call);
          pending.delete(key);
          emitted.add(key);
        }
      }
      if (calls.length) delta.tool_calls = calls;
      else delete delta.tool_calls;
    }
    return result;
  }
  function finishRestore(): JsonObject | null {
    if (!pending.size) return null;
    const choices = new Map<number, JsonObject[]>();
    for (const [key, call] of pending) {
      const fn = call.function as JsonObject;
      fn.name = restoredName(String(fn.name));
      const index = Number(key.split(':')[0]);
      const calls = choices.get(index) ?? [];
      calls.push(call);
      choices.set(index, calls);
    }
    pending.clear();
    return {
      choices: [...choices].map(([index, calls]) => ({
        index,
        delta: { tool_calls: calls },
        finish_reason: null
      }))
    };
  }
  prepared.tools = [
    ...((prepared.tools as unknown[] | undefined) ?? []),
    ...compatibilityTools
      .filter((name) => !present.has(name))
      .map((name) => ({
        type: 'function',
        function: {
          name,
          description: 'Unavailable tool. Do not call it.',
          parameters: { type: 'object', properties: {} }
        }
      }))
  ];
  if (!tools.length) prepared.tool_choice = 'none';
  prepared.stream = true;
  const session = identifier('ses', `opencode:${accountId}`);
  return {
    body: prepared,
    headers: {
      Authorization: 'Bearer public',
      'User-Agent': 'opencode/1.18.31',
      'x-opencode-client': 'desktop',
      'x-opencode-project': 'global',
      'x-opencode-session': session,
      'x-opencode-request': identifier('msg', `${session}:${JSON.stringify(body)}`)
    },
    restore,
    finishRestore
  };
}
