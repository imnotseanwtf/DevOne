const RUNNING = new Set([
  'queued',
  'in_progress',
  'waiting',
  'pending',
  'requested',
  'running',
  'created',
  'preparing',
  'waiting_for_resource'
]);

/** Still going, so worth polling. Covers GitHub's and GitLab's names. */
export function isRunning(status: string): boolean {
  return RUNNING.has(status.toLowerCase());
}
