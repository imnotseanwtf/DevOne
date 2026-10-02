/**
 * A branch name for a task, e.g. "P-12-login-returns-403". Starting with the
 * task key keeps the branch linked by the git sync as well.
 */
export function suggestBranchName(issueKey: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug ? `${issueKey}-${slug}` : issueKey;
}
