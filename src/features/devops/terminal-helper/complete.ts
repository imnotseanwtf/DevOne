import { SPECS, type CommandSpec } from '@/features/devops/terminal-helper/specs';
import { KNOWN_COMMANDS } from '@/features/devops/terminal-helper/suggest';

export interface Completion {
  /** What the menu shows. */
  label: string;
  /** What to type to accept it: the part the person has not typed yet. */
  insert: string;
  description?: string;
  kind: 'command' | 'subcommand' | 'option' | 'history';
}

const MAX_ITEMS = 8;

/**
 * Where the typed command starts on a terminal line: after the first `$ `, `# `,
 * `% ` or `> `. This is the same regex-on-the-prompt approach inshellisense uses;
 * a prompt it doesn't recognise returns null, and nothing is suggested.
 */
export function inputAfterPrompt(line: string): string | null {
  const match = /^.*?[$#%>] (.*)$/.exec(line);
  return match ? match[1] : null;
}

function walk(done: string[]): CommandSpec | null {
  let node: CommandSpec | undefined = SPECS[done[0]];
  for (const word of done.slice(1)) {
    if (!node) return null;
    if (word.startsWith('-')) continue;
    const next: CommandSpec | undefined = node.subcommands?.[word];
    // Not a subcommand: a positional argument, after which there are no more subcommands.
    if (!next) return { ...node, subcommands: undefined };
    node = next;
  }
  return node ?? null;
}

export function complete(input: string, history: readonly string[] = []): Completion[] {
  if (input.trim() === '') return [];
  const endsWithSpace = /\s$/.test(input);
  const words = input.trim().split(/\s+/);
  const current = endsWithSpace ? '' : (words.at(-1) ?? '');
  const done = endsWithSpace ? words : words.slice(0, -1);
  while (done[0] === 'sudo') done.shift();

  const items: Completion[] = [];
  const add = (label: string, kind: Completion['kind'], description?: string) => {
    if (label === current || !label.startsWith(current)) return;
    items.push({ label, insert: `${label.slice(current.length)} `, description, kind });
  };

  if (done.length === 0) {
    for (const name of KNOWN_COMMANDS) add(name, 'command', SPECS[name]?.description);
  } else {
    const node = walk(done);
    if (node) {
      if (current.startsWith('-')) {
        for (const [flag, description] of Object.entries(node.options ?? {})) {
          add(flag, 'option', description);
        }
      } else {
        for (const [name, sub] of Object.entries(node.subcommands ?? {})) {
          add(name, 'subcommand', sub.description);
        }
      }
    }
  }

  // Earlier commands from this session that continue what is typed.
  if (input.length >= 2 && !endsWithSpace) {
    for (const entry of history) {
      if (entry.startsWith(input) && entry !== input) {
        items.push({ label: entry, insert: entry.slice(input.length), kind: 'history' });
      }
    }
  }

  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.label) && seen.add(item.label)).slice(0, MAX_ITEMS);
}
