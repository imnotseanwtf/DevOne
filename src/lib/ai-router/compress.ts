/**
 * Shrinks tool output (command logs, file listings, diffs) before it is sent
 * to a model. Only things that carry no meaning are removed first (colour
 * codes, trailing spaces, runs of identical lines, blank-line runs); output
 * that is still too long keeps its beginning and end, where errors and
 * summaries usually are. Anything that is not plain text is left alone.
 */

// oxlint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function squeezeText(text: string): string {
  const lines = text.replace(ANSI, '').replaceAll('\r\n', '\n').split('\n');
  const out: string[] = [];
  let repeats = 0;
  let blanks = 0;
  const flushRepeats = () => {
    if (repeats > 0) out.push(`… (previous line repeated ${repeats} more times)`);
    repeats = 0;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === '') {
      flushRepeats();
      blanks += 1;
      if (blanks <= 1) out.push('');
      continue;
    }
    blanks = 0;
    if (out.length > 0 && out[out.length - 1] === line) {
      repeats += 1;
      continue;
    }
    flushRepeats();
    out.push(line);
  }
  flushRepeats();
  return out.join('\n');
}

export function compressText(text: string, maxChars: number): string {
  const squeezed = squeezeText(text);
  const best = squeezed.length < text.length ? squeezed : text;
  if (best.length <= maxChars) return best;
  const keep = Math.max(200, Math.floor(maxChars / 2));
  const omitted = best.length - keep * 2;
  return `${best.slice(0, keep)}\n… [${omitted} characters omitted by DevOne] …\n${best.slice(-keep)}`;
}

export interface CompressResult {
  messages: unknown[];
  savedChars: number;
}

/** Compresses the string content of `tool` messages in an OpenAI chat request. */
export function compressToolMessages(messages: unknown[], maxChars: number): CompressResult {
  let savedChars = 0;
  const next = messages.map((message) => {
    if (!message || typeof message !== 'object') return message;
    const entry = message as { role?: unknown; content?: unknown };
    if (entry.role !== 'tool' || typeof entry.content !== 'string') return message;
    const shorter = compressText(entry.content, maxChars);
    if (shorter.length >= entry.content.length) return message;
    savedChars += entry.content.length - shorter.length;
    return { ...entry, content: shorter };
  });
  return { messages: next, savedChars };
}
