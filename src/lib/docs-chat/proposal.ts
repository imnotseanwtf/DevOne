/**
 * The assistant never edits a page itself. When asked to change the open page
 * it answers with the complete new Markdown inside a `devone-doc` fence, and
 * the person applies it with a button. These parse that answer; pure
 * functions, so they are checked without a browser.
 */

export const PROPOSAL_LANG = 'devone-doc';

export interface SplitAnswer {
  /** The explanation, without the proposed page. */
  prose: string;
  /** The complete proposed page, once its closing fence has arrived. */
  proposal: string | null;
  /** True while the fence is open and the proposal is still being written. */
  writing: boolean;
}

/** The fence label of a complete plan, which the person turns into a new page. */
export const PLAN_LANG = 'devone-plan';

const openFence = (lang: string) => new RegExp(`^(\`{3,})${lang}[ \\t]*$`, 'm');

/**
 * Splits an answer into prose and a proposed page. The proposal may contain
 * code fences of its own, so it ends at the last line made only of backticks
 * that is at least as long as the opening fence.
 */
export function splitAnswer(text: string, lang: string = PROPOSAL_LANG): SplitAnswer {
  const open = openFence(lang).exec(text);
  if (!open) return { prose: text, proposal: null, writing: false };

  const fence = open[1].length;
  const prose = text.slice(0, open.index).trimEnd();
  const rest = text.slice(open.index + open[0].length).replace(/^\r?\n/, '');

  const lines = rest.split('\n');
  let close = -1;
  lines.forEach((line, index) => {
    const ticks = /^(`+)[ \t]*$/.exec(line.trimEnd());
    if (ticks && ticks[1].length >= fence) close = index;
  });
  if (close === -1) return { prose, proposal: null, writing: true };

  const after = lines
    .slice(close + 1)
    .join('\n')
    .trim();
  return {
    prose: [prose, after].filter(Boolean).join('\n\n'),
    proposal: lines.slice(0, close).join('\n').trimEnd(),
    writing: false
  };
}

export interface ChangeSummary {
  added: number;
  removed: number;
}

/** How many lines a proposal adds and removes, comparing lines as a multiset. */
export function summarizeChange(before: string, after: string): ChangeSummary {
  const counts = new Map<string, number>();
  for (const line of before.split('\n')) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of after.split('\n')) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added += 1;
  }
  let removed = 0;
  for (const left of counts.values()) removed += left;
  return { added, removed };
}
