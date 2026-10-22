/** Commands worth correcting a typo towards: what people actually type on a server. */
export const KNOWN_COMMANDS = [
  'docker',
  'docker-compose',
  'git',
  'ssh',
  'scp',
  'rsync',
  'curl',
  'wget',
  'sudo',
  'systemctl',
  'journalctl',
  'ls',
  'cd',
  'cat',
  'less',
  'grep',
  'find',
  'tail',
  'head',
  'tar',
  'unzip',
  'zip',
  'chmod',
  'chown',
  'mkdir',
  'rm',
  'cp',
  'mv',
  'pwd',
  'df',
  'du',
  'free',
  'top',
  'htop',
  'ps',
  'kill',
  'nano',
  'vim',
  'apt',
  'apt-get',
  'yum',
  'dnf',
  'npm',
  'node',
  'python3',
  'pip',
  'ping',
  'netstat',
  'ss',
  'ip',
  'dig',
  'nslookup',
  'whoami',
  'uname',
  'env',
  'echo',
  'history',
  'clear',
  'exit'
] as const;

export const DOCKER_SUBCOMMANDS = [
  'attach',
  'build',
  'compose',
  'cp',
  'create',
  'diff',
  'events',
  'exec',
  'image',
  'images',
  'inspect',
  'kill',
  'load',
  'login',
  'logout',
  'logs',
  'network',
  'pause',
  'port',
  'ps',
  'pull',
  'push',
  'rename',
  'restart',
  'rm',
  'rmi',
  'run',
  'save',
  'search',
  'start',
  'stats',
  'stop',
  'system',
  'tag',
  'top',
  'unpause',
  'update',
  'version',
  'volume',
  'wait'
] as const;

/** Edit distance with insert, delete, replace and swapping two neighbours (the usual typing slip). */
export function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** The closest candidate to `word`, or null when nothing is near enough to be a typo. */
export function closest(word: string, candidates: readonly string[]): string | null {
  const typed = word.toLowerCase();
  // Short words are too easy to match by accident: one slip at most.
  const limit = typed.length <= 4 ? 1 : 2;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (candidate === typed) return null;
    const away = distance(typed, candidate);
    if (away < bestDistance) {
      best = candidate;
      bestDistance = away;
    }
  }
  return bestDistance <= limit ? best : null;
}

export interface Mistake {
  /** What was typed wrong. */
  typed: string;
  /** What was probably meant. */
  suggestion: string;
  kind: 'command' | 'docker';
}

const COMMAND_NOT_FOUND = [
  // bash: `bash: dokcer: command not found`
  /^(?:-?bash|zsh|sh|fish):\s+(?:\d+:\s+)?([^\s:]+): (?:command )?not found$/,
  // zsh: `zsh: command not found: dokcer`
  /^zsh: command not found: (\S+)$/
];
const DOCKER_UNKNOWN = /^docker: '([^']+)' is not a docker command\.?$/;

/**
 * Reads the shell's last line(s) of output and says whether it reported a
 * mistyped command or docker subcommand that has an obvious fix.
 */
export function detectMistake(output: string): Mistake | null {
  const lines = output
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3);
  for (const line of lines.toReversed()) {
    for (const pattern of COMMAND_NOT_FOUND) {
      const word = pattern.exec(line)?.[1];
      if (!word) continue;
      const suggestion = closest(word, KNOWN_COMMANDS);
      return suggestion ? { typed: word, suggestion, kind: 'command' } : null;
    }
    const subcommand = DOCKER_UNKNOWN.exec(line)?.[1];
    if (subcommand) {
      const suggestion = closest(subcommand, DOCKER_SUBCOMMANDS);
      return suggestion ? { typed: subcommand, suggestion, kind: 'docker' } : null;
    }
  }
  return null;
}

/** The command line with the mistyped word swapped for its fix, if the word is in it. */
export function correctLine(line: string, mistake: Mistake): string | null {
  const tokens = line.trim().split(/\s+/);
  const at = tokens.indexOf(mistake.typed);
  if (at < 0) return null;
  tokens[at] = mistake.suggestion;
  return tokens.join(' ');
}

const ESCAPE_SEQUENCE = new RegExp(
  String.raw`\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007]*\u0007|[@-Z\\-_])`,
  'g'
);

export function stripAnsi(text: string): string {
  return text.replace(ESCAPE_SEQUENCE, '');
}

/**
 * Follows what the person types so a correction can be offered for the whole
 * line, not just the word. It is a best guess: the shell owns the real line, so
 * history recall and tab completion can make it differ, and the caller checks
 * the typo is in it before relying on it.
 */
export class LineTracker {
  private line = '';
  last = '';

  push(data: string) {
    // Arrow keys and other escape sequences move around in a line we can't see.
    if (data.startsWith('\u001b')) return;
    for (const char of data) {
      if (char === '\r' || char === '\n') {
        if (this.line.trim()) this.last = this.line;
        this.line = '';
      } else if (char === '\u007f' || char === '\b') {
        this.line = this.line.slice(0, -1);
      } else if (char === '\u0003' || char === '\u0015') {
        this.line = '';
      } else if (char >= ' ') {
        this.line += char;
      }
    }
  }
}
