/**
 * The "Code" skill of the docs chat: what to read from a project's repository
 * once the person picks a branch. Pure functions, so they are checked without a
 * database or a Git provider.
 */

export interface CodeTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

export interface CodeCommit {
  sha: string;
  message: string;
  authorName: string;
}

export interface CodeFile {
  path: string;
  text: string;
  truncated: boolean;
}

export interface CodeSelection {
  repositoryId: string;
  branch: string;
}

/** Most files read for one question, and the most characters kept from each. */
export const MAX_CODE_FILES = 4;
export const MAX_CODE_FILE_CHARS = 6_000;
const MAX_ENTRIES_LISTED = 80;
const MAX_COMMITS_LISTED = 10;
const BRANCH_PATTERN = /^[\w./@+-]{1,200}$/;

/** Branch names go into provider URLs, so only the usual characters pass. */
export function isSafeBranchName(branch: string): boolean {
  return BRANCH_PATTERN.test(branch) && !branch.includes('..') && !branch.startsWith('/');
}

const STOP_WORDS = new Set(
  'a an and are as at be by do does for from how i in is it its of on or so that the this to was what when where which who why with you your can we our about file files code folder'.split(
    ' '
  )
);

/** Words from the question that could name a file or folder, lowercased. */
function nameWords(question: string): string[] {
  return (question.toLowerCase().match(/[\p{L}\p{N}_.-]{2,}/gu) ?? []).filter(
    (word) => !STOP_WORDS.has(word)
  );
}

/** Path-like tokens in the question ("src/lib/x.ts", "package.json"), without surrounding punctuation. */
export function pathsMentioned(question: string): string[] {
  const found = new Set<string>();
  for (const match of question.matchAll(/[\w@.-]+(?:\/[\w@.-]+)+|[\w-]+\.[A-Za-z0-9]{1,8}\b/g)) {
    const path = match[0].replace(/^\.\//, '').replace(/[.,;:]+$/, '');
    if (path && !path.split('/').includes('..')) found.add(path);
  }
  return [...found];
}

/**
 * Which root entries to open for a question: the ones the person named, plus the
 * README so there is always something to say about what the project is.
 */
export function pickEntries(question: string, root: CodeTreeEntry[]): CodeTreeEntry[] {
  const words = nameWords(question);
  const mentioned = pathsMentioned(question).map((path) => path.toLowerCase());
  const scored = root.map((entry) => {
    const name = entry.name.toLowerCase();
    const stem = name.replace(/\.[^.]+$/, '');
    let value = 0;
    if (mentioned.includes(name) || mentioned.includes(entry.path.toLowerCase())) value += 10;
    if (words.includes(name)) value += 5;
    else if (stem.length > 1 && words.includes(stem)) value += 3;
    if (/^readme(\.|$)/i.test(entry.name) && entry.type === 'file') value += 1;
    return { entry, value };
  });
  return scored
    .filter((item) => item.value > 0)
    .toSorted((a, b) => b.value - a.value)
    .map((item) => item.entry);
}

/** Section headed "## Code", fenced as data like the docs excerpts. */
export function formatCodeContext(input: {
  repository: string;
  branch: string;
  commits: CodeCommit[];
  root: CodeTreeEntry[];
  /** Folders opened for the question, by path. */
  folders: { path: string; entries: CodeTreeEntry[] }[];
  files: CodeFile[];
}): string {
  const list = (entries: CodeTreeEntry[]) =>
    entries
      .slice(0, MAX_ENTRIES_LISTED)
      .map((entry) => `${entry.type === 'dir' ? '[dir] ' : ''}${entry.path}`)
      .join('\n') + (entries.length > MAX_ENTRIES_LISTED ? '\n…' : '');
  return [
    `## Code: ${input.repository} @ ${input.branch}`,
    '',
    '### Latest commits',
    input.commits.length
      ? input.commits
          .slice(0, MAX_COMMITS_LISTED)
          .map(
            (commit) =>
              `${commit.sha.slice(0, 7)} ${commit.message.split('\n')[0].slice(0, 120)} (${commit.authorName})`
          )
          .join('\n')
      : '(none)',
    '',
    '### Files at the top of the repository',
    list(input.root),
    ...input.folders.flatMap((folder) => ['', `### Folder: ${folder.path}`, list(folder.entries)]),
    ...input.files.flatMap((file) => [
      '',
      `### File: ${file.path}`,
      file.text
        ? `\`\`\`\n${file.text.slice(0, MAX_CODE_FILE_CHARS)}${file.text.length > MAX_CODE_FILE_CHARS ? '\n…(cut)' : ''}\n\`\`\``
        : file.truncated
          ? '(too large to read)'
          : '(empty)'
    ])
  ].join('\n');
}
