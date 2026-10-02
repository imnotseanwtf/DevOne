const TASK_MARKER = /^(\s*(?:[-+*]|\d+[.)])\s+)\[([ xX])\]/;

export function toggleMarkdownTask(source: string, taskIndex: number, checked: boolean): string {
  if (!Number.isInteger(taskIndex) || taskIndex < 0) throw new Error('Invalid task index');

  let currentIndex = 0;
  let found = false;
  const lines = source.split('\n').map((line) => {
    if (!TASK_MARKER.test(line)) return line;
    if (currentIndex++ !== taskIndex) return line;
    found = true;
    return line.replace(TASK_MARKER, `$1[${checked ? 'x' : ' '}]`);
  });

  if (!found) throw new Error('Task not found');
  return lines.join('\n');
}
