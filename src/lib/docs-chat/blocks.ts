import { marked } from 'marked';

/**
 * A page is edited one block at a time: the paragraph, heading, list, code
 * block, table or quote under the mouse. Blocks are the top-level pieces of
 * the page's Markdown, in the same order the editor shows them. Pure
 * functions, so they are checked without a browser.
 */

export interface PageBlock {
  /** The block's Markdown exactly as written, without the blank lines after it. */
  raw: string;
  /** Where `raw` starts in the page. */
  start: number;
}

export function splitBlocks(markdown: string): PageBlock[] {
  const blocks: PageBlock[] = [];
  let offset = 0;
  for (const token of marked.lexer(markdown)) {
    if (token.type !== 'space') {
      // Some tokens swallow the line break that follows them; the block is just the text.
      blocks.push({ raw: token.raw.replace(/\s+$/, ''), start: offset });
    }
    offset += token.raw.length;
  }
  return blocks;
}

/** The page with block `index` replaced; every other character stays as it was. */
export function replaceBlock(markdown: string, index: number, replacement: string): string {
  const block = splitBlocks(markdown)[index];
  if (!block) throw new Error('That block no longer exists');
  return (
    markdown.slice(0, block.start) +
    replacement.trim() +
    markdown.slice(block.start + block.raw.length)
  );
}

/** A model asked for "just the Markdown" sometimes wraps it in a fence anyway. */
export function cleanBlockAnswer(answer: string): string {
  const text = answer.trim();
  const fenced = /^(`{3,})(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/.exec(text);
  return (fenced ? fenced[2] : text).trim();
}
