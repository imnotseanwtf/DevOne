/**
 * Case-insensitive match with `*` as "anything", including dots and slashes:
 * "*.internal" matches "db.eu.internal", "dependabot/*" matches "dependabot/npm/x".
 */
export function matchesGlob(value: string, pattern: string): boolean {
  const escaped = pattern
    .trim()
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`, 'i').test(value.trim());
}

export function matchesAnyGlob(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesGlob(value, pattern));
}

/** One pattern per line (or comma), trimmed, blanks and duplicates dropped. */
export function parsePatternList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  ];
}
