import type { GitTreeEntry } from '@/lib/git/provider';

/** Uncommitted work in the browser, keyed by repository path. */
export type Change =
  | { kind: 'modified'; content: string }
  | { kind: 'added'; content: string }
  | { kind: 'deleted' };

export type Changes = Record<string, Change>;

export interface TreeNode extends GitTreeEntry {
  /** Only exists in local changes, not on the branch yet. */
  local?: boolean;
}

export const CHANGE_LETTER: Record<Change['kind'], string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D'
};

export const CHANGE_COLOR: Record<Change['kind'], string> = {
  modified: 'text-amber-600 dark:text-amber-400',
  added: 'text-emerald-600 dark:text-emerald-400',
  deleted: 'text-red-600 dark:text-red-400'
};

export function parentOf(path: string) {
  return path.split('/').slice(0, -1).join('/');
}

export function baseName(path: string) {
  return path.split('/').pop() ?? path;
}

/** Every folder above `path`, outermost first: `a/b/c.ts` -> `a`, `a/b`. */
export function ancestorsOf(path: string) {
  const segments = path.split('/').slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}

/** Merges files added locally into one directory level from the provider. */
export function mergeLocalEntries(
  directory: string,
  remote: GitTreeEntry[],
  changes: Changes
): TreeNode[] {
  const prefix = directory ? `${directory}/` : '';
  const nodes = new Map<string, TreeNode>(remote.map((entry) => [entry.path, entry]));

  for (const [path, change] of Object.entries(changes)) {
    if (change.kind !== 'added' || !path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const name = rest.split('/')[0];
    const nodePath = `${prefix}${name}`;
    if (!nodes.has(nodePath)) {
      nodes.set(nodePath, {
        name,
        path: nodePath,
        type: rest.includes('/') ? 'dir' : 'file',
        local: true
      });
    }
  }

  return [...nodes.values()].toSorted((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
  );
}

/** Rejects paths the providers would refuse, before they reach a commit. */
export function validatePath(path: string): string | null {
  const trimmed = path.trim().replace(/^\/+/, '');
  if (!trimmed || trimmed.endsWith('/')) return 'Enter a file name';
  if (trimmed.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'Folders cannot be empty, "." or ".."';
  }
  return null;
}

// A tab shows a file, or the diff of a file's changes. Diff tabs carry a NUL, which no
// repository path can contain, so the two never collide.
const DIFF_TAB = '\u0000diff:';

export const diffTab = (path: string) => `${DIFF_TAB}${path}`;

export function parseTab(tab: string): { path: string; diff: boolean } {
  return tab.startsWith(DIFF_TAB)
    ? { path: tab.slice(DIFF_TAB.length), diff: true }
    : { path: tab, diff: false };
}
