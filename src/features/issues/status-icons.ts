/**
 * The icons a board status can wear, all circles in the style of Linear's
 * workflow states (Tabler icons). Stored by name on BoardColumn.icon.
 */
export const STATUS_ICON_NAMES = [
  'todo',
  'backlog',
  'triage',
  'started',
  'progress',
  'review',
  'testing',
  'blocked',
  'ready',
  'done',
  'doneFilled',
  'verified',
  'cancelled',
  'paused'
] as const;

export type StatusIconName = (typeof STATUS_ICON_NAMES)[number];

export const STATUS_ICON_LABELS: Record<StatusIconName, string> = {
  todo: 'To do',
  backlog: 'Backlog',
  triage: 'Triage',
  started: 'Started',
  progress: 'In progress',
  review: 'In review',
  testing: 'Testing',
  blocked: 'Blocked',
  ready: 'Ready',
  done: 'Done',
  doneFilled: 'Done (filled)',
  verified: 'Verified',
  cancelled: 'Cancelled',
  paused: 'On hold'
};

export function isStatusIconName(value: unknown): value is StatusIconName {
  return STATUS_ICON_NAMES.includes(value as StatusIconName);
}

/** The icon a status gets from its name when none was chosen. */
export function defaultStatusIcon(status: string): StatusIconName {
  if (/^(done|closed|complete|completed|resolved|shipped|released)$/i.test(status)) return 'done';
  if (status === 'BACKLOG') return 'backlog';
  if (/cancel|won.?t|rejected|duplicate/i.test(status)) return 'cancelled';
  if (/block/i.test(status)) return 'blocked';
  if (/hold|pause|waiting/i.test(status)) return 'paused';
  if (/triage|idea|inbox/i.test(status)) return 'triage';
  if (/progress|doing|develop|working/i.test(status)) return 'progress';
  if (/qa|test|verify/i.test(status)) return 'testing';
  if (/review/i.test(status)) return 'review';
  if (/ready|deploy/i.test(status)) return 'ready';
  return 'todo';
}
