/** Read Chat completion text, preserving streamed failures instead of showing a false success. */
export async function readChatStream(
  response: Response,
  onText: (text: string) => void
): Promise<void> {
  if (!response.body) throw new Error('The assistant sent an empty response. Try again.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const readLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const body = JSON.parse(data) as {
      error?: { message?: string };
      choices?: { delta?: { content?: string } }[];
    };
    if (body.error)
      throw new Error(body.error.message || 'The assistant could not finish. Try again.');
    const text = body.choices?.[0]?.delta?.content;
    if (typeof text === 'string' && text) onText(text);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) readLine(line);
      if (done) {
        if (pending) readLine(pending);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
