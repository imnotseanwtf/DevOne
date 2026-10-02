/** Issue keys look like DEV-142: an uppercase project prefix and a number. */
const ISSUE_KEY = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;

export function formatIssueKey(prefix: string, number: number): string {
  return `${prefix}-${number}`;
}

/**
 * Finds every issue key in arbitrary text: a branch name, a commit message, or
 * a merge request title. Returns them uppercased and deduplicated.
 */
export function parseIssueKeys(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.toUpperCase().matchAll(ISSUE_KEY)) {
    found.add(`${match[1]}-${Number(match[2])}`);
  }
  return [...found];
}

/** Keys in `text` that belong to `prefix`, so one project ignores another's keys. */
export function issueKeysForPrefix(text: string, prefix: string): string[] {
  const upper = prefix.toUpperCase();
  return parseIssueKeys(text).filter((key) => key.slice(0, key.lastIndexOf('-')) === upper);
}

/**
 * Derives a prefix from a project name: initials for multi-word names, the
 * leading letters otherwise. Always 2-5 uppercase characters.
 */
export function toIssuePrefix(name: string): string {
  const words = name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);

  if (words.length === 0) return 'PRJ';
  const initials = words.length > 1 ? words.map((word) => word[0]).join('') : words[0];
  const trimmed = initials.replace(/^[0-9]+/, '').slice(0, 5);
  return trimmed.length >= 2 ? trimmed : `${words[0]}XX`.slice(0, 3);
}

/** Disambiguates a taken prefix: DEV, DEV2, DEV3 … */
export function withPrefixSuffix(prefix: string, attempt: number): string {
  if (attempt <= 1) return prefix;
  const suffix = String(attempt);
  return prefix.slice(0, Math.max(2, 5 - suffix.length)) + suffix;
}
