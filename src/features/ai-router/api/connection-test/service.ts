import type { AiConnectionTestInput, AiConnectionTestResult } from '../types';

/** Browser diagnostics use the signed-in session; credentials stay on the server. */
export async function testConnection(
  connectionId: string,
  input: AiConnectionTestInput,
  signal: AbortSignal
): Promise<AiConnectionTestResult> {
  const started = performance.now();
  const response = await fetch(`/api/ai/connections/${encodeURIComponent(connectionId)}/test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal
  });
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: { message?: { content?: string | null } }[];
  } | null;
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${body?.error?.message ?? response.statusText}`);
  if (!Array.isArray(body?.choices) || !body.choices[0]?.message)
    throw new Error('The connection returned an invalid response');
  const content = body.choices[0]?.message?.content;
  if (content !== null && typeof content !== 'string')
    throw new Error('The connection returned unsupported content');
  return {
    message: (content ?? '').slice(0, 8000),
    truncated: (content?.length ?? 0) > 8000,
    model: response.headers.get('x-devone-model') ?? input.model,
    elapsedMs: Math.round(performance.now() - started)
  };
}
